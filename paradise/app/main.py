from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
import os
from datetime import timedelta
from sqlalchemy.orm import Session
from loguru import logger
import sys

from app.db.database import get_db, engine
from app.db.models import Base, User
from app.api.routes import router as api_router
from app.api.auth import authenticate_user, create_access_token, get_password_hash
from app.api import schemas
from app.config.settings import settings


# Configure logger
logger.remove()
logger.add(
    sys.stdout,
    colorize=True,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO"
)
logger.add(
    "logs/webmonitor.log",
    rotation="10 MB",
    retention="7 days",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    level="INFO"
)

# Create the FastAPI app
app = FastAPI(
    title="Web Monitoring & File Extraction Tool",
    description="A tool that monitors webpages for updates, detects new or updated file links, downloads those files, and notifies an administrator.",
    version="0.1.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix="/api")


# Create database tables on startup
@app.on_event("startup")
async def startup_event():
    # Create tables
    Base.metadata.create_all(bind=engine)
    
    # Create admin user if it doesn't exist
    db = next(get_db())
    admin_user = db.query(User).filter(User.email == settings.ADMIN_EMAIL).first()
    if not admin_user:
        admin_user = User(
            email=settings.ADMIN_EMAIL,
            hashed_password=get_password_hash(settings.ADMIN_PASSWORD),
            is_active=True
        )
        db.add(admin_user)
        db.commit()
        logger.info(f"Created admin user: {settings.ADMIN_EMAIL}")
    
    # Create downloads directory if it doesn't exist
    os.makedirs(settings.DOWNLOAD_DIR, exist_ok=True)
    
    # Create logs directory if it doesn't exist
    os.makedirs("logs", exist_ok=True)
    
    logger.info("Application startup complete")


# Root endpoint
@app.get("/")
async def root():
    """
    Root endpoint.
    """
    return {"message": "Welcome to the Web Monitoring & File Extraction Tool API"}

@app.get("/smart-extract", response_class=HTMLResponse)
async def smart_extract_page():
    """
    Serve the smart extraction page.
    """
    with open("app/templates/smart_extract.html") as f:
        return f.read()


# Login endpoint
@app.post("/login", response_model=schemas.Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Login endpoint.
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


# Serve downloaded files
@app.get("/downloads/{path:path}")
async def serve_file(path: str):
    file_path = os.path.join(settings.DOWNLOAD_DIR, path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)


# Mount static files for frontend
@app.on_event("startup")
async def mount_static_files():
    if os.path.exists("frontend/dist"):
        app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend") 