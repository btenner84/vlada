import pdf from 'pdf-parse';
import OpenAI from 'openai';
import fetch from 'node-fetch';
// Removing direct sharp import - we'll only use the safe import
// import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { analyzeMedicalBillText } from './openaiClient.js';
import { matchServiceToCPT } from './cptMatcher.js';
import { matchServiceToLab } from './labMatcher.js';
import { matchServiceToDrug } from './drugMatcher.js';
import { matchServiceToMedicare } from './medicareMatcher.js';
import { matchServiceToOPPS } from './oppsMatcher.js';
import { decideServiceComponent } from './componentDecider.js';
import { getDatabaseMatcher } from './databaseMatcherFactory.js';
import { 
  extractBillingCodes, 
  enhanceServiceStructure,
  determineServiceSetting,
  categorizeWithAdvancedSystem
} from './advancedClassifier.js';
import { getSafeSharp } from './safeImports.js';

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
    
    try {
      // Use our safe Sharp import instead of direct import
      const safeSharp = await getSafeSharp();
      
      // First convert to PNG format to ensure compatibility
      const pngBuffer = await safeSharp(imageBuffer)
        .toFormat('png')
        .toBuffer();
      
      console.log('Converted image to PNG format');
      
      // Then apply enhancements for better OCR
      return await safeSharp(pngBuffer)
        .grayscale() // Convert to grayscale
        .normalize() // Normalize the image contrast
        .sharpen() // Sharpen the image
        .toBuffer();
    } catch (sharpError) {
      console.error('Sharp module error during image pre-processing:', sharpError);
      console.log('Using fallback mechanism without image enhancement');
      
      // Return original buffer when Sharp fails
      return imageBuffer;
    }
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
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    if (!completion.choices?.[0]?.message?.content) {
      throw new Error('No content in OpenAI response');
    }

    const responseContent = completion.choices[0].message.content.trim();
    console.log('Raw OpenAI response:', responseContent);

    try {
      // Clean the response content before parsing
      const cleanedContent = cleanJsonResponse(responseContent);
      console.log('Cleaned response content:', cleanedContent);
      
      const parsedResponse = JSON.parse(cleanedContent);
      
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
        
        // Continue with additional processing as needed
        console.log('Processing services for code lookup and pricing...');
        
        // Add performance monitoring around the service enhancement
        console.log(`[PERFORMANCE] Starting parallel service enhancement for ${parsedResponse.services.length} services`);
        const enhancementStartTime = Date.now();
        
        parsedResponse.services = await enhanceServicesWithCPTCodes(parsedResponse.services, parsedResponse.patientInfo, parsedResponse.billInfo);
        
        const enhancementEndTime = Date.now();
        const enhancementDuration = enhancementEndTime - enhancementStartTime;
        console.log(`[PERFORMANCE] Service enhancement completed in ${enhancementDuration}ms (${(enhancementDuration/1000).toFixed(2)}s)`);
        console.log(`[PERFORMANCE] Average time per service: ${(enhancementDuration / parsedResponse.services.length).toFixed(2)}ms`);
        
        // Add performance metrics to the response for monitoring
        parsedResponse.performanceMetrics = {
          enhancementTotalTime: enhancementDuration,
          serviceCount: parsedResponse.services.length,
          averageTimePerService: enhancementDuration / parsedResponse.services.length,
          processingMethod: 'parallel'
        };
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
 * Clean JSON response from OpenAI to handle formatting issues
 * @param {string} content - The raw response content
 * @returns {string} - Cleaned JSON string
 */
function cleanJsonResponse(content) {
  if (!content) return '{}';
  
  // Remove markdown code block indicators
  let cleaned = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
  
  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // If the content doesn't start with {, add it
  if (!cleaned.startsWith('{')) {
    cleaned = '{' + cleaned;
  }
  
  // If the content doesn't end with }, add it
  if (!cleaned.endsWith('}')) {
    cleaned = cleaned + '}';
  }
  
  return cleaned;
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
 * Categorize a medical service into one of six predefined buckets using OpenAI
 * @param {object} service - The service object to categorize
 * @returns {Promise<string>} - The category name
 */
async function categorizeServiceWithOpenAI(service) {
  const MAX_RETRIES = 3;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < MAX_RETRIES) {
  try {
      console.log(`[SERVICE_CATEGORIZATION_AI] Starting OpenAI categorization for: "${service.description}" (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
    
    // Extract relevant information
    const description = service.description || '';
    const codeDescription = service.codeDescription || '';
    const code = service.code || '';
    
    // Create a prompt for OpenAI
    const prompt = `I need to categorize this medical service into one of six predefined categories:
    
Service Description: "${description}"
${code ? `CPT/HCPCS Code: ${code}` : ''}
${codeDescription ? `Code Description: "${codeDescription}"` : ''}

The six categories are:
1. Office visits and Consultations - includes preventive visits, check-ups, evaluations, consultations
2. Procedures and Surgeries - includes surgical procedures, biopsies, repairs, implants
3. Lab and Diagnostic Tests - includes laboratory tests, imaging, scans, blood work
4. Drugs and Infusions - includes medications, injections, infusions, vaccines
5. Medical Equipment - includes supplies, devices, prosthetics, orthotics
6. Hospital stays and emergency care visits - includes inpatient care, emergency room visits

Please categorize this service into one of these six categories. Respond in JSON format with the following structure:
{
  "category": "Category Name",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this category is appropriate"
}`;

    console.log('[SERVICE_CATEGORIZATION_AI] Calling OpenAI API for service categorization');
      
      // Call OpenAI API with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are a medical billing expert specializing in categorizing medical services. Your task is to categorize services into one of six predefined categories. Be precise and consider both the service description and CPT/HCPCS code if provided.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
      }, { signal: controller.signal });
      
      clearTimeout(timeoutId);
    
    // Parse the response
      const contentStr = response.choices[0]?.message?.content;
      if (!contentStr) {
        throw new Error('Empty response from OpenAI');
      }

      // Try to parse JSON with error handling
      let result;
      try {
        result = JSON.parse(contentStr);
      } catch (parseError) {
        console.error('[SERVICE_CATEGORIZATION_AI] Failed to parse OpenAI response:', contentStr);
        throw new Error(`Failed to parse OpenAI response: ${parseError.message}`);
      }
      
    console.log('[SERVICE_CATEGORIZATION_AI] OpenAI response:', JSON.stringify(result, null, 2));
    
    // Validate the category
    const validCategories = [
      'Office visits and Consultations',
      'Procedures and Surgeries',
      'Lab and Diagnostic Tests',
      'Drugs and Infusions',
      'Medical Equipment',
      'Hospital stays and emergency care visits'
    ];
    
    if (!validCategories.includes(result.category)) {
      console.warn('[SERVICE_CATEGORIZATION_AI] OpenAI returned invalid category:', result.category);
        // Instead of returning immediately, let's map to the closest category
        const defaultCategory = 'Other';
        // Try to find the closest category
        for (const validCategory of validCategories) {
          if (result.category.toLowerCase().includes(validCategory.toLowerCase())) {
            console.log(`[SERVICE_CATEGORIZATION_AI] Mapped invalid category "${result.category}" to "${validCategory}"`);
            return { 
              category: validCategory, 
              reasoning: result.reasoning || `Mapped from "${result.category}"` 
            };
          }
        }
        return { category: defaultCategory, reasoning: null };
    }
    
    console.log(`[SERVICE_CATEGORIZATION_AI] Categorized as "${result.category}" with confidence ${result.confidence}`);
    return { 
      category: result.category, 
      reasoning: result.reasoning 
    };
  } catch (error) {
      lastError = error;
      console.error(`[SERVICE_CATEGORIZATION_AI] Error categorizing service with OpenAI (Attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
      
      // Implement exponential backoff
      const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 8000); // Max 8 second backoff
      console.log(`[SERVICE_CATEGORIZATION_AI] Retrying in ${backoffTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffTime));
      
      retryCount++;
    }
  }

  // After all retries failed, use a fallback method or return a default value
  console.error(`[SERVICE_CATEGORIZATION_AI] All ${MAX_RETRIES} attempts failed. Last error:`, lastError);
  
  // Attempt to categorize based on description keywords as fallback
  return fallbackCategorization(service);
}

/**
 * Fallback categorization using keyword matching when OpenAI fails
 */
function fallbackCategorization(service) {
  const description = (service.description || '').toLowerCase();
  
  // Define category keywords
  const categoryKeywords = {
    'Office visits and Consultations': ['office visit', 'consult', 'evaluation', 'exam', 'check-up', 'checkup'],
    'Procedures and Surgeries': ['surgery', 'procedure', 'biopsy', 'repair', 'implant', 'removal'],
    'Lab and Diagnostic Tests': ['lab', 'test', 'blood', 'urine', 'specimen', 'diagnostic', 'x-ray', 'scan', 'mri', 'ct'],
    'Drugs and Infusions': ['drug', 'medication', 'injection', 'infusion', 'iv', 'vaccine', 'ondansetron', 'promethazine', 'famotidine'],
    'Medical Equipment': ['equipment', 'supply', 'device', 'prosthetic', 'orthotic', 'brace'],
    'Hospital stays and emergency care visits': ['emergency', 'er', 'hospital', 'inpatient', 'room', 'admission']
  };
  
  // Check each category for matching keywords
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (description.includes(keyword)) {
        console.log(`[FALLBACK_CATEGORIZATION] Matched service to "${category}" based on keyword "${keyword}"`);
        return {
          category,
          reasoning: `Fallback categorization based on keyword match: "${keyword}"`
        };
      }
    }
  }
  
  // If no keywords match, use the code to determine if it's a lab test
  const code = (service.code || '').trim();
  if (/^8\d{4}$/.test(code)) {
    return {
      category: 'Lab and Diagnostic Tests',
      reasoning: 'Fallback categorization based on CPT code pattern for lab tests'
    };
  }
  
  // Default fallback
  return { 
    category: 'Other', 
    reasoning: 'Unable to categorize with OpenAI or fallback methods'
  };
}

/**
 * Categorize a service using its description or existing code
 * @param {Object} service - The service to categorize
 * @returns {Promise<Object>} The category and reasoning
 */
async function categorizeService(service) {
  // If service already has a category, use it
  if (service.category) {
    return {
      category: service.category,
      reasoning: service.categoryReasoning || "Category already determined"
    };
  }
  
  // Otherwise use OpenAI to categorize
  return categorizeServiceWithOpenAI(service);
}

/**
 * Use OpenAI to determine the most appropriate database for a service
 * @param {Object} service - The service to categorize
 * @param {Object} billContext - Additional context about the bill
 * @returns {Promise<Object>} Database selection result
 */
async function determineServiceDatabase(service, billContext) {
  try {
    console.log('[DATABASE_SELECTION] Determining appropriate database for service:', service.description);

    const prompt = `As a medical billing expert, determine the most appropriate pricing database for this medical service. Consider the service description, any codes present, and the overall context of the bill.

Service Description: "${service.description}"
${service.code ? `Service Code: ${service.code}` : ''}
${service.amount ? `Amount Billed: ${service.amount}` : ''}

Bill Context:
${billContext.facilityType ? `Facility Type: ${billContext.facilityType}` : ''}
${billContext.serviceLocation ? `Service Location: ${billContext.serviceLocation}` : ''}
${billContext.billType ? `Bill Type: ${billContext.billType}` : ''}

Available Databases:
1. Medicare Physician Fee Schedule (PFS/CPT)
   - Used for: Professional services, office visits, procedures, surgeries
   - Code ranges: 99201-99499 (E&M), 10000-69999 (procedures)
   - Context: Professional services, physician work

2. Clinical Lab Fee Schedule (CLFS)
   - Used for: Laboratory tests, pathology, some diagnostic procedures
   - Code ranges: 80000-89999 (lab tests), 70000-79999 (diagnostic imaging)
   - Context: Laboratory work, diagnostic testing

3. Average Sales Price (ASP)
   - Used for: Drugs, biologicals, injections, infusions
   - Code ranges: J0000-J9999
   - Context: Drug administration, medication costs

Analyze the service and determine which database is most appropriate. Consider:
1. The nature of the service (procedure, test, drug, etc.)
2. The setting where it's typically performed
3. Any clinical indicators in the description
4. Standard medical billing practices

Respond in JSON format:
{
  "selectedDatabase": "PFS|CLFS|ASP",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why this database is most appropriate",
  "suggestedCategory": "one of the six standard categories",
  "expectedCodePattern": "regex pattern or range"
}`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a medical billing expert specializing in determining the appropriate pricing databases for medical services. Focus on accuracy and consider all aspects of the service.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log('[DATABASE_SELECTION] OpenAI determination:', result);

    return {
      database: result.selectedDatabase,
      confidence: result.confidence,
      reasoning: result.reasoning,
      category: result.suggestedCategory,
      codePattern: result.expectedCodePattern
    };
  } catch (error) {
    console.error('[DATABASE_SELECTION] Error in database determination:', error);
    return null;
  }
}

/**
 * Enhance services with CPT codes
 * @param {Array} services - The services extracted from the bill
 * @param {Object} patientInfo - The patient information from the bill
 * @param {Object} billInfo - Information about the bill
 * @returns {Promise<Array>} - The enhanced services with CPT codes
 */
async function enhanceServicesWithCPTCodes(services, patientInfo, billInfo) {
  console.log('[SERVICE_ENHANCEMENT] Starting service enhancement for services:', JSON.stringify(services, null, 2));
  
  // Instead of processing services sequentially, we'll process them in parallel
  console.log(`[SERVICE_ENHANCEMENT] Processing ${services.length} services in parallel`);
  
  // Create an async function to process a single service
  const processService = async (service, index) => {
    console.log(`[SERVICE_ENHANCEMENT] Processing service ${index + 1}/${services.length}:`, service);
    
    try {
      // Start by copying the service or ensuring it has the enhanced structure
      const enhancedService = service.billingCodes ? service : enhanceServiceStructure(service);
      
      // If the service already has an enhanced category, use it
      // Otherwise, categorize using the old system for backward compatibility
      if (!enhancedService.enhancedCategory) {
        if (!enhancedService.category) {
          const categoryResult = await categorizeService(service);
          enhancedService.category = categoryResult.category;
          enhancedService.categoryReasoning = categoryResult.reasoning;
          console.log(`[SERVICE_ENHANCEMENT] Service ${index + 1} categorized as:`, enhancedService.category);
        }
      }
      
      // Determine which category to use for matching
      const category = enhancedService.enhancedCategory || enhancedService.category;
      console.log(`[SERVICE_ENHANCEMENT] Using category for matching service ${index + 1}:`, category);
      
      // Handle different categories with their respective matchers
      switch (category) {
        // Office Visits & Consultations
        case 'Office Visits & Consultations':
        case 'Office visits and Consultations':
          console.log(`[SERVICE_ENHANCEMENT] Using Medicare Fee Schedule for Office Visit (service ${index + 1})`);
          const medicareMatch = await matchServiceToMedicare(service, {
            category: 'Office visits and Consultations', // Use old category for backward compatibility
            patientAge: patientInfo?.age,
            serviceDate: service.date,
            facilityType: billInfo?.facilityType
          });
          
          if (medicareMatch) {
            enhancedService.code = medicareMatch.code;
            enhancedService.codeDescription = medicareMatch.description;
            enhancedService.codeConfidence = medicareMatch.confidence;
            enhancedService.codeReasoning = medicareMatch.reasoning;
            enhancedService.codeMatchMethod = medicareMatch.matchMethod;
            enhancedService.pricingModel = 'PFS';
            
            // Set reimbursement rates
            const facilityType = determineFacilityType(service, billInfo);
            enhancedService.facilityType = facilityType;
            
            if (facilityType === 'facility' && medicareMatch.facilityRate !== null) {
              enhancedService.reimbursementRate = medicareMatch.facilityRate;
              enhancedService.reimbursementType = 'facility';
            } else if (medicareMatch.nonFacilityRate !== null) {
              enhancedService.reimbursementRate = medicareMatch.nonFacilityRate;
              enhancedService.reimbursementType = 'non-facility';
            }
          }
          break;
          
        // Outpatient Procedures & Surgeries
        case 'Outpatient Procedures & Surgeries':
        case 'Procedures and Surgeries':
          if (enhancedService.setting !== 'inpatient') {
            console.log('[SERVICE_ENHANCEMENT] Processing outpatient procedure');
            
            // Create bill context for component decision
            const procedureBillContext = {
              ...billInfo,
              otherServices: services.filter(s => s !== service).map(s => ({
                description: s.description,
                code: s.code,
                category: s.category || s.enhancedCategory
              }))
            };
            
            // Decide whether to use professional or facility component
            const componentDecision = await decideServiceComponent(service, procedureBillContext);
            console.log(`[SERVICE_ENHANCEMENT] Component decision: ${componentDecision.componentType} (${componentDecision.confidence.toFixed(2)})`);
            
            // Store the component decision in the enhanced service
            enhancedService.componentType = componentDecision.componentType;
            enhancedService.componentConfidence = componentDecision.confidence;
            enhancedService.componentReasoning = componentDecision.reasoning;
            
            // Get the appropriate matcher based on the component decision
            const matcher = getDatabaseMatcher(componentDecision.database);
            
            // Match the service using the selected database
            const match = await matcher(service, {
              category: 'Procedures and Surgeries',
              patientAge: patientInfo?.age,
              serviceDate: service.date,
              facilityType: billInfo?.facilityType,
              componentType: componentDecision.componentType
            });
            
            if (match) {
              enhancedService.code = match.code;
              enhancedService.codeDescription = match.description;
              enhancedService.codeConfidence = match.confidence;
              enhancedService.codeReasoning = match.reasoning;
              enhancedService.codeMatchMethod = match.matchMethod;
              enhancedService.pricingModel = componentDecision.database;
              
              // Set reimbursement rates based on component type
              if (componentDecision.componentType === 'facility') {
                enhancedService.facilityType = 'facility';
                
                // For OPPS, use the payment rate
                if (componentDecision.database === 'OPPS' && match.paymentRate) {
                  enhancedService.reimbursementRate = match.paymentRate;
                  enhancedService.reimbursementType = 'facility';
                  enhancedService.apcCode = match.apcCode;
                  enhancedService.apcDescription = match.apcDescription;
                  enhancedService.minCopay = match.minCopay;
                  enhancedService.status = match.status;
                } 
                // For PFS, use the facility rate
                else if (match.facilityRate !== null) {
                  enhancedService.reimbursementRate = match.facilityRate;
                  enhancedService.reimbursementType = 'facility';
                }
              } else if (componentDecision.componentType === 'professional') {
                // For professional component, use the appropriate rate based on setting
                if (billInfo?.facilityType === 'facility' && match.facilityRate !== null) {
                  enhancedService.facilityType = 'facility';
                  enhancedService.reimbursementRate = match.facilityRate;
                  enhancedService.reimbursementType = 'facility';
                } else if (match.nonFacilityRate !== null) {
                  enhancedService.facilityType = 'non-facility';
                  enhancedService.reimbursementRate = match.nonFacilityRate;
                  enhancedService.reimbursementType = 'non-facility';
                }
              } else if (componentDecision.componentType === 'global') {
                // For global services, use the non-facility rate
                enhancedService.facilityType = 'non-facility';
                enhancedService.reimbursementRate = match.nonFacilityRate;
                enhancedService.reimbursementType = 'global';
              }
            }
          }
          break;
          
        // Inpatient Procedures & Surgeries
        case 'Inpatient Procedures & Surgeries':
          console.log('[SERVICE_ENHANCEMENT] Using DRG for Inpatient Procedure');
          if (enhancedService.billingCodes?.drgCodes?.length > 0) {
            const drgCode = enhancedService.billingCodes.drgCodes[0].code;
            // Look up DRG code
            const drgMatch = await advancedClassifier.lookupDRGCode(drgCode);
            
            if (drgMatch) {
              enhancedService.code = drgMatch.code;
              enhancedService.codeDescription = drgMatch.description;
              enhancedService.codeConfidence = 0.95;
              enhancedService.codeReasoning = 'Matched using DRG code';
              enhancedService.codeMatchMethod = 'drg_code';
              enhancedService.pricingModel = 'DRG';
              enhancedService.reimbursementRate = drgMatch.rate;
              enhancedService.reimbursementType = 'drg';
            }
          } else {
            // Fallback to Medicare matcher for inpatient procedures without DRG
            console.log('[SERVICE_ENHANCEMENT] No DRG code found, using Medicare Fee Schedule for Inpatient Procedure');
            const inpatientMatch = await matchServiceToMedicare(service, {
              category: 'Procedures and Surgeries',
              patientAge: patientInfo?.age,
              serviceDate: service.date,
              facilityType: 'facility'
            });
            
            if (inpatientMatch) {
              enhancedService.code = inpatientMatch.code;
              enhancedService.codeDescription = inpatientMatch.description;
              enhancedService.codeConfidence = inpatientMatch.confidence;
              enhancedService.codeReasoning = inpatientMatch.reasoning;
              enhancedService.codeMatchMethod = inpatientMatch.matchMethod;
              enhancedService.pricingModel = 'DRG';
              enhancedService.facilityType = 'facility';
              enhancedService.reimbursementRate = inpatientMatch.facilityRate;
              enhancedService.reimbursementType = 'facility';
            }
          }
          break;
          
        // Lab & Diagnostic Tests
        case 'Lab & Diagnostic Tests':
        case 'Lab and Diagnostic Tests':
          console.log(`[SERVICE_ENHANCEMENT] Using Medicare CLFS database for Lab/Diagnostic (service ${index + 1})`);
          const labMatch = await matchServiceToLab(service.description, {
            category: 'Lab and Diagnostic Tests', // Use old category for backward compatibility
            patientAge: patientInfo?.age,
            serviceDate: service.date
          });
          
          if (labMatch) {
            enhancedService.code = labMatch.labCode;
            enhancedService.codeDescription = labMatch.description;
            enhancedService.codeConfidence = labMatch.confidence;
            enhancedService.codeReasoning = labMatch.reasoning;
            enhancedService.codeMatchMethod = labMatch.matchMethod;
            enhancedService.pricingModel = 'CLFS';
            enhancedService.reimbursementType = 'lab';
            enhancedService.labRate = labMatch.rate;
            
            // Log whether this was a database match or fallback
            if (labMatch.reasoning && labMatch.reasoning.includes('database')) {
              console.log(`[SERVICE_ENHANCEMENT] Using database rates for lab service ${index + 1}`);
            } else {
              console.log(`[SERVICE_ENHANCEMENT] Using fallback rates for lab service ${index + 1}:`, labMatch.reasoning);
            }
            
            // Calculate potential savings
            enhancedService.potentialSavings = calculatePotentialSavings(enhancedService);
          }
          break;
          
        // Drugs & Infusions
        case 'Drugs & Infusions (Hospital vs. Retail)':
        case 'Drugs and Infusions':
          console.log(`[SERVICE_ENHANCEMENT] Using Medicare ASP database for Drugs/Infusions (service ${index + 1})`);
          const drugMatch = await matchServiceToDrug(service);
          
          console.log(`[SERVICE_ENHANCEMENT] Drug match result for service ${index + 1}:`, drugMatch);
          
          if (drugMatch && drugMatch.matched) {
            enhancedService.code = drugMatch.code;
            enhancedService.codeDescription = drugMatch.description;
            enhancedService.codeConfidence = drugMatch.confidence;
            enhancedService.codeReasoning = drugMatch.reasoning;
            enhancedService.codeMatchMethod = drugMatch.matchMethod;
            enhancedService.pricingModel = 'ASP';
            enhancedService.reimbursementType = 'asp';
            
            // Log whether this was a database match or fallback
            if (drugMatch.reasoning && drugMatch.reasoning.includes('database')) {
              console.log(`[SERVICE_ENHANCEMENT] Using database rates for drug service ${index + 1}`);
            } else {
              console.log(`[SERVICE_ENHANCEMENT] Using fallback rates for drug service ${index + 1}:`, drugMatch.reasoning);
            }
            
            // Set both original ASP price and ASP+6%
            if (drugMatch.price) {
              enhancedService.aspPrice = drugMatch.price;
              enhancedService.reimbursementRate = drugMatch.price * 1.06;
              console.log(`[SERVICE_ENHANCEMENT] Set ASP price for service ${index + 1}:`, drugMatch.price, 'and ASP+6%:', enhancedService.reimbursementRate);
              
              // Calculate potential savings
              enhancedService.potentialSavings = calculatePotentialSavings(enhancedService);
              console.log(`[SERVICE_ENHANCEMENT] Calculated savings for service ${index + 1}:`, enhancedService.potentialSavings);
            }

            // If the price was adjusted for dosage, include that information
            if (drugMatch.dosageAdjusted) {
              enhancedService.dosageAdjusted = true;
              enhancedService.originalPrice = drugMatch.originalPrice;
            }
          }
          break;
          
        // Medical Equipment
        case 'Medical Equipment (DME) & Therapies':
        case 'Medical Equipment':
          console.log('[SERVICE_ENHANCEMENT] Using DME matcher for Medical Equipment');
          const equipmentMatch = await matchServiceToDME(service, {
            category: 'Medical Equipment',
            patientAge: patientInfo?.age,
            serviceDate: service.date
          });
          
          if (equipmentMatch) {
            enhancedService.code = equipmentMatch.code;
            enhancedService.codeDescription = equipmentMatch.description;
            enhancedService.codeConfidence = equipmentMatch.confidence;
            enhancedService.codeReasoning = equipmentMatch.reasoning;
            enhancedService.codeMatchMethod = equipmentMatch.matchMethod;
            enhancedService.pricingModel = 'DMEPOS';
            enhancedService.reimbursementType = 'dme';
            
            if (equipmentMatch.price) {
              enhancedService.reimbursementRate = equipmentMatch.price;
            }
          }
          break;
          
        // Hospital Stays & Emergency Visits
        case 'Hospital Stays & Emergency Visits':
        case 'Hospital stays and emergency care visits':
          console.log('[SERVICE_ENHANCEMENT] Using Medicare Fee Schedule for Hospital/ER');
          const hospitalMatch = await matchServiceToMedicare(service, {
            category: 'Hospital stays and emergency care visits', // Use old category for backward compatibility
            patientAge: patientInfo?.age,
            serviceDate: service.date,
            facilityType: 'facility' // Always facility for hospital/ER
          });
          
          if (hospitalMatch) {
            enhancedService.code = hospitalMatch.code;
            enhancedService.codeDescription = hospitalMatch.description;
            enhancedService.codeConfidence = hospitalMatch.confidence;
            enhancedService.codeReasoning = hospitalMatch.reasoning;
            enhancedService.codeMatchMethod = hospitalMatch.matchMethod;
            enhancedService.pricingModel = 'OPPS';
            enhancedService.facilityType = 'facility';
            enhancedService.reimbursementType = 'facility';
            
            // Log whether this was a database match or fallback
            if (hospitalMatch.reasoning && hospitalMatch.reasoning.includes('database')) {
              console.log('[SERVICE_ENHANCEMENT] Using database rates for hospital/ER service');
            } else {
              console.log('[SERVICE_ENHANCEMENT] Using fallback rates for hospital/ER service:', hospitalMatch.reasoning);
            }
            
            // Always use facility rate for emergency services
            if (hospitalMatch.facilityRate !== null) {
              enhancedService.reimbursementRate = hospitalMatch.facilityRate;
            } else if (hospitalMatch.nonFacilityRate !== null) {
              // Fallback to non-facility rate if facility rate is not available
              enhancedService.reimbursementRate = hospitalMatch.nonFacilityRate;
              console.log('[SERVICE_ENHANCEMENT] WARNING: Using non-facility rate for hospital/ER service due to missing facility rate');
            }
          }
          break;
          
        default:
          console.log(`[SERVICE_ENHANCEMENT] Unknown category for service ${index + 1}:`, category);
          // Try to use CPT matcher as fallback
          const cptMatch = await matchServiceToCPT(service.description, {
            patientAge: patientInfo?.age,
            serviceDate: service.date
          });
          
          if (cptMatch) {
            enhancedService.code = cptMatch.cptCode;
            enhancedService.codeDescription = cptMatch.description;
            enhancedService.codeConfidence = cptMatch.confidence;
            enhancedService.codeReasoning = cptMatch.reasoning;
            enhancedService.codeMatchMethod = cptMatch.matchMethod;
            
            const facilityType = determineFacilityType(service, billInfo);
            enhancedService.facilityType = facilityType;
            
            if (facilityType === 'facility' && cptMatch.facilityRate !== null) {
              enhancedService.reimbursementRate = cptMatch.facilityRate;
              enhancedService.reimbursementType = 'facility';
            } else if (cptMatch.nonFacilityRate !== null) {
              enhancedService.reimbursementRate = cptMatch.nonFacilityRate;
              enhancedService.reimbursementType = 'non-facility';
            }
          }
          break;
      }
      
      // Calculate potential savings for all services that have a rate
      // This ensures we don't miss any service types
      if (!enhancedService.potentialSavings && 
          (enhancedService.reimbursementRate || enhancedService.labRate)) {
        enhancedService.potentialSavings = calculatePotentialSavings(enhancedService);
      }
      
      console.log(`[SERVICE_ENHANCEMENT] Enhanced service ${index + 1} result:`, enhancedService);
      return enhancedService;
    } catch (error) {
      console.error(`[SERVICE_ENHANCEMENT] Error enhancing service ${index + 1}:`, error);
      return service; // Return the original service in case of error
    }
  };
  
  try {
    // Process all services in parallel using Promise.all
    const enhancedServices = await Promise.all(
      services.map((service, index) => processService(service, index))
    );
    
    console.log('[SERVICE_ENHANCEMENT] All services enhanced in parallel. Total services:', enhancedServices.length);
    console.log('After CPT enhancement, services:', JSON.stringify(enhancedServices, null, 2));
    return enhancedServices;
  } catch (error) {
    console.error('[SERVICE_ENHANCEMENT] Error in parallel processing:', error);
    // If parallel processing fails, fall back to the original services
    return services;
  }
}

/**
 * Calculate potential savings for a service
 * @param {object} service - The service object to calculate savings for
 */
function calculatePotentialSavings(service) {
  try {
    // Clean and convert the amount string to a number
    if (!service.amount || typeof service.amount !== 'string') {
      console.log('[SAVINGS_CALCULATION] Missing amount for service:', service.description);
      return null;
    }
    
    const cleanAmount = service.amount.replace(/[$,]/g, '');
    const billedAmount = parseFloat(cleanAmount);
    
    if (isNaN(billedAmount)) {
      console.log('[SAVINGS_CALCULATION] Invalid amount format:', service.amount);
      return null;
    }

    let standardRate = null;
    
    // Determine which type of rate to use
    if (service.category === 'Lab and Diagnostic Tests' && service.labRate) {
      standardRate = parseFloat(service.labRate);
    } else if (service.category === 'Drugs and Infusions' && service.reimbursementRate) {
      standardRate = parseFloat(service.reimbursementRate);
    } else if (service.reimbursementRate && service.reimbursementRate !== 'Coming Soon') {
      if (typeof service.reimbursementRate === 'number') {
        standardRate = service.reimbursementRate;
      } else if (typeof service.reimbursementRate === 'string') {
        standardRate = parseFloat(service.reimbursementRate.replace(/[$,]/g, ''));
      }
    }
    
    if (standardRate === null || isNaN(standardRate)) {
      console.log('[SAVINGS_CALCULATION] No valid rate found for:', service.description);
      return null;
    }
    
    // Calculate the difference and potential savings percentage
    const difference = billedAmount - standardRate;
    const savingsPercentage = (difference / billedAmount) * 100;
    
    console.log(`[SAVINGS_CALCULATION] ${service.description}: Billed $${billedAmount}, Rate $${standardRate}, Diff $${difference}, Savings ${savingsPercentage.toFixed(2)}%`);
    
    // Return both the absolute savings and the percentage
    return {
      amount: difference > 0 ? difference : 0,
      percentage: difference > 0 ? savingsPercentage : 0,
      overchargeLevel: savingsPercentage > 75 ? 'high' : 
                       savingsPercentage > 25 ? 'medium' : 
                       savingsPercentage > 5 ? 'low' : 'none'
    };
  } catch (error) {
    console.error('[SAVINGS_CALCULATION] Error calculating savings:', error);
    return null;
  }
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
    // First verify if it's a medical bill
    console.log('[ENHANCED_ANALYSIS] Verifying if document is a medical bill...');
    const verificationResult = await processWithLLM(extractedText, true);
    console.log('[ENHANCED_ANALYSIS] Verification result:', verificationResult);
    
    if (!verificationResult.isMedicalBill) {
      console.log('[ENHANCED_ANALYSIS] Document is not a medical bill. Reason:', verificationResult.reason);
      return {
        isMedicalBill: false,
        confidence: verificationResult.confidence,
        reason: verificationResult.reason
      };
    }
    
    // Extract billing codes from text
    console.log('[ENHANCED_ANALYSIS] Extracting billing codes from text...');
    const extractedCodes = extractBillingCodes(extractedText);
    console.log('[ENHANCED_ANALYSIS] Extracted billing codes:', JSON.stringify(extractedCodes, null, 2));
    
    try {
      const enhancedData = await processWithLLM(extractedText, false);
      console.log('[ENHANCED_ANALYSIS] OpenAI analysis completed successfully');
      console.log('[ENHANCED_ANALYSIS] Raw extracted data:', JSON.stringify(enhancedData, null, 2));
      
      // Check if services were extracted
      if (enhancedData.services && enhancedData.services.length > 0) {
        console.log(`[ENHANCED_ANALYSIS] Found ${enhancedData.services.length} services, will enhance with advanced classification`);
        
        // Add extracted codes to each service
        enhancedData.services = await Promise.all(enhancedData.services.map(async (service) => {
          // Enhance service structure
          const enhancedService = enhanceServiceStructure(service);
          
          // Determine service setting (inpatient/outpatient)
          enhancedService.setting = determineServiceSetting(service, extractedCodes);
          
          // Add extracted codes to the service
          enhancedService.billingCodes = extractedCodes;
          
          // Categorize with advanced system
          const categoryResult = await categorizeWithAdvancedSystem(enhancedService, extractedCodes);
          enhancedService.enhancedCategory = categoryResult.category;
          enhancedService.categoryReasoning = categoryResult.reasoning;
          enhancedService.pricingModel = categoryResult.pricingModel;
          
          return enhancedService;
        }));
      } else {
        console.log('[ENHANCED_ANALYSIS] No services found in extracted data, skipping advanced classification');
      }
      
      // Add billing codes to the top level
      enhancedData.billingCodes = extractedCodes;
      enhancedData.advancedClassification = true;
      
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