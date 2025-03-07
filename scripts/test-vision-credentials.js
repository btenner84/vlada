// Simple script to test Google Vision API credentials

const { ImageAnnotatorClient } = require('@google-cloud/vision');
const path = require('path');
const fs = require('fs');

async function testVisionCredentials() {
  console.log('=============== GOOGLE VISION CREDENTIALS TEST ===============');
  console.log('Current Working Directory:', process.cwd());
  console.log('ENV VAR - GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS || 'Not set');

  try {
    // Locate credentials file
    const credentialsPath = path.join(process.cwd(), 'credentials/google-vision-key.json');
    console.log('Looking for credentials at:', credentialsPath);
    
    if (fs.existsSync(credentialsPath)) {
      console.log('Credentials file found!');
      console.log('File size:', fs.statSync(credentialsPath).size, 'bytes');
      
      try {
        // Read and parse the credentials file
        const credentialContent = fs.readFileSync(credentialsPath, 'utf8');
        const firstFewChars = credentialContent.slice(0, 50);
        console.log('First few chars of credentials file:', firstFewChars);
        
        // Parse to verify it's valid JSON
        const credentials = JSON.parse(credentialContent);
        console.log('Credentials JSON is valid');
        console.log('Project ID:', credentials.project_id);
        console.log('Client Email:', credentials.client_email);
        
        // Initialize the client with explicit credentials
        console.log('Initializing Google Vision client with explicit credentials...');
        const visionClient = new ImageAnnotatorClient({ credentials });
        console.log('Vision client initialized successfully!');
        
        // Test a simple API call
        console.log('Testing a simple API call...');
        const [result] = await visionClient.labelDetection({
          image: { content: fs.readFileSync(path.join(__dirname, 'test-image.png')) }
        });
        
        console.log('API call successful!');
        console.log('Labels detected:', result.labelAnnotations.map(label => label.description).join(', '));
        console.log('Test completed successfully! ✅');
      } catch (error) {
        console.error('Error during test:', error);
        console.error('Full error:', JSON.stringify(error, null, 2));
        console.log('Test failed! ❌');
      }
    } else {
      console.error('Credentials file not found at:', credentialsPath);
      console.log('Test failed! ❌');
    }
  } catch (error) {
    console.error('Error:', error);
    console.log('Test failed! ❌');
  }
}

// Run the test
testVisionCredentials().catch(console.error); 