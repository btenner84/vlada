from pydantic_settings import BaseSettings
from pydantic import PostgresDsn, RedisDsn, EmailStr, validator, AnyUrl
from typing import Optional, Union
import os
from pathlib import Path


class Settings(BaseSettings):
    # Database
    DATABASE_URL: Union[PostgresDsn, str]

    # Redis
    REDIS_URL: Union[RedisDsn, str]

    # Security
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Application
    ENVIRONMENT: str
    ADMIN_EMAIL: EmailStr
    ADMIN_PASSWORD: str

    # Email Notifications
    SMTP_SERVER: Optional[str] = None
    SMTP_PORT: Optional[int] = None
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_EMAIL: Optional[EmailStr] = None

    # SMS Notifications (Twilio)
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_FROM_NUMBER: Optional[str] = None
    ADMIN_PHONE_NUMBER: Optional[str] = None

    # File Storage
    DOWNLOAD_DIR: str = "/app/data/downloads"
    
    # OpenAI API
    OPENAI_API_KEY: Optional[str] = None

    @validator("DOWNLOAD_DIR")
    def create_download_dir(cls, v):
        download_dir = Path(v)
        download_dir.mkdir(parents=True, exist_ok=True)
        return str(download_dir)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


# Create global settings instance
settings = Settings() 