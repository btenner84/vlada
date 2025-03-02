import { adminDb } from '../../firebase/admin';
import {
  detectFileType,
  fetchFileBuffer,
  extractTextFromPDF,
  extractTextFromImage,
  processWithLLM
} from '../../utils/documentProcessing';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

// Add better error handling and logging for image processing
const analyzeDocument = async (fileUrl, userId, billId) => {
  console.log('Starting document analysis...', { fileUrl, billId });
  
  try {
    // Detect file type first
    const fileType = await detectFileType(fileUrl);
    console.log('File type detected:', fileType);

    // Fetch file buffer
    const fileBuffer = await fetchFileBuffer(fileUrl);
    console.log('File fetched, size:', fileBuffer.length);

    // Extract text based on file type
    let extractedText;
    if (fileType === 'pdf') {
      extractedText = await extractTextFromPDF(fileBuffer);
    } else {
      extractedText = await extractTextFromImage(fileBuffer);
    }

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('No text was extracted from the document');
    }

    console.log('Text extracted successfully, length:', extractedText.length);

    // First verify if it's a medical bill
    console.log('Verifying if document is a medical bill...');
    const verificationResult = await processWithLLM(extractedText, true);
    console.log('Verification result:', verificationResult);

    let structuredData = null;
    if (verificationResult.isMedicalBill) {
      // Then extract data if it is a medical bill
      console.log('Document is a medical bill, extracting data...');
      structuredData = await processWithLLM(extractedText, false);
      console.log('Data extraction complete');
    }

    // Update document in Firestore
    const docRef = adminDb.collection('bills').doc(billId);
    await docRef.update({
      extractedText,
      extractedData: structuredData,
      isMedicalBill: verificationResult.isMedicalBill,
      confidence: verificationResult.confidence,
      reason: verificationResult.reason,
      analyzedAt: new Date().toISOString(),
      status: 'analyzed'
    });

    return {
      success: true,
      ...structuredData,
      isMedicalBill: verificationResult.isMedicalBill,
      confidence: verificationResult.confidence,
      reason: verificationResult.reason
    };

  } catch (error) {
    console.error('Analysis error:', error);
    
    // Update document status to failed
    const docRef = adminDb.collection('bills').doc(billId);
    await docRef.update({
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString()
    });

    throw new Error(`Analysis failed: ${error.message}`);
  }
};

export default async function handler(req, res) {
  console.log('API Route: /api/analyze - Request received');
  console.log('Request Method:', req.method);
  console.log('Request Headers:', JSON.stringify(req.headers));
  console.log('Request URL:', req.url);
  console.log('Request Query:', JSON.stringify(req.query));
  
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request for CORS preflight');
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
    res.status(200).end();
    console.log('OPTIONS request handled successfully');
    return;
  }
  
  // Continue with your existing code for POST requests
  if (req.method === 'POST') {
    // Log request details for debugging
    console.log('Handling POST request');
    console.log('Request Body:', JSON.stringify(req.body));

    try {
      const { fileUrl, userId, billId } = req.body;
      console.log('Extracted parameters:', { fileUrl, userId, billId });

      if (!fileUrl || !userId || !billId) {
        console.log('Missing required parameters:', { fileUrl: !!fileUrl, userId: !!userId, billId: !!billId });
        return res.status(400).json({ 
          error: 'Missing required parameters',
          details: { fileUrl: !!fileUrl, userId: !!userId, billId: !!billId }
        });
      }

      // Verify ownership
      console.log('Verifying document ownership');
      const billDoc = await adminDb.collection('bills').doc(billId).get();
      if (!billDoc.exists || billDoc.data().userId !== userId) {
        console.log('Unauthorized access attempt:', { billExists: billDoc.exists, requestUserId: userId, docUserId: billDoc.exists ? billDoc.data().userId : null });
        return res.status(403).json({ error: 'Unauthorized access to this document' });
      }

      console.log('Starting document analysis');
      const result = await analyzeDocument(fileUrl, userId, billId);
      console.log('Analysis completed successfully');
      return res.status(200).json(result);

    } catch (error) {
      console.error('Handler error:', error);
      return res.status(500).json({
        error: error.message || 'Analysis failed',
        details: error.toString(),
        step: 'bill_verification'
      });
    }
  } else {
    // Handle any other HTTP method
    console.log(`Rejecting ${req.method} request - only POST and OPTIONS are allowed`);
    res.setHeader('Allow', ['POST', 'OPTIONS']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
} 