from typing import List, Dict, Any
from sqlalchemy.orm import Session
from loguru import logger

from app.db.models import PageChange, DownloadedFile
from app.core.notifications.email_sender import send_email_notification
from app.core.notifications.sms_sender import send_sms_notification


async def send_notifications(
    db: Session,
    change: PageChange,
    files: List[DownloadedFile]
) -> Dict[str, bool]:
    """
    Send all configured notifications for a page change.
    
    Args:
        db: Database session
        change: PageChange object
        files: List of DownloadedFile objects
        
    Returns:
        Dictionary with notification results
    """
    results = {}
    
    # Send email notification
    email_result = await send_email_notification(db, change, files)
    results["email"] = email_result
    
    # Send SMS notification
    sms_result = send_sms_notification(db, change, files)
    results["sms"] = sms_result
    
    return results 