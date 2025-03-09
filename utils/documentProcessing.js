import pdf from 'pdf-parse';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { analyzeMedicalBillText } from './openaiClient';
import { matchServiceToCPT } from './cptMatcher';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Google Cloud Vision client
let visionClient;

try {
  // Format the private key correctly (replace escaped newlines with actual newlines)
  // In some environments like Vercel, the private key might be double-escaped
  let privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY || '';
  
  // Handle different formats of the private key
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  
  console.log('Initializing Google Cloud Vision client with environment variables');
  console.log('Project ID:', process.env.GOOGLE_CLOUD_PROJECT_ID);
  console.log('Client Email:', process.env.GOOGLE_CLOUD_CLIENT_EMAIL);
  
  // Create credentials object
  const credentials = {
    client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
    private_key: privateKey,
    project_id: process.env.GOOGLE_CLOUD_PROJECT_ID
  };
  
  // Log a sanitized version of the credentials for debugging
  console.log('Using credentials:', {
    client_email: credentials.client_email,
    private_key: credentials.private_key ? 'PRESENT (starts with: ' + credentials.private_key.substring(0, 20) + '...)' : 'MISSING',
    project_id: credentials.project_id
  });
  
  visionClient = new ImageAnnotatorClient({
    credentials: credentials
  });
  
  console.log('Google Cloud Vision client initialized successfully');
} catch (error) {
  console.error('Error initializing Google Cloud Vision client:', error);
}

// Add image pre-processing functions
async function preprocessImage(imageBuffer) {
  try {
    console.log('Pre-processing image...');
    
    // First convert to PNG format to ensure compatibility
    const pngBuffer = await sharp(imageBuffer)
      .toFormat('png')
      .toBuffer();
    
    console.log('Converted image to PNG format');
    
    // Then apply enhancements for better OCR
    return await sharp(pngBuffer)
      .grayscale() // Convert to grayscale
      .normalize() // Normalize the image contrast
      .sharpen() // Sharpen the image
      .toBuffer();
  } catch (error) {
    console.error('Image pre-processing error:', error);
    console.log('Returning original buffer without preprocessing');
    return imageBuffer; // Return original buffer if processing fails
  }
}

export async function extractTextFromPDF(pdfBuffer) {
  try {
    console.log('Starting PDF extraction with buffer size:', pdfBuffer.length);
    const data = await pdf(pdfBuffer);
    
    if (!data || !data.text) {
      console.error('PDF extraction returned no text');
      throw new Error('No text content found in PDF');
    }
    
    console.log('PDF text extracted successfully, length:', data.text.length);
    console.log('First 200 chars:', data.text.substring(0, 200));
    
    return data.text;
  } catch (error) {
    console.error('PDF parsing error:', error);
    error.step = 'pdf_extraction';
    error.details = { 
      bufferSize: pdfBuffer.length,
      errorMessage: error.message,
      errorStack: error.stack
    };
    throw error;
  }
}

export async function extractTextFromImage(imageBuffer) {
  console.log('Starting text extraction process with Google Vision API...');
  
  try {
    // Check if Vision client is initialized
    if (!visionClient) {
      throw new Error('Google Cloud Vision client is not initialized. Please set the required environment variables: GOOGLE_CLOUD_CLIENT_EMAIL, GOOGLE_CLOUD_PRIVATE_KEY, and GOOGLE_CLOUD_PROJECT_ID.');
    }
    
    // Pre-process the image
    console.log('Pre-processing image for OCR...');
    const processedBuffer = await preprocessImage(imageBuffer);
    console.log('Image pre-processing complete');
    
    // Create request for Google Vision API using annotateImage method
    const request = {
      requests: [
        {
          image: {
            content: processedBuffer.toString('base64')
          },
          features: [
            {
              type: 'TEXT_DETECTION'
            }
          ]
        }
      ]
    };
    
    console.log('Sending request to Google Vision API...');
    const [response] = await visionClient.batchAnnotateImages(request);
    
    if (!response || !response.responses || response.responses.length === 0) {
      throw new Error('Empty response from Google Vision API');
    }
    
    const textAnnotations = response.responses[0]?.textAnnotations;
    
    if (!textAnnotations || textAnnotations.length === 0) {
      throw new Error('No text detected in the image');
    }
    
    // The first annotation contains the entire extracted text
    const extractedText = textAnnotations[0].description;
    
    // Post-process the extracted text
    const processedText = extractedText
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\x20-\x7E\n]/g, '') // Remove non-printable characters
      .trim();

    console.log('OCR completed, text length:', processedText.length);
    console.log('First 200 chars:', processedText.substring(0, 200));
    
    return processedText;
  } catch (error) {
    console.error('Text extraction error:', error);
    throw new Error(`Text extraction failed: ${error.message}`);
  }
}

export async function fetchFileBuffer(fileUrl) {
  try {
    console.log('Fetching file from URL:', fileUrl);
    
    if (!fileUrl) {
      throw new Error('No file URL provided');
    }
    
    // Handle Firebase Storage URLs
    if (fileUrl.includes('firebasestorage.googleapis.com')) {
      console.log('Detected Firebase Storage URL');
      
      // Add a cache-busting parameter to avoid caching issues
      const urlWithCacheBuster = `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}cacheBuster=${Date.now()}`;
      console.log('Using URL with cache buster:', urlWithCacheBuster);
      
      const response = await fetch(urlWithCacheBuster, {
        headers: {
          'Accept': 'image/*, application/pdf',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const buffer = await response.buffer();
      console.log('File fetched successfully, buffer size:', buffer.length);
      
      // Check if the buffer is valid
      if (!buffer || buffer.length === 0) {
        throw new Error('Empty buffer received from URL');
      }
      
      return buffer;
    } else {
      throw new Error('Invalid file URL format');
    }
  } catch (error) {
    console.error('File fetch error:', error);
    error.step = 'file_fetch';
    error.details = { 
      url: fileUrl,
      errorMessage: error.message,
      errorStack: error.stack
    };
    throw error;
  }
}

export async function processWithLLM(text, isVerificationMode = false) {
  try {
    console.log('Starting LLM processing with text length:', text.length);
    console.log('Mode:', isVerificationMode ? 'Verification' : 'Data Extraction');
    
    let prompt;
    if (isVerificationMode) {
      prompt = `
        You are a medical bill analysis expert. Your task is to determine if the following text is from a medical bill.
        Return ONLY a valid JSON object in this exact format:
        {
          "isMedicalBill": boolean,
          "confidence": "string",
          "reason": "string"
        }

        IMPORTANT RULES:
        1. Return ONLY the JSON object, no additional text
        2. Set isMedicalBill to true only if you are confident this is a medical bill
        3. Provide a brief reason for your decision
        4. Set confidence to "high", "medium", or "low"

        TEXT TO ANALYZE:
        ${text}
      `;
    } else {
      prompt = `
        You are a medical bill analysis expert. Your task is to extract information from the following medical bill and return it ONLY as a valid JSON object.

        REQUIRED JSON FORMAT:
        {
          "patientInfo": {
            "fullName": "string",
            "dateOfBirth": "string",
            "accountNumber": "string",
            "insuranceInfo": "string"
          },
          "billInfo": {
            "totalAmount": "string",
            "serviceDates": "string",
            "dueDate": "string",
            "facilityName": "string"
          },
          "services": [
            {
              "description": "string",
              "code": "string",
              "amount": "string",
              "details": "string"
            }
          ],
          "insuranceInfo": {
            "amountCovered": "string",
            "patientResponsibility": "string",
            "adjustments": "string"
          }
        }

        IMPORTANT RULES:
        1. Return ONLY the JSON object, no additional text or explanations
        2. Use "Not found" for any missing information
        3. Ensure all values are strings
        4. Always include at least one item in the services array
        5. Maintain the exact structure shown above
        6. Do not add any additional fields
        7. Ensure the response is valid JSON that can be parsed
        8. For each service, provide the CPT/HCPCS code if available in the bill

        MEDICAL BILL TEXT TO ANALYZE:
        ${text}
      `;
    }

    console.log('Sending request to OpenAI...');
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: isVerificationMode ? 
            "You are a medical bill analysis expert. You must return ONLY valid JSON indicating if the text is from a medical bill." :
            "You are a medical bill analysis expert. You must return ONLY valid JSON in the exact format specified. No other text or explanations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });

    if (!completion.choices?.[0]?.message?.content) {
      throw new Error('No content in OpenAI response');
    }

    const responseContent = completion.choices[0].message.content.trim();
    console.log('Raw OpenAI response:', responseContent);

    try {
      const parsedResponse = JSON.parse(responseContent);
      
      if (isVerificationMode) {
        if (typeof parsedResponse.isMedicalBill !== 'boolean') {
          throw new Error('Invalid verification response: isMedicalBill must be a boolean');
        }
      } else {
        const requiredKeys = ['patientInfo', 'billInfo', 'services', 'insuranceInfo'];
        const missingKeys = requiredKeys.filter(key => !parsedResponse[key]);
        
        if (missingKeys.length > 0) {
          throw new Error(`Missing required keys: ${missingKeys.join(', ')}`);
        }

        if (!Array.isArray(parsedResponse.services) || parsedResponse.services.length === 0) {
          throw new Error('Services must be a non-empty array');
        }
        
        // Enhance services with CPT codes if they don't already have valid codes
        console.log('Before CPT enhancement, services:', JSON.stringify(parsedResponse.services, null, 2));
        parsedResponse.services = await enhanceServicesWithCPTCodes(parsedResponse.services, parsedResponse.patientInfo, parsedResponse.billInfo);
        console.log('After CPT enhancement, services:', JSON.stringify(parsedResponse.services, null, 2));
      }

      return parsedResponse;
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      console.error('Response that failed to parse:', responseContent);
      throw new Error(`Failed to parse LLM response as valid JSON: ${parseError.message}`);
    }
  } catch (error) {
    console.error('LLM processing error:', error);
    error.step = 'llm_processing';
    error.details = error.message;
    throw error;
  }
}

/**
 * Determine if a service should use facility or non-facility rates
 * @param {Object} service - The service to check
 * @param {Object} billInfo - Information about the bill
 * @returns {string} - 'facility' or 'non-facility'
 */
function determineFacilityType(service, billInfo) {
  console.log('[FACILITY_TYPE] Determining facility type for service:', service.description);
  console.log('[FACILITY_TYPE] Bill info:', JSON.stringify(billInfo, null, 2));
  
  // Default to non-facility if we can't determine
  let facilityType = 'non-facility';
  
  // Check if the bill is from a hospital or surgical center
  if (billInfo && billInfo.facilityName) {
    const facilityName = billInfo.facilityName.toLowerCase();
    const hospitalKeywords = ['hospital', 'medical center', 'med ctr', 'medical ctr', 'surgery center', 'surgical center', 'health system'];
    
    // Check if facility name contains hospital keywords
    const isHospital = hospitalKeywords.some(keyword => facilityName.includes(keyword));
    
    if (isHospital) {
      console.log('[FACILITY_TYPE] Facility name indicates hospital setting');
      facilityType = 'facility';
    }
  }
  
  // Check service description for clues
  if (service.description) {
    const serviceDesc = service.description.toLowerCase();
    
    // Services typically performed in facilities
    const facilityServiceKeywords = [
      'surgery', 'surgical', 'operation', 'anesthesia', 'anesthetic',
      'emergency', 'inpatient', 'admission', 'hospital', 'icu', 'intensive care',
      'catheter', 'catheterization', 'endoscopy', 'biopsy', 'implant'
    ];
    
    // Check if service description contains facility keywords
    const isFacilityService = facilityServiceKeywords.some(keyword => serviceDesc.includes(keyword));
    
    if (isFacilityService) {
      console.log('[FACILITY_TYPE] Service description indicates facility setting');
      facilityType = 'facility';
    }
    
    // Services typically performed in non-facility settings
    const nonFacilityServiceKeywords = [
      'office visit', 'consultation', 'check-up', 'checkup', 'follow-up',
      'evaluation', 'assessment', 'screening', 'preventive', 'vaccination',
      'immunization', 'injection', 'outpatient'
    ];
    
    // Check if service description contains non-facility keywords
    const isNonFacilityService = nonFacilityServiceKeywords.some(keyword => serviceDesc.includes(keyword));
    
    if (isNonFacilityService) {
      console.log('[FACILITY_TYPE] Service description indicates non-facility setting');
      facilityType = 'non-facility';
    }
  }
  
  // Check service details for clues
  if (service.details) {
    const details = service.details.toLowerCase();
    
    // Room and board indicates inpatient/facility
    if (details.includes('room') || details.includes('bed') || details.includes('inpatient')) {
      console.log('[FACILITY_TYPE] Service details indicate facility setting');
      facilityType = 'facility';
    }
  }
  
  console.log(`[FACILITY_TYPE] Determined facility type: ${facilityType}`);
  return facilityType;
}

/**
 * Enhance services with CPT codes
 * @param {Array} services - The services extracted from the bill
 * @param {Object} patientInfo - The patient information from the bill
 * @param {Object} billInfo - Information about the bill
 * @returns {Promise<Array>} - The enhanced services with CPT codes
 */
async function enhanceServicesWithCPTCodes(services, patientInfo, billInfo) {
  console.log('[CPT_ENHANCEMENT] Starting CPT code enhancement for services:', JSON.stringify(services, null, 2));
  console.log('[CPT_ENHANCEMENT] Patient info available:', patientInfo ? 'Yes' : 'No');
  console.log('[CPT_ENHANCEMENT] Bill info available:', billInfo ? 'Yes' : 'No');
  
  if (!services || services.length === 0) {
    console.log('[CPT_ENHANCEMENT] No services to enhance');
    return [];
  }
  
  const enhancedServices = [];
  
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    // Create a copy of the service to avoid modifying the original
    const enhancedService = { ...service };
    
    console.log(`[CPT_ENHANCEMENT] Processing service ${i+1}/${services.length}: "${service.description}"`);
    
    // Skip if service already has a valid CPT code
    if (service.code && service.code !== 'Not found' && 
        (/^\d{5}$/.test(service.code) || /^[A-Z]\d{4}$/.test(service.code))) {
      console.log(`[CPT_ENHANCEMENT] Service already has a valid code: ${service.code}`);
      enhancedServices.push(enhancedService);
      continue;
    }
    
    // Prepare additional context for matching
    const additionalContext = {
      patientAge: patientInfo?.dateOfBirth ? calculateAge(patientInfo.dateOfBirth) : null,
      serviceDate: service.date || null,
    };
    
    console.log(`[CPT_ENHANCEMENT] Additional context for matching:`, JSON.stringify(additionalContext));
    
    // Match service to CPT code
    console.log('[CPT_ENHANCEMENT] Calling matchServiceToCPT function');
    try {
      const match = await matchServiceToCPT(service.description, additionalContext);
      
      if (match) {
        console.log(`[CPT_ENHANCEMENT] Found CPT code match:`, JSON.stringify(match, null, 2));
        enhancedService.code = match.cptCode;
        enhancedService.codeDescription = match.description;
        enhancedService.codeConfidence = match.confidence;
        enhancedService.codeReasoning = match.reasoning;
        enhancedService.codeMatchMethod = match.matchMethod;
        
        // Determine facility type and add appropriate reimbursement rate
        const facilityType = determineFacilityType(service, billInfo);
        enhancedService.facilityType = facilityType;
        
        if (facilityType === 'facility' && match.facilityRate !== null) {
          enhancedService.reimbursementRate = match.facilityRate;
          enhancedService.reimbursementType = 'facility';
        } else if (match.nonFacilityRate !== null) {
          enhancedService.reimbursementRate = match.nonFacilityRate;
          enhancedService.reimbursementType = 'non-facility';
        }
        
        // Calculate potential savings if we have both billed amount and reimbursement rate
        if (enhancedService.reimbursementRate && enhancedService.amount) {
          // Extract numeric amount from string like "$123.45"
          const amountStr = enhancedService.amount.replace(/[^0-9.]/g, '');
          const amount = parseFloat(amountStr);
          
          if (!isNaN(amount) && amount > 0) {
            const savings = amount - enhancedService.reimbursementRate;
            if (savings > 0) {
              enhancedService.potentialSavings = savings;
              enhancedService.savingsPercentage = (savings / amount) * 100;
            }
          }
        }
      } else {
        console.log('[CPT_ENHANCEMENT] No CPT code match found');
        enhancedService.code = 'Not found';
        enhancedService.codeMatchMethod = 'no_match';
      }
    } catch (error) {
      console.error('[CPT_ENHANCEMENT] Error matching service to CPT code:', error);
      enhancedService.code = 'Error';
      enhancedService.codeMatchMethod = 'error';
      // Continue without CPT code - the service will be included without a code
    }
    
    enhancedServices.push(enhancedService);
  }
  
  console.log('[CPT_ENHANCEMENT] Enhanced services:', JSON.stringify(enhancedServices, null, 2));
  return enhancedServices;
}

/**
 * Calculate age from date of birth
 * @param {string} dateOfBirth - The date of birth in any format
 * @returns {number|null} - The age or null if invalid date
 */
function calculateAge(dateOfBirth) {
  if (!dateOfBirth || dateOfBirth === 'Not found') return null;
  
  try {
    // Try to parse the date
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) return null;
    
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    
    return age;
  } catch (error) {
    console.error('Error calculating age:', error);
    return null;
  }
}

export async function enhancedAnalyzeWithAI(extractedText) {
  console.log('[ENHANCED_ANALYSIS] Starting enhanced AI analysis of medical bill...');
  try {
    // First verify if it's a medical bill using existing function
    console.log('[ENHANCED_ANALYSIS] Verifying if document is a medical bill...');
    const verificationResult = await processWithLLM(extractedText, true);
    console.log('[ENHANCED_ANALYSIS] Verification result:', verificationResult);

    if (!verificationResult.isMedicalBill) {
      console.log('[ENHANCED_ANALYSIS] Document is not a medical bill, skipping enhanced analysis');
      return {
        isMedicalBill: false,
        confidence: verificationResult.confidence,
        reason: verificationResult.reason
      };
    }

    // If it is a medical bill, perform enhanced analysis
    console.log('[ENHANCED_ANALYSIS] Document is a medical bill, performing enhanced analysis...');
    
    // Use OpenAI to extract structured data
    console.log('[ENHANCED_ANALYSIS] Starting OpenAI analysis of medical bill text...');
    console.log(`[ENHANCED_ANALYSIS] Text length: ${extractedText.length} characters`);
    
    try {
      const enhancedData = await processWithLLM(extractedText, false);
      console.log('[ENHANCED_ANALYSIS] OpenAI analysis completed successfully');
      console.log('[ENHANCED_ANALYSIS] Raw extracted data:', JSON.stringify(enhancedData, null, 2));
      
      // Check if services were extracted
      if (enhancedData.services && enhancedData.services.length > 0) {
        console.log(`[ENHANCED_ANALYSIS] Found ${enhancedData.services.length} services, will enhance with CPT codes`);
      } else {
        console.log('[ENHANCED_ANALYSIS] No services found in extracted data, skipping CPT enhancement');
      }
      
      return {
        isMedicalBill: true,
        confidence: verificationResult.confidence,
        reason: verificationResult.reason,
        enhancedData
      };
    } catch (analysisError) {
      console.error('[ENHANCED_ANALYSIS] Error in OpenAI analysis:', analysisError);
      return {
        isMedicalBill: true,
        confidence: verificationResult.confidence,
        reason: verificationResult.reason,
        error: analysisError.message
      };
    }
  } catch (error) {
    console.error('[ENHANCED_ANALYSIS] Error in enhanced analysis:', error);
    return {
      isMedicalBill: false,
      confidence: 'low',
      reason: `Error during analysis: ${error.message}`
    };
  }
}

export async function detectFileType(fileUrl) {
  try {
    if (!fileUrl) {
      throw new Error('No file URL provided');
    }

    const response = await fetch(fileUrl, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(`Failed to fetch file headers: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType) {
      throw new Error('No content-type header found');
    }

    console.log('Content-Type:', contentType);
    
    if (contentType.includes('pdf')) {
      return 'pdf';
    } else if (contentType.includes('image')) {
      return 'image';
    } else {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
  } catch (error) {
    console.error('File type detection error:', error);
    error.step = 'file_type_detection';
    error.details = { url: fileUrl };
    throw error;
  }
}