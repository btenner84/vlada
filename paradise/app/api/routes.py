from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import os
from arq import create_pool
from arq.connections import RedisSettings
from fastapi.responses import FileResponse

from app.db.database import get_db
from app.db.models import User, MonitoredPage, PageChange, DownloadedFile
from app.api import schemas
from app.api.auth import authenticate_user, create_access_token, get_current_active_user, get_password_hash
from app.config.settings import settings
from app.core.monitoring.page_monitor import check_page_for_changes
from app.core.ai import OpenAIExtractor


# Create API router
router = APIRouter()


# Authentication routes
@router.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Get an access token for authentication.
    """
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


# User routes
@router.get("/users/me", response_model=schemas.User)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    """
    Get the current user.
    """
    return current_user


# Monitored page routes
@router.get("/pages", response_model=List[schemas.MonitoredPage])
async def get_pages(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get all monitored pages.
    """
    pages = db.query(MonitoredPage).offset(skip).limit(limit).all()
    return pages


@router.post("/pages", response_model=schemas.MonitoredPage)
async def create_page(
    page: schemas.MonitoredPageCreate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Create a new monitored page.
    """
    # Check if the page already exists
    db_page = db.query(MonitoredPage).filter(MonitoredPage.url == str(page.url)).first()
    if db_page:
        raise HTTPException(status_code=400, detail="Page with this URL already exists")
    
    # Create the page
    db_page = MonitoredPage(**page.dict())
    db.add(db_page)
    db.commit()
    db.refresh(db_page)
    return db_page


@router.get("/pages/{page_id}", response_model=schemas.MonitoredPage)
async def get_page(
    page_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get a monitored page by ID.
    """
    db_page = db.query(MonitoredPage).filter(MonitoredPage.id == page_id).first()
    if db_page is None:
        raise HTTPException(status_code=404, detail="Page not found")
    return db_page


@router.put("/pages/{page_id}", response_model=schemas.MonitoredPage)
async def update_page(
    page_id: int, 
    page: schemas.MonitoredPageUpdate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Update a monitored page.
    """
    db_page = db.query(MonitoredPage).filter(MonitoredPage.id == page_id).first()
    if db_page is None:
        raise HTTPException(status_code=404, detail="Page not found")
    
    # Update the page with non-None values
    update_data = page.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_page, key, value)
    
    db.commit()
    db.refresh(db_page)
    return db_page


@router.delete("/pages/{page_id}", response_model=schemas.MonitoredPage)
async def delete_page(
    page_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Delete a monitored page.
    """
    db_page = db.query(MonitoredPage).filter(MonitoredPage.id == page_id).first()
    if db_page is None:
        raise HTTPException(status_code=404, detail="Page not found")
    
    db.delete(db_page)
    db.commit()
    return db_page


@router.post("/pages/{page_id}/check", response_model=schemas.PageCheckResponse)
async def check_page_now(
    page_id: int, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Manually trigger a check for a monitored page.
    """
    # Get the page
    db_page = db.query(MonitoredPage).filter(MonitoredPage.id == page_id).first()
    if db_page is None:
        raise HTTPException(status_code=404, detail="Page not found")
    
    # Create Redis connection
    redis = await create_pool(RedisSettings.from_dsn(str(settings.REDIS_URL)))
    
    # Enqueue the job
    job = await redis.enqueue_job('check_page', db_page.id)
    
    return {
        "success": True,
        "message": f"Check for page '{db_page.name}' has been scheduled",
        "result": {
            "job_id": job.job_id,
            "page_id": db_page.id
        }
    }


# Page changes routes
@router.get("/pages/{page_id}/changes", response_model=List[schemas.PageChange])
async def get_page_changes(
    page_id: int, 
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get all changes for a monitored page.
    """
    # Check if the page exists
    db_page = db.query(MonitoredPage).filter(MonitoredPage.id == page_id).first()
    if db_page is None:
        raise HTTPException(status_code=404, detail="Page not found")
    
    # Get the changes
    changes = db.query(PageChange).filter(PageChange.page_id == page_id).order_by(PageChange.detected_at.desc()).offset(skip).limit(limit).all()
    return changes


# Downloaded files routes
@router.get("/pages/{page_id}/files", response_model=List[schemas.DownloadedFile])
async def get_page_files(
    page_id: int, 
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get all downloaded files for a monitored page.
    """
    # Check if the page exists
    db_page = db.query(MonitoredPage).filter(MonitoredPage.id == page_id).first()
    if db_page is None:
        raise HTTPException(status_code=404, detail="Page not found")
    
    # Get the files
    files = db.query(DownloadedFile).filter(DownloadedFile.page_id == page_id).order_by(DownloadedFile.downloaded_at.desc()).offset(skip).limit(limit).all()
    return files


@router.get("/files/{file_id}/download")
async def download_file(
    file_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Download a file by ID.
    """
    # Get the file from the database
    db_file = db.query(DownloadedFile).filter(DownloadedFile.id == file_id).first()
    if db_file is None:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Check if the file exists
    if not os.path.exists(db_file.stored_filename):
        raise HTTPException(status_code=404, detail="File not found on disk")
    
    return FileResponse(
        path=db_file.stored_filename,
        filename=db_file.original_filename,
        media_type=db_file.content_type or "application/octet-stream"
    )


# Smart extraction routes
@router.post("/smart-extract", response_model=schemas.SmartExtractionResponse)
async def smart_extract(
    extraction_request: schemas.SmartExtractionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Smart extraction using OpenAI to understand what to extract from a webpage.
    """
    # Initialize the OpenAI extractor
    extractor = OpenAIExtractor()
    
    # If no screenshot is provided, try to capture one
    screenshot = extraction_request.screenshot
    if not screenshot:
        screenshot = await extractor.capture_screenshot(str(extraction_request.url))
    
    # Analyze the webpage
    analysis_result = await extractor.analyze_webpage(
        url=str(extraction_request.url),
        context=extraction_request.context,
        screenshot=screenshot
    )
    
    if not analysis_result.get("success", False):
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to analyze webpage: {analysis_result.get('error', 'Unknown error')}"
        )
    
    # Create a temporary page record to store the extraction plan
    temp_page = MonitoredPage(
        name=f"Smart Extract: {extraction_request.url}",
        url=str(extraction_request.url),
        is_active=False,  # Not active until confirmed
        frequency=MonitoringFrequency.DAILY.value,  # Default frequency
    )
    db.add(temp_page)
    db.commit()
    db.refresh(temp_page)
    
    return {
        "success": True,
        "message": "Webpage analyzed successfully",
        "extraction_plan": analysis_result["extraction_plan"],
        "page_id": temp_page.id,
        "preview": analysis_result.get("preview")
    }


@router.post("/smart-extract/confirm", response_model=schemas.MonitoredPage)
async def confirm_smart_extract(
    confirmation: schemas.ExtractionConfirmation,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Confirm a smart extraction and start monitoring the page.
    """
    # Get the temporary page
    temp_page = db.query(MonitoredPage).filter(MonitoredPage.id == confirmation.page_id).first()
    if temp_page is None:
        raise HTTPException(status_code=404, detail="Extraction plan not found")
    
    if confirmation.confirmed:
        # Activate the page for monitoring
        temp_page.is_active = True
        db.commit()
        db.refresh(temp_page)
        
        # Schedule an immediate check
        redis = await create_pool(RedisSettings.from_dsn(str(settings.REDIS_URL)))
        await redis.enqueue_job('check_page', temp_page.id)
        
        return temp_page
    else:
        # Delete the temporary page if not confirmed
        db.delete(temp_page)
        db.commit()
        
        raise HTTPException(status_code=400, detail="Extraction plan rejected") 