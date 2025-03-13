// Google Cloud Vision client initialization
import vision from '@google-cloud/vision';

// Helper function to format the private key correctly
const formatPrivateKey = (key) => {
  if (!key) return '';
  
  // Remove any surrounding quotes
  let formattedKey = key.trim();
  if ((formattedKey.startsWith('"') && formattedKey.endsWith('"')) || 
      (formattedKey.startsWith("'") && formattedKey.endsWith("'"))) {
    formattedKey = formattedKey.slice(1, -1);
  }
  
  // If the key doesn't contain newlines, add them
  if (!formattedKey.includes('\\n') && !formattedKey.includes('\n')) {
    return formattedKey;
  }
  
  // Replace literal \n with actual newlines
  formattedKey = formattedKey.replace(/\\n/g, '\n');
  return formattedKey;
};

// Initialize the Vision client
const initVisionClient = () => {
  try {
    // Check for required environment variables
    if (!process.env.GOOGLE_CLOUD_CLIENT_EMAIL || 
        !process.env.GOOGLE_CLOUD_PRIVATE_KEY || 
        !process.env.GOOGLE_CLOUD_PROJECT_ID) {
      console.error('Missing required Google Cloud Vision environment variables');
      return null;
    }
    
    // Format the private key
    const privateKey = formatPrivateKey(process.env.GOOGLE_CLOUD_PRIVATE_KEY);
    
    // Verify key format
    console.log('Private key verification:', {
      startsWithHeader: privateKey.startsWith('-----BEGIN PRIVATE KEY-----'),
      endsWithFooter: privateKey.endsWith('-----END PRIVATE KEY-----'),
      containsNewlines: privateKey.includes('\n'),
      totalLines: privateKey.split('\n').length,
      firstLine: privateKey.split('\n')[0],
      lastLine: privateKey.split('\n').slice(-1)[0]
    });
    
    // Create the credentials object
    const credentials = {
      client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      private_key: privateKey,
      project_id: process.env.GOOGLE_CLOUD_PROJECT_ID
    };
    
    // Log sanitized credentials for debugging (without the actual private key)
    console.log('Vision client credentials:', {
      client_email: credentials.client_email,
      project_id: credentials.project_id,
      private_key_length: credentials.private_key ? credentials.private_key.length : 0
    });
    
    // Initialize the Vision client
    return new vision.ImageAnnotatorClient({
      credentials: credentials
    });
  } catch (error) {
    console.error('Error initializing Vision client:', error);
    return null;
  }
};

// Export the Vision client
const visionClient = initVisionClient();

export { visionClient }; 