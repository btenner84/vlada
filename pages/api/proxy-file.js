import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin if it hasn't been initialized yet
let adminDb;
let adminStorage;

if (!getApps().length) {
  console.log('Initializing Firebase Admin SDK...');
  try {
    // Make sure to properly format the private key
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;
    
    console.log('Firebase Project ID:', process.env.FIREBASE_PROJECT_ID);
    console.log('Firebase Client Email:', process.env.FIREBASE_CLIENT_EMAIL);
    console.log('Firebase Private Key (first 20 chars):', privateKey ? privateKey.substring(0, 20) + '...' : 'undefined');
    
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
    // Don't throw here, we'll handle the error in the handler
  }
} else {
  console.log('Firebase Admin SDK already initialized');
  adminDb = getFirestore();
  adminStorage = getStorage();
}

export default async function handler(req, res) {
  console.log('API Route: /api/proxy-file - Request received');
  console.log('Request Method:', req.method);
  console.log('Request Query:', req.query);
  
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
      
      const file = bucket.file(decodedPath);
      console.log('File reference created:', file.name);
      
      // Check if the file exists
      console.log('Checking if file exists...');
      const [exists] = await file.exists();
      if (!exists) {
        console.log('File not found:', decodedPath);
        return res.status(404).json({ error: 'File not found' });
      }
      console.log('File exists');
      
      // Get the file metadata to determine content type
      console.log('Getting file metadata...');
      const [metadata] = await file.getMetadata();
      console.log('File metadata:', {
        contentType: metadata.contentType,
        size: metadata.size,
        updated: metadata.updated
      });
      
      const contentType = metadata.contentType || 'application/octet-stream';
      
      // Set the content type header
      res.setHeader('Content-Type', contentType);
      
      // For HEAD requests, just return the headers
      if (req.method === 'HEAD') {
        console.log('HEAD request - returning headers only');
        res.status(200).end();
        return;
      }
      
      // For GET requests, stream the file
      console.log('Streaming file to response');
      const fileStream = file.createReadStream();
      
      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        // Only send response if headers haven't been sent yet
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming file' });
        }
      });
      
      fileStream.on('end', () => {
        console.log('File streaming completed');
      });
      
      fileStream.pipe(res);
    } catch (storageError) {
      console.error('Firebase Storage error:', storageError);
      return res.status(500).json({ error: `Firebase Storage error: ${storageError.message}` });
    }
  } catch (error) {
    console.error('Error proxying file:', error);
    return res.status(500).json({ error: error.message || 'Error proxying file' });
  }
} 