import pdf from 'pdf-parse';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import { getWorker, terminateWorker } from './tesseractWorker';
import sharp from 'sharp';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Add image pre-processing functions
async function preprocessImage(imageBuffer) {
  try {
    console.log('Pre-processing image...');
    return await sharp(imageBuffer)
      .grayscale() // Convert to grayscale
      .normalize() // Normalize the image contrast
      .sharpen() // Sharpen the image
      .threshold(128) // Apply binary threshold
      .toBuffer();
  } catch (error) {
    console.error('Image pre-processing error:', error);
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
  console.log('Starting text extraction process...');
  let worker = null;
  
  try {
    // Pre-process the image
    console.log('Pre-processing image for OCR...');
    const processedBuffer = await preprocessImage(imageBuffer);
    console.log('Image pre-processing complete');
    
    worker = await getWorker();
    console.log('Got Tesseract worker');
    
    // Convert processed buffer to base64
    const base64Image = processedBuffer.toString('base64');
    
    // Recognize text from base64
    console.log('Starting OCR recognition...');
    const { data: { text, confidence } } = await worker.recognize(`data:image/png;base64,${base64Image}`);
    console.log('OCR recognition completed with confidence:', confidence);

    if (!text || text.trim().length === 0) {
      throw new Error('No text was extracted from the image');
    }

    // Post-process the extracted text
    const processedText = text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\x20-\x7E\n]/g, '') // Remove non-printable characters
      .trim();

    console.log('OCR completed, text length:', processedText.length);
    console.log('First 200 chars:', processedText.substring(0, 200));
    
    return processedText;
  } catch (error) {
    console.error('Text extraction error:', error);
    throw new Error(`Text extraction failed: ${error.message}`);
  } finally {
    if (worker) {
      try {
        await terminateWorker();
      } catch (error) {
        console.error('Error terminating worker:', error);
      }
    }
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