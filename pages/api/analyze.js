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

// Enhanced API handler for document analysis with improved OCR processing
export default async function handler(req, res) {
  console.log('API Route: /api/analyze - Request received');
  
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
  
  // Process POST request for OCR and analysis
  if (req.method === 'POST') {
    console.log('Handling POST request');
    
    try {
      const { text, mode, instructions, previousResults, fileUrl, userId, billId } = req.body;
      
      // Direct text analysis mode (from client-side OCR)
      if (text) {
        console.log('Processing direct text analysis, length:', text.length);
        console.log('Analysis mode:', mode || 'extract');
        
        try {
          // Process the text with the LLM
          const result = await processWithLLM(
            text, 
            mode === 'verify', 
            instructions
          );
          
          // Return results
          return res.status(200).json({
            ...result,
            processingDetails: {
              method: 'api-direct',
              timestamp: new Date().toISOString(),
              mode: mode || 'extract',
              textLength: text.length,
              usedPreviousResults: !!previousResults
            }
          });
        } catch (error) {
          console.error('Text processing error:', error);
          return res.status(500).json({
            error: error.message || 'Failed to process text',
            processingDetails: {
              method: 'api-direct',
              error: true,
              errorType: error.name,
              textLength: text?.length
            }
          });
        }
      }
      
      // Full document analysis mode (OCR + analysis)
      if (fileUrl && userId && billId) {
        console.log('Starting full document analysis for:', { fileUrl, billId });
        
        // Verify ownership first
        const billDoc = await adminDb.collection('bills').doc(billId).get();
        if (!billDoc.exists || billDoc.data().userId !== userId) {
          console.log('Unauthorized access attempt:', { billExists: billDoc.exists, requestUserId: userId });
          return res.status(403).json({ error: 'Unauthorized access to this document' });
        }
        
        // Retrieve previous analyses if they exist to help improve accuracy
        const previousAnalyses = await adminDb.collection('bills').doc(billId).collection('analyses').get();
        let previousAnalysisData = null;
        
        if (!previousAnalyses.empty) {
          const analyses = previousAnalyses.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          
          // Find the most recent analysis
          const mostRecent = analyses.sort((a, b) => 
            (b.analyzedAt?.toDate?.() || 0) - (a.analyzedAt?.toDate?.() || 0)
          )[0];
          
          previousAnalysisData = mostRecent?.extractedData || null;
          console.log('Found previous analysis:', previousAnalysisData ? 'Yes' : 'No');
        }
        
        // Proceed with full analysis
        try {
          const result = await analyzeDocument(fileUrl, userId, billId, previousAnalysisData);
          return res.status(200).json(result);
        } catch (error) {
          console.error('Analysis failed:', error);
          return res.status(500).json({
            error: error.message || 'Analysis failed',
            details: error.toString(),
            step: 'document_analysis'
          });
        }
      }
      
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: { 
          hasText: !!text, 
          hasFileUrl: !!fileUrl, 
          hasUserId: !!userId, 
          hasBillId: !!billId 
        } 
      });
      
    } catch (error) {
      console.error('Handler error:', error);
      return res.status(500).json({
        error: error.message || 'Analysis failed',
        details: error.toString(),
        step: 'request_processing'
      });
    }
  } else {
    // Handle any other HTTP method
    console.log(`Rejecting ${req.method} request - only POST and OPTIONS are allowed`);
    res.setHeader('Allow', ['POST', 'OPTIONS']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

// Enhanced document analysis function with improved OCR accuracy
const analyzeDocument = async (fileUrl, userId, billId, previousAnalysisData = null) => {
  console.log('Starting document analysis...', { fileUrl, billId });
  let fileType, fileBuffer, extractedText;
  
  try {
    // Detect file type first
    console.log('Detecting file type...');
    fileType = await detectFileType(fileUrl);
    console.log('File type detected:', fileType);

    // Fetch file buffer
    console.log('Fetching file buffer...');
    fileBuffer = await fetchFileBuffer(fileUrl);
    console.log('File fetched, size:', fileBuffer.length, 'bytes');

    // Extract text based on file type with enhanced OCR settings
    console.log(`Starting text extraction for ${fileType} file...`);
    if (fileType === 'pdf') {
      extractedText = await extractTextFromPDF(fileBuffer);
    } else {
      // For images, apply preprocessing for better OCR results
      extractedText = await extractTextFromImage(fileBuffer);
    }

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error(`No text was extracted from the ${fileType} document`);
    }

    console.log('Text extraction successful:', {
      length: extractedText.length,
      preview: extractedText.substring(0, 200),
      containsNumbers: /\d/.test(extractedText),
      containsLetters: /[a-zA-Z]/.test(extractedText)
    });

    // First verify if it's a medical bill
    console.log('Verifying if document is a medical bill...');
    const verificationResult = await processWithLLM(extractedText, true);
    console.log('Verification result:', verificationResult);

    let structuredData = null;
    if (verificationResult.isMedicalBill) {
      // Create enhanced instructions based on previous analysis if available
      let enhancedInstructions = '';
      if (previousAnalysisData) {
        enhancedInstructions = `
          PREVIOUS ANALYSIS FEEDBACK:
          This bill has been analyzed before. Here are insights from previous analyses that should guide your extraction:
          - Patient Name: ${previousAnalysisData.patientInfo?.fullName || 'Not previously identified correctly'}
          - Total Amount: ${previousAnalysisData.billInfo?.totalAmount || 'Not previously identified correctly'}
          - Service Dates: ${previousAnalysisData.billInfo?.serviceDates || 'Not previously identified correctly'}
          
          NOTE: If previous data conflicts with what you observe in the document, trust your current analysis but explain any discrepancies.
        `;
      }
      
      // Then extract data if it is a medical bill with the enhanced instructions
      console.log('Document is a medical bill, extracting structured data...');
      structuredData = await processWithLLM(extractedText, false, enhancedInstructions);
      
      console.log('Data extraction complete:', {
        hasPatientInfo: !!structuredData?.patientInfo,
        hasBillInfo: !!structuredData?.billInfo,
        servicesCount: structuredData?.services?.length || 0
      });
      
      // Compare with previous analysis for learning
      if (previousAnalysisData) {
        const comparisonResults = compareWithPreviousAnalysis(structuredData, previousAnalysisData);
        structuredData.analysisComparison = comparisonResults;
        console.log('Comparison with previous analysis:', comparisonResults);
      }
    } else {
      console.log('Document is not a medical bill. Reason:', verificationResult.reason);
    }

    // Create a new analysis version in Firestore
    const analysesRef = adminDb.collection('bills').doc(billId).collection('analyses');
    const analysesSnapshot = await analysesRef.get();
    const versionNumber = analysesSnapshot.size + 1;
    const versionId = `analysis_${versionNumber.toString().padStart(2, '0')}`;
    
    // Create new analysis document
    const newAnalysisRef = analysesRef.doc(versionId);
    await newAnalysisRef.set({
      extractedText,
      extractedData: structuredData,
      isMedicalBill: verificationResult.isMedicalBill,
      confidence: verificationResult.confidence,
      reason: verificationResult.reason,
      analyzedAt: adminDb.Timestamp.now(),
      status: 'analyzed',
      fileType,
      textLength: extractedText.length,
      processingMethod: 'server',
      version: versionNumber,
      userId,
      previousVersionUsed: !!previousAnalysisData
    });
    
    // Update parent bill document to point to latest analysis
    await adminDb.collection('bills').doc(billId).update({
      status: 'analyzed',
      latestAnalysisId: versionId,
      latestAnalysisAt: adminDb.Timestamp.now(),
      isMedicalBill: verificationResult.isMedicalBill
    });
    
    console.log('Analysis documents created successfully');

    return {
      success: true,
      ...structuredData,
      isMedicalBill: verificationResult.isMedicalBill,
      confidence: verificationResult.confidence,
      reason: verificationResult.reason,
      analysisVersion: versionNumber,
      versionId
    };

  } catch (error) {
    console.error('Analysis error:', {
      step: error.step || 'unknown',
      message: error.message
    });
    
    // Update document status to failed with detailed error info
    const docRef = adminDb.collection('bills').doc(billId);
    await docRef.update({
      status: 'failed',
      error: error.message,
      errorDetails: {
        step: error.step || 'unknown',
        fileType: fileType || 'unknown',
        hasExtractedText: !!extractedText,
        textLength: extractedText?.length || 0
      },
      failedAt: adminDb.Timestamp.now()
    });

    // Add error object with step information to make debugging easier
    error.step = error.step || 'unknown_step';
    throw error;
  }
};

/**
 * Compare new analysis with previous one to detect improvements or regressions
 * @param {Object} currentData - Current analysis data
 * @param {Object} previousData - Previous analysis data
 * @returns {Object} - Comparison results
 */
function compareWithPreviousAnalysis(currentData, previousData) {
  const results = {
    matches: [],
    differences: [],
    potentialImprovements: [],
    regressions: []
  };
  
  // Compare patient information
  if (currentData.patientInfo && previousData.patientInfo) {
    Object.keys(currentData.patientInfo).forEach(key => {
      const current = currentData.patientInfo[key];
      const previous = previousData.patientInfo[key];
      
      if (current === previous) {
        results.matches.push(`patientInfo.${key}`);
      } else if (current !== "Not found" && previous === "Not found") {
        results.potentialImprovements.push({
          field: `patientInfo.${key}`,
          previous: previous,
          current: current
        });
      } else if (current === "Not found" && previous !== "Not found") {
        results.regressions.push({
          field: `patientInfo.${key}`,
          previous: previous,
          current: current
        });
      } else {
        results.differences.push({
          field: `patientInfo.${key}`,
          previous: previous,
          current: current
        });
      }
    });
  }
  
  // Compare bill information
  if (currentData.billInfo && previousData.billInfo) {
    Object.keys(currentData.billInfo).forEach(key => {
      const current = currentData.billInfo[key];
      const previous = previousData.billInfo[key];
      
      if (current === previous) {
        results.matches.push(`billInfo.${key}`);
      } else if (current !== "Not found" && previous === "Not found") {
        results.potentialImprovements.push({
          field: `billInfo.${key}`,
          previous: previous,
          current: current
        });
      } else if (current === "Not found" && previous !== "Not found") {
        results.regressions.push({
          field: `billInfo.${key}`,
          previous: previous,
          current: current
        });
      } else {
        results.differences.push({
          field: `billInfo.${key}`,
          previous: previous,
          current: current
        });
      }
    });
  }
  
  return results;
} 