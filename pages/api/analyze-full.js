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
} from '../../utils/documentProcessing';
import { visionClient } from '../../utils/visionClient';
import { matchServiceToCPT } from '../../utils/cptMatcher';
import { adminDb as existingAdminDb, adminStorage as existingAdminStorage } from '../../firebase/admin';

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
          enhancedAnalysis: enhancedAnalysisResult.enhancedData ? true : false
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
      enhancedAnalysis: enhancedAnalysisResult.enhancedData ? true : false
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
    // Check for required environment variables
    if (!process.env.GOOGLE_CLOUD_CLIENT_EMAIL || 
        !process.env.GOOGLE_CLOUD_PRIVATE_KEY || 
        !process.env.GOOGLE_CLOUD_PROJECT_ID) {
      console.error('Missing required Google Cloud Vision environment variables');
      return res.status(500).json({ 
        error: 'Server configuration error: Missing required Google Cloud Vision environment variables' 
      });
    }
    
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