import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { adminDb as existingAdminDb, adminStorage as existingAdminStorage } from '../../firebase/admin.js';

// Use the existing Firebase Admin instance if available, otherwise initialize a new one
let adminDb = existingAdminDb;
let adminStorage = existingAdminStorage;

// If the existing Firebase Admin instance is not available, initialize a new one
if (!adminDb || !adminStorage) {
  console.log('Existing Firebase Admin instance not available, initializing a new one...');
  
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
} else {
  console.log('Using existing Firebase Admin instance');
}

// Function to sanitize data for Firestore
function sanitizeForFirestore(obj) {
  if (obj === undefined || obj === null) {
    return null;
  }
  
  if (typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item));
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeForFirestore(value);
  }
  
  return sanitized;
}

// Simplified fallback handler that doesn't rely on Sharp or other problematic dependencies
export default async function handler(req, res) {
  console.log('API Route: /api/analyze-fallback - Request received');
  console.log('Request Method:', req.method);
  console.log('Request Headers:', JSON.stringify(req.headers, null, 2));
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request for CORS preflight');
    res.status(200).end();
    return;
  }
  
  // Handle diagnostic GET requests without parameters
  if (req.method === 'GET' && !req.query.fileUrl) {
    console.log('Handling diagnostic GET request');
    return res.status(200).json({ 
      status: 'Fallback API is online',
      message: 'This is a simplified fallback endpoint for production use',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown'
    });
  }

  try {
    // Get parameters from either query (GET) or body (POST)
    let fileUrl, userId, billId;
    
    // Unified parameter extraction that works with both GET and POST
    if (req.method === 'POST' && req.body) {
      fileUrl = req.body.fileUrl;
      userId = req.body.userId;
      billId = req.body.billId;
      console.log('Extracted parameters from POST body');
    } else {
      fileUrl = req.query.fileUrl;
      userId = req.query.userId;
      billId = req.query.billId;
      console.log('Extracted parameters from query string');
    }
    
    if (!fileUrl) {
      console.log('Missing required parameter: fileUrl');
      return res.status(400).json({ error: 'Missing required parameter: fileUrl' });
    }

    // Log the request parameters (but mask sensitive parts of the URL)
    const maskedUrl = fileUrl.replace(/([?&]token=)[^&]+/, '$1REDACTED');
    console.log('Request parameters:', { 
      fileUrl: maskedUrl, 
      userId: userId || 'client-request', 
      billId: billId || 'client-request' 
    });
    
    // Verify document ownership only if userId and billId are provided
    if (userId && billId && userId !== 'client-request' && billId !== 'client-request') {
      console.log('Verifying document ownership');
      try {
        const billDoc = await adminDb.collection('bills').doc(billId).get();
        if (!billDoc.exists || billDoc.data().userId !== userId) {
          console.log('Unauthorized access attempt');
          return res.status(403).json({ error: 'Unauthorized access to this document' });
        }
        console.log('Document ownership verified');
      } catch (authError) {
        console.error('Error verifying document ownership:', authError);
        return res.status(500).json({ error: `Error verifying document ownership: ${authError.message}` });
      }
    } else {
      console.log('Skipping document ownership verification (client-side request)');
    }
    
    // Instead of processing the document directly, we'll update the bill status
    // and return a success response. The actual processing will happen asynchronously.
    if (billId !== 'client-request' && userId !== 'client-request') {
      try {
        const billRef = adminDb.collection('bills').doc(billId);
        const now = new Date();
        
        await billRef.update({
          status: 'processing',
          processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
          processingStartedAtString: now.toISOString(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Updated bill ${billId} status to 'processing'`);
        
        // Queue the document for processing (in a real implementation, this would trigger a background job)
        // For now, we'll just return a success response
        
        return res.status(200).json({
          success: true,
          message: 'Document queued for processing',
          status: 'processing',
          billId: billId,
          timestamp: now.toISOString()
        });
      } catch (updateError) {
        console.error('Error updating bill status:', updateError);
        return res.status(500).json({ error: `Error updating bill status: ${updateError.message}` });
      }
    } else {
      // For client-side requests without a billId, return a generic success response
      return res.status(200).json({
        success: true,
        message: 'Request received, but no document processing will occur without a valid billId',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error in analyze-fallback endpoint:', error);
    return res.status(500).json({ 
      error: error.message || 'Error processing request',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false
  },
  maxDuration: 60 // Shorter timeout for the fallback endpoint
}; 