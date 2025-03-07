import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Dict, Any, Optional
from loguru import logger
from sqlalchemy.orm import Session

from app.config.settings import settings
from app.db.models import PageChange, DownloadedFile, Notification


async def send_email_notification(
    db: Session,
    change: PageChange,
    files: List[DownloadedFile]
) -> bool:
    """
    Send an email notification about a page change.
    
    Args:
        db: Database session
        change: PageChange object
        files: List of DownloadedFile objects
        
    Returns:
        True if the email was sent successfully, False otherwise
    """
    # Check if SMTP settings are configured
    if not all([
        settings.SMTP_SERVER,
        settings.SMTP_PORT,
        settings.SMTP_USERNAME,
        settings.SMTP_PASSWORD,
        settings.SMTP_FROM_EMAIL,
        settings.ADMIN_EMAIL
    ]):
        logger.warning("SMTP settings not fully configured, skipping email notification")
        
        # Create a notification record with status "skipped"
        notification = Notification(
            change_id=change.id,
            notification_type="email",
            status="skipped",
            error_message="SMTP settings not fully configured"
        )
        db.add(notification)
        db.commit()
        
        return False
    
    try:
        # Get page information
        page = change.page
        
        # Create email message
        message = MIMEMultipart()
        message["From"] = settings.SMTP_FROM_EMAIL
        message["To"] = settings.ADMIN_EMAIL
        message["Subject"] = f"[WebMonitor] Page Update Detected - {page.name or page.url}"
        
        # Build email body
        body = f"""
        <html>
        <body>
            <h2>Page Update Detected</h2>
            <p>The page <a href="{page.url}">{page.name or page.url}</a> was updated on {change.detected_at.strftime('%Y-%m-%d %H:%M:%S')}.</p>
            
            <h3>Change Details</h3>
            <p>Change type: {change.change_type}</p>
            
            {f"<h3>New Files ({len(files)})</h3>" if files else ""}
            {"<ul>" if files else ""}
            {"".join(f'<li><strong>{file.original_filename}</strong> - Downloaded to {file.stored_filename}</li>' for file in files)}
            {"</ul>" if files else ""}
            
            <p>Visit the dashboard for more details.</p>
        </body>
        </html>
        """
        
        message.attach(MIMEText(body, "html"))
        
        # Send the email
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_SERVER,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME,
            password=settings.SMTP_PASSWORD,
            use_tls=True
        )
        
        # Create a notification record with status "sent"
        notification = Notification(
            change_id=change.id,
            notification_type="email",
            status="sent"
        )
        db.add(notification)
        db.commit()
        
        logger.info(f"Email notification sent for page {page.name or page.url}")
        return True
        
    except Exception as e:
        error_message = str(e)
        logger.error(f"Error sending email notification: {error_message}")
        
        # Create a notification record with status "failed"
        notification = Notification(
            change_id=change.id,
            notification_type="email",
            status="failed",
            error_message=error_message
        )
        db.add(notification)
        db.commit()
        
        return False 