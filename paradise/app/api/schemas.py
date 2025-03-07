from pydantic import BaseModel, HttpUrl, EmailStr, validator
from typing import Optional, List, Dict, Any
from datetime import datetime
import re

from app.db.models import MonitoringFrequency


class UserBase(BaseModel):
    email: EmailStr


class UserCreate(UserBase):
    password: str


class User(UserBase):
    id: int
    is_active: bool
    created_at: datetime
    
    class Config:
        orm_mode = True


class MonitoredPageBase(BaseModel):
    name: str
    url: HttpUrl
    css_selector: Optional[str] = None
    frequency: str = MonitoringFrequency.HOURLY.value
    is_active: bool = True
    
    @validator('frequency')
    def validate_frequency(cls, v):
        if v not in [freq.value for freq in MonitoringFrequency]:
            raise ValueError(f"Invalid frequency. Must be one of: {', '.join([freq.value for freq in MonitoringFrequency])}")
        return v


class MonitoredPageCreate(MonitoredPageBase):
    pass


class MonitoredPageUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[HttpUrl] = None
    css_selector: Optional[str] = None
    frequency: Optional[str] = None
    is_active: Optional[bool] = None
    
    @validator('frequency')
    def validate_frequency(cls, v):
        if v is not None and v not in [freq.value for freq in MonitoringFrequency]:
            raise ValueError(f"Invalid frequency. Must be one of: {', '.join([freq.value for freq in MonitoringFrequency])}")
        return v


class MonitoredPage(MonitoredPageBase):
    id: int
    last_checked_at: Optional[datetime] = None
    last_changed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    class Config:
        orm_mode = True


class PageChangeBase(BaseModel):
    page_id: int
    change_type: str
    details: Optional[str] = None


class PageChange(PageChangeBase):
    id: int
    detected_at: datetime
    
    class Config:
        orm_mode = True


class DownloadedFileBase(BaseModel):
    page_id: int
    change_id: Optional[int] = None
    original_url: str
    original_filename: str
    stored_filename: str
    file_size: Optional[int] = None
    content_type: Optional[str] = None
    content_hash: Optional[str] = None


class DownloadedFile(DownloadedFileBase):
    id: int
    downloaded_at: datetime
    
    class Config:
        orm_mode = True


class NotificationBase(BaseModel):
    change_id: int
    notification_type: str
    status: str
    error_message: Optional[str] = None


class Notification(NotificationBase):
    id: int
    sent_at: Optional[datetime] = None
    created_at: datetime
    
    class Config:
        orm_mode = True


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str


class PageCheckRequest(BaseModel):
    page_id: int


class PageCheckResponse(BaseModel):
    success: bool
    message: str
    result: Optional[Dict[str, Any]] = None


# Smart extraction schemas
class SmartExtractionRequest(BaseModel):
    url: HttpUrl
    context: str
    screenshot: Optional[str] = None  # Base64 encoded image
    
class ExtractionConfirmation(BaseModel):
    confirmed: bool
    page_id: Optional[int] = None
    
class SmartExtractionResponse(BaseModel):
    success: bool
    message: str
    extraction_plan: str
    page_id: Optional[int] = None
    preview: Optional[Dict[str, Any]] = None 