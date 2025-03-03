import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin if it hasn't been initialized yet
let adminDb;
let adminStorage;

if (!getApps().length) {
  console.log('Initializing Firebase Admin SDK...');
  try {
    // Make sure all required environment variables are present
    const requiredEnvVars = [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY',
      'FIREBASE_STORAGE_BUCKET'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
    
    // Format the private key, handling both raw and escaped formats
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    
    // If the key is wrapped in quotes, remove them
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    
    // Replace escaped newlines with actual newlines
    privateKey = privateKey.replace(/\\n/g, '\n');
    
    // Validate the key format
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
      console.error('Invalid private key format');
      throw new Error('Invalid private key format');
    }
    
    console.log('Firebase configuration:', {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKeyLength: privateKey.length,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      privateKeyValid: privateKey.includes('-----BEGIN PRIVATE KEY-----')
    });
    
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    
    adminDb = getFirestore(app);
    adminStorage = getStorage(app);
    console.log('Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
  }
} else {
  console.log('Firebase Admin SDK already initialized');
  adminDb = getFirestore();
  adminStorage = getStorage();
}

export default async function handler(req, res) {
  console.log('API Route: /api/proxy-file - Request received');
  console.log('Request Method:', req.method);
  console.log('Request Query:', JSON.stringify(req.query));
  console.log('Request Headers:', JSON.stringify(req.headers));
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request for CORS preflight');
    res.status(200).end();
    console.log('OPTIONS request handled successfully');
    return;
  }
  
  // Only allow GET and HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    console.log(`Rejecting ${req.method} request - only GET and HEAD are allowed`);
    res.setHeader('Allow', ['GET', 'HEAD', 'OPTIONS']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  try {
    // Check if Firebase Admin SDK is initialized
    if (!adminStorage) {
      console.error('Firebase Admin SDK not initialized');
      return res.status(500).json({ error: 'Firebase Admin SDK not initialized' });
    }
    
    // Get the file path and authentication info from the query parameters
    const { path, userId, billId } = req.query;
    
    if (!path) {
      console.log('Missing file path parameter');
      return res.status(400).json({ error: 'Missing file path parameter' });
    }
    
    console.log('Requested file path:', path);
    
    // If userId and billId are provided, verify ownership
    if (userId && billId) {
      console.log('Verifying document ownership');
      try {
        // Check the specific bill document
        const billDoc = await adminDb.collection('bills').doc(billId).get();
        
        if (!billDoc.exists) {
          console.log('Bill document not found:', billId);
          return res.status(404).json({ error: 'Document not found' });
        }
        
        if (billDoc.data().userId !== userId) {
          console.log('Unauthorized access attempt:', {
            requestedBillId: billId,
            requestUserId: userId,
            actualUserId: billDoc.data().userId
          });
          return res.status(403).json({ error: 'Unauthorized access to this document' });
        }
        
        console.log('Document ownership verified');
      } catch (authError) {
        console.error('Error verifying document ownership:', authError);
        return res.status(500).json({ error: 'Error verifying document ownership' });
      }
    }
    
    try {
      // Get the file from Firebase Storage
      const bucket = adminStorage.bucket();
      console.log('Storage bucket:', bucket.name);
      
      // Decode the path and remove any leading slashes
      const decodedPath = decodeURIComponent(path).replace(/^\/+/, '');
      console.log('Decoded path:', decodedPath);
      
      // Handle query parameters in the path
      const cleanPath = decodedPath.split('?')[0];
      console.log('Clean path:', cleanPath);
      
      const file = bucket.file(cleanPath);
      console.log('File reference created:', file.name);
      
      // Check if the file exists
      console.log('Checking if file exists...');
      const [exists] = await file.exists();
      if (!exists) {
        console.log('File not found:', cleanPath);
        return res.status(404).json({ 
          error: 'File not found',
          path: cleanPath,
          bucket: bucket.name
        });
      }
      console.log('File exists');
      
      // Get the file metadata to determine content type
      console.log('Getting file metadata...');
      const [metadata] = await file.getMetadata();
      console.log('File metadata:', {
        contentType: metadata.contentType,
        size: metadata.size,
        updated: metadata.updated,
        name: metadata.name,
        bucket: metadata.bucket
      });
      
      const contentType = metadata.contentType || 'application/octet-stream';
      
      // Set response headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Disposition', 'inline');
      
      // For HEAD requests, just return the headers
      if (req.method === 'HEAD') {
        console.log('HEAD request - returning headers only');
        res.status(200).end();
        return;
      }
      
      // For GET requests, stream the file
      console.log('Streaming file to response');
      const fileStream = file.createReadStream({
        validation: false // Skip MD5 validation for faster streaming
      });
      
      // Handle stream errors
      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        console.error('Stream error details:', {
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        // Only send response if headers haven't been sent yet
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Error streaming file',
            details: error.message,
            code: error.code
          });
        }
      });
      
      fileStream.on('end', () => {
        console.log('File streaming completed successfully');
      });
      
      // Pipe the file stream to the response
      fileStream.pipe(res).on('error', (error) => {
        console.error('Error piping stream to response:', error);
      });
      
    } catch (storageError) {
      console.error('Firebase Storage error:', storageError);
      console.error('Storage error details:', {
        message: storageError.message,
        code: storageError.code,
        stack: storageError.stack
      });
      return res.status(500).json({ 
        error: 'Firebase Storage error',
        details: storageError.message,
        code: storageError.code
      });
    }
  } catch (error) {
    console.error('Error proxying file:', error);
    return res.status(500).json({ error: error.message || 'Error proxying file' });
  }
} 