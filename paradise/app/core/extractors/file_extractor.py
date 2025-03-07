import os
import re
import hashlib
import aiohttp
import asyncio
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from datetime import datetime
from typing import Dict, List, Optional, Any, Set
from sqlalchemy.orm import Session
from loguru import logger
from pathlib import Path

from app.db.models import MonitoredPage, PageChange, DownloadedFile
from app.config.settings import settings


# Common file extensions to look for
FILE_EXTENSIONS = {
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'zip', 'rar',
    'tar', 'gz', 'json', 'xml', 'rtf'
}


def extract_file_links(html_content: str, base_url: str) -> List[Dict[str, Any]]:
    """
    Extract file links from HTML content.
    
    Args:
        html_content: HTML content to parse
        base_url: Base URL for resolving relative links
        
    Returns:
        List of dictionaries with file information
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    file_links = []
    seen_urls = set()
    
    # Find all <a> tags
    for link in soup.find_all('a', href=True):
        href = link['href']
        absolute_url = urljoin(base_url, href)
        
        # Skip if we've already seen this URL
        if absolute_url in seen_urls:
            continue
        
        # Check if the URL points to a file
        if is_file_url(absolute_url):
            seen_urls.add(absolute_url)
            
            # Get the link text or use the filename if no text
            link_text = link.get_text().strip()
            if not link_text:
                link_text = os.path.basename(urlparse(absolute_url).path)
            
            file_links.append({
                'url': absolute_url,
                'filename': os.path.basename(urlparse(absolute_url).path),
                'title': link_text,
                'extension': get_file_extension(absolute_url)
            })
    
    # Also look for <iframe>, <embed>, and other tags that might contain file links
    for tag in soup.find_all(['iframe', 'embed', 'object']):
        src = tag.get('src') or tag.get('data')
        if src:
            absolute_url = urljoin(base_url, src)
            
            # Skip if we've already seen this URL
            if absolute_url in seen_urls:
                continue
            
            # Check if the URL points to a file
            if is_file_url(absolute_url):
                seen_urls.add(absolute_url)
                
                file_links.append({
                    'url': absolute_url,
                    'filename': os.path.basename(urlparse(absolute_url).path),
                    'title': tag.get('title', os.path.basename(urlparse(absolute_url).path)),
                    'extension': get_file_extension(absolute_url)
                })
    
    return file_links


def is_file_url(url: str) -> bool:
    """
    Check if a URL points to a file based on extension.
    
    Args:
        url: URL to check
        
    Returns:
        True if the URL points to a file, False otherwise
    """
    parsed_url = urlparse(url)
    path = parsed_url.path.lower()
    
    # Check if the URL has a file extension
    extension = get_file_extension(url)
    if extension and extension.lower() in FILE_EXTENSIONS:
        return True
    
    # Check for query parameters that might indicate a file download
    if parsed_url.query and any(param in parsed_url.query.lower() for param in ['download', 'file', 'attachment']):
        return True
    
    return False


def get_file_extension(url: str) -> Optional[str]:
    """
    Get the file extension from a URL.
    
    Args:
        url: URL to extract extension from
        
    Returns:
        File extension or None if not found
    """
    parsed_url = urlparse(url)
    path = parsed_url.path
    
    # Extract extension from the path
    _, ext = os.path.splitext(path)
    if ext:
        return ext[1:].lower()  # Remove the leading dot
    
    return None


def get_download_path(page: MonitoredPage, filename: str) -> str:
    """
    Generate a path for storing a downloaded file.
    
    Args:
        page: MonitoredPage object
        filename: Original filename
        
    Returns:
        Path where the file should be stored
    """
    # Create a sanitized directory name from the page name or URL
    if page.name:
        dir_name = re.sub(r'[^\w\-_]', '_', page.name)
    else:
        parsed_url = urlparse(page.url)
        dir_name = parsed_url.netloc.replace('.', '_')
    
    # Add date to the directory structure
    today = datetime.now().strftime('%Y-%m-%d')
    
    # Create the full directory path
    dir_path = os.path.join(settings.DOWNLOAD_DIR, dir_name, today)
    
    # Ensure the directory exists
    os.makedirs(dir_path, exist_ok=True)
    
    # Generate the full file path
    return os.path.join(dir_path, filename)


async def download_file(session: aiohttp.ClientSession, file_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Download a file asynchronously.
    
    Args:
        session: aiohttp ClientSession
        file_info: Dictionary with file information
        
    Returns:
        Dictionary with download results
    """
    url = file_info['url']
    filename = file_info['filename']
    download_path = file_info['download_path']
    
    try:
        async with session.get(url) as response:
            if response.status != 200:
                return {
                    **file_info,
                    'success': False,
                    'error': f"HTTP error {response.status}"
                }
            
            # Get content type and size
            content_type = response.headers.get('Content-Type', '')
            content_length = int(response.headers.get('Content-Length', 0))
            
            # Read the file content
            content = await response.read()
            
            # Compute content hash
            content_hash = hashlib.sha256(content).hexdigest()
            
            # Save the file
            with open(download_path, 'wb') as f:
                f.write(content)
            
            return {
                **file_info,
                'success': True,
                'content_type': content_type,
                'file_size': content_length or len(content),
                'content_hash': content_hash
            }
    except Exception as e:
        logger.error(f"Error downloading {url}: {str(e)}")
        return {
            **file_info,
            'success': False,
            'error': str(e)
        }


async def download_files(
    db: Session, 
    page: MonitoredPage, 
    change: PageChange, 
    file_links: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Download files from a list of links.
    
    Args:
        db: Database session
        page: MonitoredPage object
        change: PageChange object
        file_links: List of file links to download
        
    Returns:
        List of download results
    """
    if not file_links:
        return []
    
    # Get existing files for this page to avoid duplicates
    existing_files = db.query(DownloadedFile.original_url, DownloadedFile.content_hash).filter(
        DownloadedFile.page_id == page.id
    ).all()
    
    existing_urls = {url for url, _ in existing_files}
    existing_hashes = {hash_ for _, hash_ in existing_files if hash_}
    
    # Prepare download tasks
    download_tasks = []
    
    async with aiohttp.ClientSession() as session:
        for file_info in file_links:
            url = file_info['url']
            
            # Skip if we've already downloaded this URL (unless we want to check for updates)
            if url in existing_urls:
                continue
            
            # Generate a filename with timestamp if needed
            original_filename = file_info['filename']
            base_name, ext = os.path.splitext(original_filename)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"{base_name}_{timestamp}{ext}"
            
            # Get the download path
            download_path = get_download_path(page, filename)
            
            # Add to download tasks
            download_tasks.append(
                download_file(
                    session, 
                    {
                        **file_info,
                        'download_path': download_path
                    }
                )
            )
        
        # Execute all downloads concurrently
        if download_tasks:
            download_results = await asyncio.gather(*download_tasks)
        else:
            download_results = []
    
    # Process download results and save to database
    successful_downloads = []
    
    for result in download_results:
        if result['success']:
            # Skip if we've already downloaded a file with the same hash
            if result.get('content_hash') in existing_hashes:
                continue
            
            # Create a database record for the downloaded file
            db_file = DownloadedFile(
                page_id=page.id,
                change_id=change.id,
                original_url=result['url'],
                original_filename=result['filename'],
                stored_filename=result['download_path'],
                file_size=result.get('file_size'),
                content_type=result.get('content_type'),
                content_hash=result.get('content_hash')
            )
            db.add(db_file)
            successful_downloads.append(result)
    
    db.commit()
    return successful_downloads 