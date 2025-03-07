import { getFirebaseAdmin } from '../../firebase/admin';

// This is a mock version of the Google Vision API endpoint
// Use this for testing while you set up billing on your Google Cloud project

export default async function handler(req, res) {
  console.log('Google Vision MOCK API route called with method:', req.method);
  
  // Check for POST request
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Request body:', JSON.stringify(req.body).substring(0, 200) + '...');
    
    // Get Firebase Admin
    const { auth } = getFirebaseAdmin();
    console.log('Firebase Auth service retrieved');
    
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('No Authorization header or incorrect format');
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    
    const token = authHeader.split('Bearer ')[1];
    console.log('Token extracted from Authorization header');
    
    try {
      // Verify the token
      const decodedToken = await auth.verifyIdToken(token);
      console.log('Token verified successfully for UID:', decodedToken.uid);
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    const { fileUrl } = req.body;
    if (!fileUrl) {
      console.log('No fileUrl provided in request body');
      return res.status(400).json({ error: 'File URL is required' });
    }
    console.log('File URL:', fileUrl.substring(0, 50) + '...');

    // This is where the real API would call Google Vision
    // Instead, we'll return mock data
    
    // Return mock OCR results
    const mockData = {
      extractedText: "This is mock text extracted by the Google Vision API mock.\n\nPatient: John Doe\nDate of Service: 01/15/2023\nProvider: Medical Clinic\nAmount Due: $123.45\n\nService 1: Office Visit - $75.00\nService 2: Lab Test - $48.45\n\nInsurance: ABC Insurance\nPolicy #: 123456789\n\nThank you for your business!",
      confidence: 0.95,
      tables: [
        {
          rows: [
            ["Service", "Description", "Amount"],
            ["1", "Office Visit", "$75.00"],
            ["2", "Lab Test", "$48.45"]
          ]
        }
      ],
      processingMethod: 'google-vision-mock',
      blocks: 15,
      _mockNotice: "This is mock data. Enable billing on your Google Cloud project to use the real Google Vision API."
    };
    
    console.log('Sending successful response with mock OCR results');
    return res.status(200).json(mockData);
  } catch (error) {
    console.error('Error processing with Google Vision Mock:', error);
    console.error('Error stack trace:', error.stack);
    return res.status(500).json({ 
      error: 'Mock OCR processing failed', 
      message: error.message,
      stack: error.stack,
      processingMethod: 'google-vision-mock-failed'
    });
  }
} 