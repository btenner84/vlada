# VladaHealth - Medical Bill Analysis

## Google Cloud Vision OCR Setup

To use the Google Cloud Vision OCR integration:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select your existing project
3. **Important: Enable billing for your project**
   - Navigate to "Billing" in the left sidebar
   - Link your project to a billing account or create a new billing account
   - Google Cloud Vision API is not free and requires billing to be enabled
   - You'll be charged based on usage (currently ~$1.50 per 1000 images)
   - **Without billing enabled, all API calls will fail with a 403 error**
4. Enable the Vision API for your project:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Vision API" and enable it
5. Create a service account:
   - Go to "IAM & Admin" > "Service Accounts"
   - Click "Create Service Account"
   - Give it a name like "vision-ocr-service"
   - Grant it the "Cloud Vision API User" role
6. Create and download the JSON key:
   - Select your new service account
   - Go to the "Keys" tab
   - Click "Add Key" > "Create new key"
   - Choose JSON format and download
7. Configure authentication:
   - Option 1: Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to point to the JSON key file
   ```
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your-project-credentials.json"
   ```
   - Option 2: Add the credentials to your .env.local file:
   ```
   GOOGLE_VISION_CREDENTIALS={"type":"service_account","project_id":"your-project",...}
   ```

## Running the app

Testing webhook deployment - Triggered at: March 2, 2024 3:30 PM EST
Webhook test after project recreation.

Fight back against medical bills with AI-powered tools.
