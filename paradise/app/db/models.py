from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Text, Enum, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from datetime import datetime
from app.db.database import Base


class MonitoringFrequency(enum.Enum):
    FIVE_MINUTES = "5_minutes"
    FIFTEEN_MINUTES = "15_minutes"
    THIRTY_MINUTES = "30_minutes"
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class MonitoredPage(Base):
    __tablename__ = "monitored_pages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    url = Column(String, unique=True, index=True)
    css_selector = Column(String, nullable=True)  # Optional CSS selector to focus on specific content
    frequency = Column(String, default=MonitoringFrequency.HOURLY.value)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_changed_at = Column(DateTime(timezone=True), nullable=True)
    last_content_hash = Column(String, nullable=True)
    last_etag = Column(String, nullable=True)
    last_modified = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    changes = relationship("PageChange", back_populates="page", cascade="all, delete-orphan")
    files = relationship("DownloadedFile", back_populates="page", cascade="all, delete-orphan")


class PageChange(Base):
    __tablename__ = "page_changes"

    id = Column(Integer, primary_key=True, index=True)
    page_id = Column(Integer, ForeignKey("monitored_pages.id"))
    detected_at = Column(DateTime(timezone=True), server_default=func.now())
    change_type = Column(String)  # e.g., "content_changed", "new_files", etc.
    details = Column(Text, nullable=True)  # JSON or text description of changes
    
    # Relationships
    page = relationship("MonitoredPage", back_populates="changes")
    files = relationship("DownloadedFile", back_populates="change", cascade="all, delete-orphan")


class DownloadedFile(Base):
    __tablename__ = "downloaded_files"

    id = Column(Integer, primary_key=True, index=True)
    page_id = Column(Integer, ForeignKey("monitored_pages.id"))
    change_id = Column(Integer, ForeignKey("page_changes.id"), nullable=True)
    original_url = Column(String)
    original_filename = Column(String)
    stored_filename = Column(String)  # Full path to the stored file
    file_size = Column(Integer, nullable=True)
    content_type = Column(String, nullable=True)
    content_hash = Column(String, nullable=True)
    downloaded_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    page = relationship("MonitoredPage", back_populates="files")
    change = relationship("PageChange", back_populates="files")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    change_id = Column(Integer, ForeignKey("page_changes.id"))
    notification_type = Column(String)  # "email", "sms", etc.
    status = Column(String)  # "pending", "sent", "failed"
    sent_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    change = relationship("PageChange") 