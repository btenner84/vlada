import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

# Add the app directory to the path so we can import from it
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.config.settings import settings
from app.db.models import Base, User
from app.api.auth import get_password_hash

# Create engine
engine = create_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    # Create tables
    Base.metadata.create_all(bind=engine)
    
    # Create a session
    db = SessionLocal()
    
    # Check if admin user exists
    admin = db.query(User).filter(User.email == settings.ADMIN_EMAIL).first()
    
    if not admin:
        # Create admin user
        admin_user = User(
            email=settings.ADMIN_EMAIL,
            hashed_password=get_password_hash(settings.ADMIN_PASSWORD),
            is_active=True
        )
        db.add(admin_user)
        db.commit()
        print(f"Admin user created: {settings.ADMIN_EMAIL}")
    else:
        print(f"Admin user already exists: {settings.ADMIN_EMAIL}")
    
    db.close()

# Ensure downloads directory exists
os.makedirs("data/downloads", exist_ok=True)

if __name__ == "__main__":
    print("Initializing database...")
    init_db()
    print("Database initialized successfully") 