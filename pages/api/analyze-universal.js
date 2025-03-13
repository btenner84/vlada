import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import {
  detectFileType,
  fetchFileBuffer,
  extractTextFromPDF,
  extractTextFromImage,
  processWithLLM,
  enhancedAnalyzeWithAI
} from '../../utils/documentProcessing.js';
import { visionClient } from '../../utils/visionClient.js';
import { matchServiceToCPT } from '../../utils/cptMatcher.js';
import { adminDb as existingAdminDb, adminStorage as existingAdminStorage } from '../../firebase/admin.js';
import { extractBillingCodes } from '../../utils/advancedClassifier.js';

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

// Add this function before the analyzeDocument function
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

// Function to analyze a document
const analyzeDocument = async (fileUrl, userId, billId) => {
  console.log(`Starting document analysis for bill ${billId} from user ${userId}`);
  console.log(`File URL: ${fileUrl}`);
  
  try {
    // Detect file type
    console.log('Detecting file type...');
    const fileType = await detectFileType(fileUrl);
    console.log(`File type detected: ${fileType}`);
    
    // Extract text based on file type
    console.log('Extracting text...');
    let extractedText = '';
    
    if (fileType === 'pdf') {
      // Fetch the file buffer
      console.log('Fetching PDF file buffer...');
      const fileBuffer = await fetchFileBuffer(fileUrl);
      console.log(`PDF file buffer fetched, size: ${fileBuffer.length} bytes`);
      
      extractedText = await extractTextFromPDF(fileBuffer);
    } else if (fileType === 'image') {
      try {
        // For images, use the standard approach first
        console.log('Fetching image file buffer...');
        const fileBuffer = await fetchFileBuffer(fileUrl);
        console.log(`Image file buffer fetched, size: ${fileBuffer.length} bytes`);
        
        extractedText = await extractTextFromImage(fileBuffer);
      } catch (imageError) {
        console.error('Error with standard image extraction, trying fallback method:', imageError);
        
        // If standard approach fails, try a different method
        // This is a workaround for the "DECODER routines::unsupported" error
        
        // Create a base64 image directly from the URL
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Use a simpler request format for Google Vision API
        const request = {
          image: {
            content: buffer.toString('base64')
          }
        };
        
        console.log('Using simplified Vision API request format');
        const [result] = await visionClient.textDetection(request);
        
        if (!result || !result.textAnnotations || result.textAnnotations.length === 0) {
          throw new Error('No text detected in the image');
        }
        
        extractedText = result.textAnnotations[0].description;
      }
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
    
    console.log(`Text extracted, length: ${extractedText.length} characters`);
    console.log(`First 100 chars: ${extractedText.substring(0, 100)}`);
    
    // Extract billing codes from text
    console.log('Extracting billing codes from text...');
    const extractedCodes = extractBillingCodes(extractedText);
    console.log('Billing codes extracted:', JSON.stringify(extractedCodes, null, 2));
    
    // Use our enhanced AI analysis
    console.log('Starting enhanced AI analysis...');
    const enhancedAnalysisResult = await enhancedAnalyzeWithAI(extractedText);
    console.log('Enhanced analysis complete:', enhancedAnalysisResult.isMedicalBill ? 'Medical bill detected' : 'Not a medical bill');
    
    // For backward compatibility, still do the regular LLM processing if enhanced analysis fails
    let extractedData = null;
    if (enhancedAnalysisResult.isMedicalBill && enhancedAnalysisResult.enhancedData) {
      extractedData = enhancedAnalysisResult.enhancedData;
      console.log('Using enhanced AI analysis results');
    } else {
      // Fallback to the original extraction method
      console.log('Enhanced analysis unavailable, falling back to standard extraction...');
      const verificationResult = { 
        isMedicalBill: enhancedAnalysisResult.isMedicalBill,
        confidence: enhancedAnalysisResult.confidence,
        reason: enhancedAnalysisResult.reason 
      };
      
      if (verificationResult.isMedicalBill) {
        console.log('Document is a medical bill, extracting data using standard method...');
        extractedData = await processWithLLM(extractedText, false);
        console.log('Standard data extraction complete');
      }
    }
    
    // Update the bill document in Firestore
    if (billId !== 'client-request' && userId !== 'client-request') {
      console.log(`Updating bill document ${billId} in Firestore...`);
      try {
        const billRef = adminDb.collection('bills').doc(billId);
        
        // Create both a server timestamp and a string timestamp for redundancy
        const now = new Date();
        
        // Update with all the analysis results
        const sanitizedData = sanitizeForFirestore({
          extractedData: extractedData,
          isMedicalBill: enhancedAnalysisResult.isMedicalBill,
          processingMethod: enhancedAnalysisResult.enhancedData ? 'enhanced-ai' : 'server',
          extractedText: extractedText,
          confidence: enhancedAnalysisResult.confidence,
          reason: enhancedAnalysisResult.reason,
          analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
          analyzedAtString: now.toISOString(),
          status: 'analyzed',
          fileType: fileType,
          enhancedAnalysis: enhancedAnalysisResult.enhancedData ? true : false,
          advancedClassification: extractedData?.advancedClassification || false,
          billingCodes: extractedCodes
        });
        
        await billRef.update({
          ...sanitizedData,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Successfully updated bill document ${billId} in Firestore with timestamp: ${now.toISOString()}`);
      } catch (updateError) {
        console.error(`Error updating bill document ${billId} in Firestore:`, updateError);
        // Continue even if update fails - the client will handle it
      }
    }
    
    // Return the results
    return {
      success: true,
      extractedText,
      extractedData,
      fileType,
      isMedicalBill: enhancedAnalysisResult.isMedicalBill,
      confidence: enhancedAnalysisResult.confidence,
      reason: enhancedAnalysisResult.reason,
      enhancedAnalysis: enhancedAnalysisResult.enhancedData ? true : false,
      advancedClassification: extractedData?.advancedClassification || false,
      billingCodes: extractedCodes
    };
  } catch (error) {
    console.error('Error analyzing document:', error);
    throw error;
  }
};

export default async function handler(req, res) {
  console.log('API Route: /api/analyze-universal - Request received');
  console.log('Request Method:', req.method);
  console.log('Request Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Request Body:', req.body);
  console.log('Request Query:', req.query);
  
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
    console.log('OPTIONS request handled successfully');
    return;
  }
  
  // Handle diagnostic GET requests without parameters
  if (req.method === 'GET' && !req.query.fileUrl) {
    console.log('Handling diagnostic GET request');
    return res.status(200).json({ 
      status: 'API is online',
      message: 'This endpoint accepts both GET and POST requests with proper payload',
      documentation: 'Send a request with fileUrl, userId, and billId parameters',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown'
    });
  }

  try {
    // Check for required environment variables
    const requiredEnvVars = {
      'GOOGLE_CLOUD_CLIENT_EMAIL': process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      'GOOGLE_CLOUD_PRIVATE_KEY': process.env.GOOGLE_CLOUD_PRIVATE_KEY,
      'GOOGLE_CLOUD_PROJECT_ID': process.env.GOOGLE_CLOUD_PROJECT_ID,
      'FIREBASE_PROJECT_ID': process.env.FIREBASE_PROJECT_ID,
      'FIREBASE_CLIENT_EMAIL': process.env.FIREBASE_CLIENT_EMAIL,
      'FIREBASE_PRIVATE_KEY': process.env.FIREBASE_PRIVATE_KEY,
      'FIREBASE_STORAGE_BUCKET': process.env.FIREBASE_STORAGE_BUCKET
    };

    const missingEnvVars = Object.entries(requiredEnvVars)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingEnvVars.length > 0) {
      console.error('Missing required environment variables:', missingEnvVars);
      return res.status(500).json({ 
        error: `Server configuration error: Missing required environment variables: ${missingEnvVars.join(', ')}` 
      });
    }
    
    // Check if Firebase Admin SDK is initialized
    if (!adminDb || !adminStorage) {
      console.error('Firebase Admin SDK not initialized');
      return res.status(500).json({ error: 'Firebase Admin SDK not initialized' });
    }
    
    // Get and validate the request parameters from either body (POST) or query (GET)
    let fileUrl, userId, billId;
    
    if (req.method === 'POST' && req.body) {
      // Extract from POST body
      fileUrl = req.body.fileUrl;
      userId = req.body.userId;
      billId = req.body.billId;
      console.log('Extracted parameters from POST body');
    } else {
      // Extract from query parameters (GET)
      fileUrl = req.query.fileUrl;
      userId = req.query.userId;
      billId = req.query.billId;
      console.log('Extracted parameters from query string');
    }
    
    if (!fileUrl) {
      console.log('Missing required parameter: fileUrl');
      return res.status(400).json({ 
        error: 'Missing required parameter: fileUrl',
        receivedParams: {
          fromBody: req.body ? { 
            hasFileUrl: !!req.body.fileUrl,
            hasUserId: !!req.body.userId,
            hasBillId: !!req.body.billId
          } : 'No body',
          fromQuery: { 
            hasFileUrl: !!req.query.fileUrl,
            hasUserId: !!req.query.userId,
            hasBillId: !!req.query.billId
          }
        }
      });
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
          console.log('Unauthorized access attempt:', { 
            billExists: billDoc.exists, 
            requestUserId: userId, 
            docUserId: billDoc.exists ? billDoc.data().userId : null 
          });
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
    try {
      const result = await analyzeDocument(fileUrl, userId || 'client-request', billId || 'client-request');
      
      // Return the results
      console.log('Analysis complete, returning results');
      return res.status(200).json(result);
    } catch (analysisError) {
      console.error('Error analyzing document:', analysisError);
      
      // Handle specific errors related to Sharp module
      if (analysisError.message && analysisError.message.includes('sharp')) {
        console.log('Sharp module error detected, returning friendly error message');
        return res.status(500).json({
          error: 'Image processing error',
          message: 'There was an issue processing your image. Please try the fallback endpoint.',
          details: analysisError.message,
          recommendation: 'Use the /api/analyze-fallback endpoint instead'
        });
      }
      
      // Return a detailed error response
      return res.status(500).json({ 
        error: analysisError.message || 'Error analyzing document',
        stack: process.env.NODE_ENV === 'development' ? analysisError.stack : undefined,
        details: analysisError.details || undefined
      });
    }
  } catch (error) {
    console.error('Error in analyze-universal endpoint:', error);
    // Send a more detailed error response
    return res.status(500).json({ 
      error: error.message || 'Error analyzing document',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      details: error.details || undefined
    });
  }
}

// Fix the export config syntax
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false
  },
  maxDuration: 300
}; 