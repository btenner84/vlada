import pdf from 'pdf-parse';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import { getWorker, terminateWorker } from './tesseractWorker';
import sharp from 'sharp';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Enhanced image pre-processing optimized for medical bills and numerical data extraction
async function preprocessImage(imageBuffer) {
  try {
    console.log('Pre-processing image with advanced techniques for improved OCR...');
    
    // Multi-step processing pipeline optimized for different document characteristics
    // Create multiple processed versions with different parameters
    const [highContrastVersion, textOptimizedVersion, numberOptimizedVersion] = await Promise.all([
      // Version 1: High contrast for general text
      sharp(imageBuffer)
        .grayscale()
        .normalize()
        .sharpen({ sigma: 1.5 })
        .gamma(1.2) // Adjust gamma to enhance mid-tones
        .toBuffer(),
      
      // Version 2: Optimized for text readability
      sharp(imageBuffer)
        .grayscale()
        .linear(1.3, 0) // Increase contrast
        .modulate({ brightness: 1.05 }) // Slightly brighten
        .sharpen({ sigma: 1.0 })
        .toBuffer(),
      
      // Version 3: Optimized specifically for numbers (higher contrast)
      sharp(imageBuffer)
        .grayscale()
        .normalize()
        .threshold(150) // Higher threshold for numbers
        .sharpen({ sigma: 2.0 }) // More aggressive sharpening
        .median(1) // Remove noise while preserving edges
        .toBuffer()
    ]);
    
    // Store all versions for OCR processing
    return {
      original: imageBuffer,
      highContrast: highContrastVersion,
      textOptimized: textOptimizedVersion,
      numberOptimized: numberOptimizedVersion
    };
  } catch (error) {
    console.error('Advanced image pre-processing error:', error);
    // Fallback to basic processing
    try {
      return {
        original: imageBuffer,
        highContrast: await sharp(imageBuffer).grayscale().normalize().sharpen().toBuffer(),
        textOptimized: imageBuffer,
        numberOptimized: imageBuffer
      };
    } catch (fallbackError) {
      console.error('Fallback processing error:', fallbackError);
      return { original: imageBuffer }; // Return original as last resort
    }
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
  console.log('Starting enhanced text extraction process with multi-pass OCR...');
  let worker = null;
  const combinedResults = [];
  
  try {
    // Pre-process the image with multiple optimizations
    const processedBuffers = await preprocessImage(imageBuffer);
    console.log('Image pre-processing complete, running OCR on multiple versions...');
    
    // Run OCR on each optimized version
    worker = await getWorker();
    
    // Configure Tesseract for enhanced number recognition
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:$%#@!&*()-+=[]{}/<>_"\'\\|~`',
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: '6', // Assume a single uniform block of text
      tessedit_ocr_engine_mode: '2', // Use LSTM only
      debug_file: '/dev/null'
    });
    
    // Process original image
    const originalResult = await processImageBuffer(worker, processedBuffers.original, 'original');
    combinedResults.push(originalResult);
    
    // Process high contrast version (optimized for general content)
    const highContrastResult = await processImageBuffer(worker, processedBuffers.highContrast, 'high-contrast');
    combinedResults.push(highContrastResult);
    
    // Process text optimized version
    const textResult = await processImageBuffer(worker, processedBuffers.textOptimized, 'text-optimized');
    combinedResults.push(textResult);
    
    // Process number optimized version with special settings for numeric data
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789.,;:$%#@!&*()-+=',
      tessedit_ocr_engine_mode: '2', // Use LSTM only
      classify_bln_numeric_mode: '1', // Only numeric characters
    });
    const numberResult = await processImageBuffer(worker, processedBuffers.numberOptimized, 'number-optimized');
    combinedResults.push(numberResult);
    
    // Combine and reconcile results from different passes
    const mergedText = mergeOcrResults(combinedResults);
    console.log('Multi-pass OCR extraction complete, combined length:', mergedText.length);
    console.log('First 200 chars:', mergedText.substring(0, 200));
    
    return mergedText;
  } catch (error) {
    console.error('Image OCR error:', error);
    error.step = 'image_ocr';
    error.details = {
      errorMessage: error.message,
      errorStack: error.stack
    };
    throw error;
  } finally {
    // Clean up
    if (worker) {
      await terminateWorker(worker);
    }
  }
}

// Helper function to process a single image buffer
async function processImageBuffer(worker, buffer, version) {
  try {
    // Convert processed buffer to base64
    const base64Image = buffer.toString('base64');
    
    // Recognize text from base64
    const result = await worker.recognize(Buffer.from(base64Image, 'base64'));
    
    console.log(`OCR (${version}) extraction complete, confidence:`, result.data.confidence);
    
    return {
      text: result.data.text,
      confidence: result.data.confidence,
      version: version,
      words: result.data.words || [],
      numbers: extractNumbersFromText(result.data.text)
    };
  } catch (error) {
    console.error(`Error processing ${version} image:`, error);
    return { 
      text: '', 
      confidence: 0,
      version: version,
      error: error.message 
    };
  }
}

// Extract all numbers from text with their positions
function extractNumbersFromText(text) {
  if (!text) return [];
  
  const numbers = [];
  // Match currency amounts ($123.45), percentages, and plain numbers
  const numberRegex = /(\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?%?|\d+\.\d+|\d+)/g;
  let match;
  
  while ((match = numberRegex.exec(text)) !== null) {
    numbers.push({
      value: match[0],
      position: match.index,
      length: match[0].length,
      // Classify the type of number
      isCurrency: match[0].startsWith('$') || /\$?\d{1,3}(?:,\d{3})*\.\d{2}/.test(match[0]),
      isPercentage: match[0].endsWith('%'),
      isDecimal: match[0].includes('.') && !match[0].startsWith('$') && !match[0].endsWith('%')
    });
  }
  
  return numbers;
}

// Intelligently merge results from multiple OCR passes
function mergeOcrResults(results) {
  if (results.length === 0) return '';
  if (results.length === 1) return results[0].text;
  
  // Start with the result that has the highest confidence
  const sortedResults = [...results].sort((a, b) => b.confidence - a.confidence);
  let baseText = sortedResults[0].text;
  
  // Create a set of all unique numbers found across all passes
  const allNumbers = new Set();
  results.forEach(result => {
    if (result.numbers) {
      result.numbers.forEach(num => allNumbers.add(num.value));
    }
  });
  
  // Ensure all numbers appear in the final text
  // For numbers found in number-optimized pass but missing in the base text, append them
  const numbersMissingFromBase = [];
  allNumbers.forEach(num => {
    if (!baseText.includes(num)) {
      numbersMissingFromBase.push(num);
    }
  });
  
  // If there are missing numbers, add a section with them
  if (numbersMissingFromBase.length > 0) {
    baseText += "\n\nADDITIONAL EXTRACTED NUMBERS:\n" + 
                numbersMissingFromBase.join(', ');
  }
  
  return baseText;
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
      const response = await fetch(fileUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const buffer = await response.buffer();
      console.log('File fetched successfully, buffer size:', buffer.length);
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

export async function processWithLLM(text, isVerificationMode = false, enhancedInstructions = '') {
  try {
    console.log('Starting LLM processing with text length:', text.length);
    console.log('Mode:', isVerificationMode ? 'Verification' : 'Data Extraction');
    
    let prompt;
    if (isVerificationMode) {
      prompt = `
        Your task is to determine if the provided text is from a medical bill, medical invoice, healthcare statement, or any health-related financial document.

        A document should be classified as a medical bill if it contains ANY of these indicators:
        - Patient information (name, DOB, ID, etc.)
        - Healthcare provider or facility name
        - Medical procedures, services, treatments
        - Billing amounts, charges, or payments
        - Insurance information
        - Medical terminology
        - Service dates
        - Healthcare-related IDs or account numbers
        - Prescription information
        - Lab tests or diagnostic procedures
        - Any healthcare-related codes (CPT, ICD, HCPCS)
        - Any mention of health, medical, doctor, hospital, clinic, etc.

        REQUIRED JSON FORMAT:
        {
          "isMedicalBill": boolean,
          "confidence": "high" | "medium" | "low",
          "reason": "string"
        }

        IMPORTANT RULES:
        1. Return ONLY the JSON object, no additional text
        2. Be EXTREMELY LIBERAL in your classification - when in doubt, ALWAYS consider it a medical bill
        3. Set isMedicalBill to true if you detect EVEN MINIMAL healthcare-related content
        4. Provide a brief reason for your decision
        5. Set confidence to "high", "medium", or "low"
        6. The document does NOT need to be a formal bill - ANY health-related document should qualify

        TEXT TO ANALYZE:
        ${text}
      `;
    } else {
      prompt = `
        You are a specialized medical bill analysis expert with deep knowledge of healthcare billing, coding systems, and insurance practices. Your task is to carefully analyze the following medical bill text and extract structured information with high precision, especially numerical data.

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
            "facilityName": "string",
            "provider": "string"
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
            "adjustments": "string",
            "type": "string"
          },
          "diagnosticCodes": ["string"],
          "numericalData": {
            "allAmounts": ["string"],
            "allDates": ["string"]
          }
        }

        IMPORTANT EXTRACTION RULES:
        1. For patientInfo.fullName: Extract ONLY the actual patient name without extra text like "Patient:", "Name:", etc. 
           - Do not include labels, dates, or ID numbers in the name field
           - If multiple potential names are present, use context clues to identify the actual patient name
           - Example: "Patient: JOHN DOE DOB: 01/01/1980" should extract only "JOHN DOE"
        
        2. For billInfo.totalAmount: Extract the final amount due from the patient
           - Look for terms like "Total Due", "Amount Due", "Patient Responsibility"
           - Include the currency symbol and decimal points exactly as shown
           - Example: "$123.45" or "USD 123.45"
        
        3. For billInfo.serviceDates: Extract the actual date(s) of service
           - Format as shown in the document (e.g., "MM/DD/YYYY" or "MM/DD/YYYY - MM/DD/YYYY")
           - Distinguish between service dates and the bill date or due date
        
        4. For services: Extract each itemized service listed on the bill
           - Include CPT/HCPCS codes when available
           - Extract exact service descriptions and corresponding amounts
           - Include all listed services, not just a summary
        
        5. Insurance information must be separated properly:
           - Distinguish between insurance payments and patient responsibility
           - Identify adjustments, write-offs, or discounts
        
        6. For numericalData:
           - In allAmounts, include ALL monetary amounts found in the document
           - In allDates, include ALL dates found in the document
           - These fields help ensure no numerical data is missed

        NUMERICAL DATA SPECIAL INSTRUCTIONS:
        Pay special attention to these common numerical formats in medical bills:
        
        1. CPT/HCPCS CODES:
           - CPT codes are 5 digits (e.g., 99213, 36415)
           - HCPCS Level II codes begin with a letter followed by 4 digits (e.g., J1071)
        
        2. ICD-10 DIAGNOSIS CODES:
           - Begin with a letter followed by numbers (e.g., F41.9, J45.901)
           - May include a decimal point
           - Usually 3-7 characters total
        
        3. MONETARY AMOUNTS:
           - Always include dollar signs when present
           - Maintain exact decimal formatting
           - May appear in different sections:
             * Charges column (initial amount)
             * Adjustment column (reductions)
             * Insurance Paid column
             * Patient Responsibility column
        
        4. BILLING IDENTIFIERS:
           - Account numbers: Usually 6-10 digits, may include hyphens
           - Claim numbers: May be alphanumeric
           - Policy numbers: May be alphanumeric
        
        QUALITY ASSURANCE:
        1. Use "Not found" for any truly missing information
        2. Ensure all values are strings (even numbers should be strings)
        3. Always include at least one item in the services array
        4. If an entry contains the text "ERROR" or clearly incorrect information, mark it as "Not found" instead
        5. Eliminate any scanned artifacts, page numbers, or footer information from fields
        6. Closely examine sections labeled as "ADDITIONAL EXTRACTED NUMBERS" for important numerical data
        
        ${enhancedInstructions ? `\n${enhancedInstructions}\n` : ''}

        MEDICAL BILL TEXT TO ANALYZE:
        ${text}
      `;
    }

    console.log('Sending request to OpenAI with optimized prompt...');
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-16k",
      messages: [
        {
          role: "system",
          content: isVerificationMode ? 
            "You are a specialized medical bill analysis expert with deep knowledge of healthcare billing systems. Be LIBERAL in your classification - when in doubt, classify a document as a medical bill. It's better to incorrectly identify a non-medical document than to miss an actual medical bill." :
            "You are a specialized medical bill analysis expert with extensive healthcare industry experience. Your primary focus is on extracting ALL numerical data with perfect accuracy along with all structured information. Follow the extraction rules precisely and ensure no numbers are missed."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: isVerificationMode ? 0.3 : 0.1,
      max_tokens: 4000
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