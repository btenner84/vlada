# VladaHealth

Testing webhook deployment - Triggered at: March 2, 2024 3:30 PM EST
Webhook test after project recreation.

Fight back against medical bills with AI-powered tools.

## Enhanced AI Medical Bill Analysis

This application now includes an enhanced AI analysis pipeline for medical bills. The system uses OCR via Google Cloud Vision API to extract text, then sends this text to OpenAI's API for advanced analysis and structured data extraction.

### Environment Variables

For the enhanced AI analysis to work, make sure to set the following environment variables:

```
# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_STORAGE_BUCKET=your-storage-bucket

# Google Cloud Vision API
GOOGLE_CLOUD_PROJECT_ID=your-google-cloud-project-id
GOOGLE_CLOUD_CLIENT_EMAIL=your-google-cloud-client-email
GOOGLE_CLOUD_PRIVATE_KEY=your-google-cloud-private-key

# OpenAI API
OPENAI_API_KEY=your-openai-api-key
```

### Analysis Flow

1. Document is uploaded to Firebase Storage
2. Text is extracted using Google Cloud Vision API
3. Initial verification determines if the document is a medical bill
4. Enhanced AI analysis uses OpenAI to extract structured data:
   - Patient information
   - Provider information
   - Billing details
   - Services rendered and their costs
   - Insurance information
5. Data is stored in Firestore and displayed to the user
