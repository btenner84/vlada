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

// Export config to ensure proper API handling
export const config = {
  api: {
    bodyParser: true,  // Enable body parsing
    externalResolver: false,  // Handle resolution internally
    responseLimit: false,  // No response size limit
  },
};

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
  console.log(`Starting document analysis for bill ${billId}`);
  
  try {
    // Fetch the file buffer
    const fileBuffer = await fetchFileBuffer(fileUrl);
    if (!fileBuffer) {
      throw new Error('Failed to fetch file');
    }
    
    // Detect file type
    const fileType = await detectFileType(fileUrl);
    if (!fileType) {
      throw new Error('Could not detect file type');
    }
    
    // Extract text based on file type
    let extractedText = '';
    try {
      if (fileType === 'pdf') {
        extractedText = await extractTextFromPDF(fileBuffer);
      } else if (fileType === 'image') {
        extractedText = await extractTextFromImage(fileBuffer);
      } else {
        throw new Error(`Unsupported file type: ${fileType}`);
      }
    } catch (extractError) {
      console.error('Text extraction error:', extractError);
      throw new Error(`Failed to extract text: ${extractError.message}`);
    }
    
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('No text could be extracted from the document');
    }
    
    // Process with LLM
    let verificationResult;
    let extractedData;
    
    try {
      // First verify if it's a medical bill
      verificationResult = await processWithLLM(extractedText, true);
      
      // Extract data regardless of verification result
      extractedData = await processWithLLM(extractedText, false);
    } catch (llmError) {
      console.error('LLM processing error:', llmError);
      throw new Error(`Failed to analyze text: ${llmError.message}`);
    }
    
    // Return the results with detailed metadata
    return {
      success: true,
      extractedText,
      extractedData: extractedData || null,
      fileType,
      isMedicalBill: verificationResult?.isMedicalBill || false,
      confidence: verificationResult?.confidence || 'low',
      reason: verificationResult?.reason || 'No verification reason provided',
      metadata: {
        textLength: extractedText.length,
        processedAt: new Date().toISOString(),
        fileType,
        hasStructuredData: !!extractedData,
        verificationStatus: verificationResult?.status || 'unknown'
      }
    };
  } catch (error) {
    console.error('Error in document analysis:', error);
    return {
      success: false,
      error: error.message,
      metadata: {
        processedAt: new Date().toISOString(),
        errorType: error.name,
        errorDetails: error.stack
      }
    };
  }
};

export default async function handler(req, res) {
  // Add detailed debugging logs
  console.log('API Route: /api/analyze-full-alt - Request received');
  console.log('Request method:', req.method);
  console.log('Request headers:', JSON.stringify(req.headers));
  console.log('Request URL:', req.url);
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Handle non-POST methods but don't reject them immediately
  if (req.method !== 'POST') {
    console.log(`Warning: API called with ${req.method} method instead of POST`);
    // For GET requests, return a simple status message instead of rejecting
    if (req.method === 'GET') {
      return res.status(200).json({ 
        status: 'API is online',
        message: 'This endpoint requires a POST request with proper payload',
        documentation: 'Send a POST request with fileUrl, userId, and billId parameters'
      });
    }
  }

  try {
    if (!adminDb || !adminStorage) {
      throw new Error('Firebase Admin SDK not initialized');
    }
    
    // Support GET requests with query parameters in addition to POST with body
    let fileUrl, userId, billId;
    
    if (req.method === 'POST') {
      console.log('Processing POST request with body');
      ({ fileUrl, userId, billId } = req.body);
    } else if (req.method === 'GET' && req.query) {
      console.log('Processing GET request with query parameters');
      ({ fileUrl, userId, billId } = req.query);
    }
    
    console.log('Parameters received:', { 
      fileUrl: fileUrl ? 'Present (URL truncated)' : 'Missing', 
      userId: userId || 'Missing', 
      billId: billId || 'Missing' 
    });
    
    if (!fileUrl || !userId || !billId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameters',
        details: {
          fileUrl: !fileUrl,
          userId: !userId,
          billId: !billId
        }
      });
    }
    
    // Verify document ownership
    console.log(`Verifying ownership of bill ${billId} for user ${userId}`);
    const billDoc = await adminDb.collection('bills').doc(billId).get();
    if (!billDoc.exists || billDoc.data().userId !== userId) {
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized access to this document' 
      });
    }
    
    // Analyze the document
    console.log('Starting document analysis');
    const result = await analyzeDocument(fileUrl, userId, billId);
    
    if (!result.success) {
      console.log('Analysis failed:', result.error);
      return res.status(500).json({
        success: false,
        error: result.error,
        metadata: result.metadata
      });
    }
    
    // Return successful results
    console.log('Analysis completed successfully');
    res.status(200).json({
      ...result,
      requestId: `${billId}-${Date.now()}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in analyze-full-alt endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error analyzing document',
      metadata: {
        timestamp: new Date().toISOString(),
        errorType: error.name,
        errorDetails: error.stack
      }
    });
  }
} 