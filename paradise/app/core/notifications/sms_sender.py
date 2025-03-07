from twilio.rest import Client
from typing import List, Dict, Any, Optional
from loguru import logger
from sqlalchemy.orm import Session

from app.config.settings import settings
from app.db.models import PageChange, DownloadedFile, Notification


def send_sms_notification(
    db: Session,
    change: PageChange,
    files: List[DownloadedFile]
) -> bool:
    """
    Send an SMS notification about a page change using Twilio.
    
    Args:
        db: Database session
        change: PageChange object
        files: List of DownloadedFile objects
        
    Returns:
        True if the SMS was sent successfully, False otherwise
    """
    # Check if Twilio settings are configured
    if not all([
        settings.TWILIO_ACCOUNT_SID,
        settings.TWILIO_AUTH_TOKEN,
        settings.TWILIO_FROM_NUMBER,
        settings.ADMIN_PHONE_NUMBER
    ]):
        logger.warning("Twilio settings not fully configured, skipping SMS notification")
        
        # Create a notification record with status "skipped"
        notification = Notification(
            change_id=change.id,
            notification_type="sms",
            status="skipped",
            error_message="Twilio settings not fully configured"
        )
        db.add(notification)
        db.commit()
        
        return False
    
    try:
        # Get page information
        page = change.page
        
        # Create Twilio client
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        
        # Build SMS message (keep it short)
        message_body = f"Alert: {page.name or page.url} updated"
        
        if files:
            message_body += f", {len(files)} new file(s) downloaded"
        
        message_body += ". Check email or dashboard for details."
        
        # Send the SMS
        message = client.messages.create(
            body=message_body,
            from_=settings.TWILIO_FROM_NUMBER,
            to=settings.ADMIN_PHONE_NUMBER
        )
        
        # Create a notification record with status "sent"
        notification = Notification(
            change_id=change.id,
            notification_type="sms",
            status="sent"
        )
        db.add(notification)
        db.commit()
        
        logger.info(f"SMS notification sent for page {page.name or page.url}")
        return True
        
    except Exception as e:
        error_message = str(e)
        logger.error(f"Error sending SMS notification: {error_message}")
        
        # Create a notification record with status "failed"
        notification = Notification(
            change_id=change.id,
            notification_type="sms",
            status="failed",
            error_message=error_message
        )
        db.add(notification)
        db.commit()
        
        return False 