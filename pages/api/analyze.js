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
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      allowedMethod: 'POST',
      receivedMethod: req.method
    });
  }

  try {
    const { fileUrl, userId, billId } = req.body;

    if (!fileUrl || !userId || !billId) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: { fileUrl: !!fileUrl, userId: !!userId, billId: !!billId }
      });
    }

    // Verify ownership
    const billDoc = await adminDb.collection('bills').doc(billId).get();
    if (!billDoc.exists || billDoc.data().userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized access to this document' });
    }

    const result = await analyzeDocument(fileUrl, userId, billId);
    return res.status(200).json(result);

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      error: error.message || 'Analysis failed',
      details: error.toString(),
      step: 'bill_verification'
    });
  }
} 