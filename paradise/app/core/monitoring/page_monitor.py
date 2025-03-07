import requests
import hashlib
import json
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from sqlalchemy.orm import Session
from loguru import logger

from app.db.models import MonitoredPage, PageChange
from app.core.extractors.file_extractor import extract_file_links, download_files


def get_page_content(url: str, headers: Optional[Dict[str, str]] = None) -> Tuple[Optional[str], Dict[str, str]]:
    """
    Fetch the content of a webpage.
    
    Args:
        url: The URL to fetch
        headers: Optional headers to include in the request
        
    Returns:
        Tuple of (content, response_headers)
    """
    default_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    
    if headers:
        default_headers.update(headers)
    
    try:
        response = requests.get(url, headers=default_headers, timeout=30)
        response.raise_for_status()
        return response.text, dict(response.headers)
    except requests.RequestException as e:
        logger.error(f"Error fetching {url}: {str(e)}")
        return None, {}


def compute_content_hash(content: str, css_selector: Optional[str] = None) -> str:
    """
    Compute a hash of the page content, optionally filtering by CSS selector.
    
    Args:
        content: HTML content
        css_selector: Optional CSS selector to focus on specific content
        
    Returns:
        Hash string of the content
    """
    if css_selector:
        try:
            soup = BeautifulSoup(content, 'html.parser')
            elements = soup.select(css_selector)
            if elements:
                content = ''.join(str(element) for element in elements)
            else:
                logger.warning(f"CSS selector '{css_selector}' did not match any elements")
        except Exception as e:
            logger.error(f"Error applying CSS selector: {str(e)}")
    
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


def check_page_for_changes(
    db: Session, 
    page: MonitoredPage
) -> Tuple[bool, Optional[PageChange], List[Dict[str, Any]]]:
    """
    Check a monitored page for changes.
    
    Args:
        db: Database session
        page: MonitoredPage object to check
        
    Returns:
        Tuple of (changed, page_change, file_links)
    """
    # Prepare conditional headers if we have them
    headers = {}
    if page.last_etag:
        headers["If-None-Match"] = page.last_etag
    if page.last_modified:
        headers["If-Modified-Since"] = page.last_modified
    
    # Fetch the page content
    content, response_headers = get_page_content(page.url, headers)
    
    # Update the last checked timestamp
    page.last_checked_at = datetime.now()
    
    # If we couldn't fetch the content, return early
    if content is None:
        db.commit()
        return False, None, []
    
    # Extract ETag and Last-Modified from response headers
    etag = response_headers.get("ETag")
    last_modified = response_headers.get("Last-Modified")
    
    # Update page with new headers
    if etag:
        page.last_etag = etag
    if last_modified:
        page.last_modified = last_modified
    
    # Compute content hash
    content_hash = compute_content_hash(content, page.css_selector)
    
    # Check if content has changed
    changed = False
    if page.last_content_hash is None or page.last_content_hash != content_hash:
        changed = True
        page.last_content_hash = content_hash
        page.last_changed_at = datetime.now()
        
        # Create a page change record
        change = PageChange(
            page_id=page.id,
            change_type="content_changed",
            details=json.dumps({
                "previous_hash": page.last_content_hash,
                "new_hash": content_hash
            })
        )
        db.add(change)
        db.flush()  # Flush to get the change ID
        
        # Extract file links from the page
        file_links = extract_file_links(content, page.url)
        
        db.commit()
        return changed, change, file_links
    
    # No changes detected
    db.commit()
    return False, None, []


async def check_all_pages(db: Session) -> List[Dict[str, Any]]:
    """
    Check all active monitored pages for changes.
    
    Args:
        db: Database session
        
    Returns:
        List of results for each page check
    """
    results = []
    
    # Get all active pages
    pages = db.query(MonitoredPage).filter(MonitoredPage.is_active == True).all()
    
    for page in pages:
        try:
            changed, change, file_links = check_page_for_changes(db, page)
            
            if changed and file_links:
                # Download new files
                downloaded_files = await download_files(db, page, change, file_links)
                
                results.append({
                    "page_id": page.id,
                    "page_name": page.name,
                    "url": page.url,
                    "changed": True,
                    "change_id": change.id if change else None,
                    "files_found": len(file_links),
                    "files_downloaded": len(downloaded_files)
                })
            else:
                results.append({
                    "page_id": page.id,
                    "page_name": page.name,
                    "url": page.url,
                    "changed": changed,
                    "change_id": change.id if change else None,
                    "files_found": 0,
                    "files_downloaded": 0
                })
                
        except Exception as e:
            logger.error(f"Error checking page {page.name} ({page.url}): {str(e)}")
            results.append({
                "page_id": page.id,
                "page_name": page.name,
                "url": page.url,
                "error": str(e)
            })
    
    return results 