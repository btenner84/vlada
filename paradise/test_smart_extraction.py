import requests
import json
import sys
import os

# Add the app directory to the path so we can import from it
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Base URL for the API
BASE_URL = "http://localhost:8000"

def get_token():
    """Get an authentication token"""
    from app.config.settings import settings
    
    response = requests.post(
        f"{BASE_URL}/token",
        data={
            "username": settings.ADMIN_EMAIL,
            "password": settings.ADMIN_PASSWORD
        }
    )
    
    if response.status_code == 200:
        return response.json()["access_token"]
    else:
        print(f"Failed to get token: {response.text}")
        return None

def test_smart_extraction(token, url, context):
    """Test the smart extraction endpoint"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    data = {
        "url": url,
        "context": context
    }
    
    response = requests.post(
        f"{BASE_URL}/api/smart-extract",
        headers=headers,
        json=data
    )
    
    if response.status_code == 200:
        result = response.json()
        print("Smart Extraction Result:")
        print(json.dumps(result, indent=2))
        return result
    else:
        print(f"Failed to extract: {response.text}")
        return None

def confirm_extraction(token, extraction_id, confirmed_data):
    """Confirm the extraction"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    data = {
        "extraction_id": extraction_id,
        "confirmed_data": confirmed_data
    }
    
    response = requests.post(
        f"{BASE_URL}/api/confirm-extraction",
        headers=headers,
        json=data
    )
    
    if response.status_code == 200:
        result = response.json()
        print("Confirmation Result:")
        print(json.dumps(result, indent=2))
        return result
    else:
        print(f"Failed to confirm: {response.text}")
        return None

if __name__ == "__main__":
    # Get token
    token = get_token()
    if not token:
        print("Failed to authenticate. Exiting.")
        sys.exit(1)
    
    # Test URL and context
    test_url = "https://example.com"
    test_context = "Extract the main heading and the first paragraph"
    
    # Test smart extraction
    extraction_result = test_smart_extraction(token, test_url, test_context)
    
    if extraction_result:
        # If successful, confirm the extraction
        extraction_id = extraction_result.get("extraction_id")
        
        # Example of confirmed data (this would normally come from user input)
        confirmed_data = {
            "selector": "h1",
            "name": "Example.com Heading",
            "frequency": "daily"
        }
        
        confirm_extraction(token, extraction_id, confirmed_data) 