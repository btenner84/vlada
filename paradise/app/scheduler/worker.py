import asyncio
from arq import create_pool
from arq.connections import RedisSettings
from datetime import datetime, timedelta
from typing import Dict, Any, List
from loguru import logger
import json

from app.config.settings import settings
from app.db.database import SessionLocal
from app.db.models import MonitoredPage, MonitoringFrequency
from app.core.monitoring.page_monitor import check_page_for_changes
from app.core.extractors.file_extractor import download_files
from app.core.notifications.notification_manager import send_notifications


async def check_page(ctx: Dict[str, Any], page_id: int) -> Dict[str, Any]:
    """
    Background task to check a single page for changes.
    
    Args:
        ctx: Arq context
        page_id: ID of the page to check
        
    Returns:
        Dictionary with check results
    """
    db = SessionLocal()
    try:
        # Get the page from the database
        page = db.query(MonitoredPage).filter(MonitoredPage.id == page_id).first()
        
        if not page:
            logger.error(f"Page with ID {page_id} not found")
            return {"error": f"Page with ID {page_id} not found"}
        
        if not page.is_active:
            logger.info(f"Page {page.name or page.url} is not active, skipping check")
            return {"skipped": True, "reason": "Page is not active"}
        
        # Check the page for changes
        changed, change, file_links = check_page_for_changes(db, page)
        
        if changed and file_links:
            # Download new files
            downloaded_files = await download_files(db, page, change, file_links)
            
            # Send notifications
            if change and downloaded_files:
                notification_results = await send_notifications(db, change, downloaded_files)
            
            return {
                "page_id": page.id,
                "page_name": page.name,
                "url": page.url,
                "changed": True,
                "change_id": change.id if change else None,
                "files_found": len(file_links),
                "files_downloaded": len(downloaded_files) if 'downloaded_files' in locals() else 0,
                "notifications": notification_results if 'notification_results' in locals() else {}
            }
        
        return {
            "page_id": page.id,
            "page_name": page.name,
            "url": page.url,
            "changed": changed,
            "change_id": change.id if change else None,
            "files_found": 0,
            "files_downloaded": 0
        }
    
    except Exception as e:
        logger.error(f"Error checking page {page_id}: {str(e)}")
        return {"error": str(e)}
    
    finally:
        db.close()


async def schedule_page_checks(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """
    Scheduled task to enqueue page checks based on their frequency.
    
    Args:
        ctx: Arq context
        
    Returns:
        Dictionary with scheduling results
    """
    db = SessionLocal()
    try:
        # Get all active pages
        pages = db.query(MonitoredPage).filter(MonitoredPage.is_active == True).all()
        
        scheduled_count = 0
        skipped_count = 0
        
        for page in pages:
            # Determine if the page is due for a check based on frequency
            if page.last_checked_at is None:
                # Never checked before, schedule it
                await ctx['redis'].enqueue_job('check_page', page.id)
                scheduled_count += 1
                continue
            
            # Calculate the next check time based on frequency
            frequency_map = {
                MonitoringFrequency.FIVE_MINUTES.value: timedelta(minutes=5),
                MonitoringFrequency.FIFTEEN_MINUTES.value: timedelta(minutes=15),
                MonitoringFrequency.THIRTY_MINUTES.value: timedelta(minutes=30),
                MonitoringFrequency.HOURLY.value: timedelta(hours=1),
                MonitoringFrequency.DAILY.value: timedelta(days=1),
                MonitoringFrequency.WEEKLY.value: timedelta(weeks=1)
            }
            
            frequency_delta = frequency_map.get(page.frequency, timedelta(hours=1))
            next_check_time = page.last_checked_at + frequency_delta
            
            if datetime.now() >= next_check_time:
                # Time to check this page
                await ctx['redis'].enqueue_job('check_page', page.id)
                scheduled_count += 1
            else:
                # Not time to check yet
                skipped_count += 1
        
        return {
            "scheduled": scheduled_count,
            "skipped": skipped_count,
            "total": len(pages)
        }
    
    except Exception as e:
        logger.error(f"Error scheduling page checks: {str(e)}")
        return {"error": str(e)}
    
    finally:
        db.close()


async def startup(ctx: Dict[str, Any]) -> None:
    """
    Startup function for the Arq worker.
    
    Args:
        ctx: Arq context
    """
    logger.info("Starting Web Monitor worker")
    # Store Redis connection in context
    ctx['redis'] = ctx['redis']


async def shutdown(ctx: Dict[str, Any]) -> None:
    """
    Shutdown function for the Arq worker.
    
    Args:
        ctx: Arq context
    """
    logger.info("Shutting down Web Monitor worker")


class WorkerSettings:
    """Arq worker settings."""
    redis_settings = RedisSettings.from_dsn(str(settings.REDIS_URL))
    functions = [check_page, schedule_page_checks]
    on_startup = startup
    on_shutdown = shutdown
    cron_jobs = [
        # Run the scheduler every minute
        {'cron': '* * * * *', 'func': 'schedule_page_checks'}
    ] 