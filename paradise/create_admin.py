#!/usr/bin/env python
"""
Create the admin user for the Web Monitoring & File Extraction Tool.
"""
import sys
from loguru import logger
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import User
from app.api.auth import get_password_hash
from app.config.settings import settings


# Configure logger
logger.remove()
logger.add(
    sys.stdout,
    colorize=True,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO"
)


def create_admin_user():
    """Create the admin user if it doesn't exist."""
    db = SessionLocal()
    try:
        # Check if admin user already exists
        admin_user = db.query(User).filter(User.email == settings.ADMIN_EMAIL).first()
        if admin_user:
            logger.info(f"Admin user already exists: {settings.ADMIN_EMAIL}")
            return
        
        # Create admin user
        admin_user = User(
            email=settings.ADMIN_EMAIL,
            hashed_password=get_password_hash(settings.ADMIN_PASSWORD),
            is_active=True
        )
        db.add(admin_user)
        db.commit()
        logger.info(f"Created admin user: {settings.ADMIN_EMAIL}")
    finally:
        db.close()


if __name__ == "__main__":
    create_admin_user() 