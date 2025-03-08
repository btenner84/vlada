// Test script for Google Cloud Vision API
require('dotenv').config({ path: '.env.local' }); // Load environment variables from .env.local file
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const fetch = require('node-fetch');

// Log environment variables (first few characters only for security)
console.log('Checking environment variables:');
console.log(`GOOGLE_CLOUD_CLIENT_EMAIL: ${process.env.GOOGLE_CLOUD_CLIENT_EMAIL ? 'Set (' + process.env.GOOGLE_CLOUD_CLIENT_EMAIL.substring(0, 10) + '...)' : 'Not set'}`);
console.log(`GOOGLE_CLOUD_PRIVATE_KEY: ${process.env.GOOGLE_CLOUD_PRIVATE_KEY ? 'Set (Key exists)' : 'Not set'}`);
console.log(`GOOGLE_CLOUD_PROJECT_ID: ${process.env.GOOGLE_CLOUD_PROJECT_ID ? 'Set (' + process.env.GOOGLE_CLOUD_PROJECT_ID + ')' : 'Not set'}`);

async function testVisionAPI() {
  try {
    console.log('Initializing Google Cloud Vision client...');
    
    // Format private key correctly
    const privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n');
    
    // Initialize client with explicit credentials
    const visionClient = new ImageAnnotatorClient({
      credentials: {
        client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
        private_key: privateKey,
        project_id: process.env.GOOGLE_CLOUD_PROJECT_ID
      }
    });
    
    console.log('Vision client initialized successfully');
    
    // Test with a sample image URL
    const imageUrl = 'https://cloud.google.com/vision/docs/images/sign_text.png';
    console.log(`Testing with sample image: ${imageUrl}`);
    
    // Fetch the image
    const response = await fetch(imageUrl);
    const imageBuffer = await response.arrayBuffer();
    
    // Create request
    const request = {
      requests: [
        {
          image: {
            content: Buffer.from(imageBuffer).toString('base64')
          },
          features: [
            {
              type: 'TEXT_DETECTION'
            }
          ]
        }
      ]
    };
    
    console.log('Sending request to Google Vision API...');
    const [apiResponse] = await visionClient.batchAnnotateImages(request);
    
    if (!apiResponse || !apiResponse.responses || apiResponse.responses.length === 0) {
      console.error('Empty response from Google Vision API');
      return;
    }
    
    const textAnnotations = apiResponse.responses[0]?.textAnnotations;
    
    if (!textAnnotations || textAnnotations.length === 0) {
      console.error('No text detected in the image');
      return;
    }
    
    // The first annotation contains the entire extracted text
    const extractedText = textAnnotations[0].description;
    console.log('Text detected successfully:');
    console.log(extractedText);
    
    console.log('Google Cloud Vision API test completed successfully!');
  } catch (error) {
    console.error('Error testing Google Cloud Vision API:', error);
  }
}

// Run the test
testVisionAPI(); 