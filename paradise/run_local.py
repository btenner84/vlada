import os
import sys
import uvicorn
from pathlib import Path

# Ensure the app directory is in the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Ensure downloads directory exists
os.makedirs("data/downloads", exist_ok=True)

if __name__ == "__main__":
    print("Starting the application...")
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True) 