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
import OpenAI from 'openai';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
    
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    })
  });
}

const db = getFirestore();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
      const { text, mode, systemPrompt, context, options } = req.body;
      console.log('Request received:', { mode, hasText: !!text, hasSystemPrompt: !!systemPrompt, hasContext: !!context });
      
      if (!text) {
        console.error('Error: No text provided');
        return res.status(400).json({ error: 'No text provided' });
      }

      // Prepare messages array for chat completion
      const messages = [];
      
      // Add system message with context if provided
      if (systemPrompt) {
        console.log('Using provided system prompt, length:', systemPrompt.length);
        messages.push({
          role: 'system',
          content: systemPrompt
        });
      } else {
        console.log('Using default system prompt');
        messages.push({
          role: 'system',
          content: `You are an expert medical bill analyzer. Extract key information from the provided medical bill text.
          Focus on patient information, service details, amounts, dates, and insurance information.
          Return the data in a structured format that can be easily processed.`
        });
      }
      
      // Add user message with the text to analyze
      messages.push({
        role: 'user',
        content: `Here is the medical bill text to analyze:\n\n${text}`
      });
      
      console.log('Prepared messages array with', messages.length, 'messages');
      
      try {
        // Call OpenAI API with better error handling
        console.log('Calling OpenAI API...');
        
        // Determine which model to use
        const model = options?.model || "gpt-3.5-turbo";
        console.log('Using model:', model);
        
        // Structure the request to OpenAI based on the mode
        let requestOptions = {
          model: model,
          messages: messages,
          temperature: 0.1, // Low temperature for more consistent results
          max_tokens: 4000
        };
        
        // If mode is specified, handle it accordingly
        if (mode === 'contextual_extract') {
          console.log('Running in contextual extraction mode');
          // Keep default requestOptions
        } else if (mode === 'combined_verify_extract') {
          console.log('Running in combined verification and extraction mode');
          requestOptions.temperature = 0.2; // Slightly higher temperature for verification component
          // Messages are already set up with the combined system prompt
        } else {
          console.log('Running in standard extraction mode');
          // Keep default requestOptions
        }
        
        console.log('Request options prepared:', {
          model: requestOptions.model,
          temperature: requestOptions.temperature,
          max_tokens: requestOptions.max_tokens,
          messages_count: requestOptions.messages.length
        });
        
        const completion = await openai.chat.completions.create(requestOptions);
        
        console.log('OpenAI API response received');
        
        if (!completion.choices || !completion.choices[0] || !completion.choices[0].message) {
          console.error('Error: Unexpected response format from OpenAI');
          return res.status(500).json({ error: 'Unexpected response format from OpenAI' });
        }
        
        const content = completion.choices[0].message.content;
        console.log('Content received, length:', content.length);
        
        try {
          // Parse the response JSON
          const parsedResult = JSON.parse(content);
          console.log('Successfully parsed response JSON');
          
          // Return the result
          return res.status(200).json(parsedResult);
        } catch (parseError) {
          console.error('Error parsing OpenAI response JSON:', parseError);
          
          // Try to extract valid JSON from the response
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const extractedJson = JSON.parse(jsonMatch[0]);
              console.log('Successfully extracted valid JSON from response');
              return res.status(200).json(extractedJson);
            } catch (extractError) {
              console.error('Failed to extract valid JSON:', extractError);
              return res.status(500).json({ 
                error: 'Failed to parse response JSON',
                content: content
              });
            }
          } else {
            return res.status(500).json({ 
              error: 'Invalid JSON response from OpenAI',
              content: content
            });
          }
        }
      } catch (openaiError) {
        console.error('OpenAI API error:', openaiError);
        return res.status(500).json({ 
          error: 'OpenAI API error',
          message: openaiError.message,
          code: openaiError.code || 'unknown'
        });
      }
    } catch (error) {
      console.error('Error in analyze endpoint:', error);
      return res.status(500).json({ error: error.message || 'Failed to analyze text' });
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