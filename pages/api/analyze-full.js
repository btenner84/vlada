import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import fetch from 'node-fetch';
import {
  detectFileType,
  fetchFileBuffer,
  extractTextFromPDF,
  extractTextFromImage,
  processWithLLM
} from '../../utils/documentProcessing';

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

// Function to analyze a document
const analyzeDocument = async (fileUrl, userId, billId) => {
  console.log(`Starting document analysis for bill ${billId} from user ${userId}`);
  console.log(`File URL: ${fileUrl}`);
  
  try {
    // Fetch the file buffer
    console.log('Fetching file buffer...');
    const fileBuffer = await fetchFileBuffer(fileUrl);
    console.log(`File buffer fetched, size: ${fileBuffer.length} bytes`);
    
    // Detect file type
    console.log('Detecting file type...');
    const fileType = await detectFileType(fileUrl);
    console.log(`File type detected: ${fileType}`);
    
    // Extract text based on file type
    console.log('Extracting text...');
    let extractedText = '';
    
    if (fileType === 'pdf') {
      extractedText = await extractTextFromPDF(fileBuffer);
    } else if (fileType === 'image') {
      extractedText = await extractTextFromImage(fileBuffer);
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
    
    console.log(`Text extracted, length: ${extractedText.length} characters`);
    console.log(`First 100 chars: ${extractedText.substring(0, 100)}`);
    
    // First verify if it's a medical bill
    console.log('Verifying if document is a medical bill...');
    const verificationResult = await processWithLLM(extractedText, true);
    console.log('Verification result:', verificationResult);

    let extractedData = null;
    if (verificationResult.isMedicalBill) {
      // Then extract data if it is a medical bill
      console.log('Document is a medical bill, extracting data...');
      extractedData = await processWithLLM(extractedText, false);
      console.log('Data extraction complete');
    }
    
    // Return the results
    return {
      success: true,
      extractedText,
      extractedData,
      fileType,
      isMedicalBill: verificationResult.isMedicalBill,
      confidence: verificationResult.confidence,
      reason: verificationResult.reason
    };
  } catch (error) {
    console.error('Error analyzing document:', error);
    throw error;
  }
};

export default async function handler(req, res) {
  console.log('API Route: /api/analyze-full - Request received');
  console.log('Request Method:', req.method);
  
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
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    console.log(`Rejecting ${req.method} request - only POST is allowed`);
    res.setHeader('Allow', ['POST', 'OPTIONS']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  try {
    // Check if Firebase Admin SDK is initialized
    if (!adminDb || !adminStorage) {
      console.error('Firebase Admin SDK not initialized');
      return res.status(500).json({ error: 'Firebase Admin SDK not initialized' });
    }
    
    // Get the request body
    const { fileUrl, userId, billId } = req.body;
    
    if (!fileUrl) {
      console.log('Missing required parameter: fileUrl');
      return res.status(400).json({ error: 'Missing required parameter: fileUrl' });
    }
    
    console.log('Request parameters:', { fileUrl, userId, billId });
    
    // Verify document ownership only if userId and billId are provided
    if (userId && billId) {
      console.log('Verifying document ownership');
      try {
        const billDoc = await adminDb.collection('bills').doc(billId).get();
        if (!billDoc.exists || billDoc.data().userId !== userId) {
          console.log('Unauthorized access attempt:', { billExists: billDoc.exists, requestUserId: userId, docUserId: billDoc.exists ? billDoc.data().userId : null });
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
    
    // Analyze the document
    console.log('Starting document analysis');
    const result = await analyzeDocument(fileUrl, userId || 'client-request', billId || 'client-request');
    
    // Return the results
    console.log('Analysis complete, returning results');
    res.status(200).json(result);
    
  } catch (error) {
    console.error('Error in analyze-full endpoint:', error);
    res.status(500).json({ error: error.message || 'Error analyzing document' });
  }
} 