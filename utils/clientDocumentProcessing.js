import { createWorker } from 'tesseract.js';
import OpenAI from 'openai';
import { analyzeWithOpenAI } from '../services/openaiService';
import { extractNumericalDataFromText } from './analyzedDataProcessor';
import { auth } from '../firebase';

// Client-side worker management
let clientWorker = null;

// Add a flag to track if we're using OpenAI API or client-side processing
let isUsingOpenAI = false;

// Add a function to check if we can use OpenAI API
export function canUseOpenAI() {
  return typeof window !== 'undefined' && 
         window.location && 
         window.location.origin && 
         !isUsingOpenAI; // Prevent recursive calls
}

// Add a function to set the OpenAI usage flag
export function setUsingOpenAI(value) {
  isUsingOpenAI = value;
}

export async function getClientWorker(progressHandler = null) {
  if (!clientWorker) {
    console.log('Initializing new Tesseract worker...');
    clientWorker = await createWorker({
      logger: progressHandler || console.log,
      errorHandler: console.error
    });
    
    console.log('Loading language...');
    await clientWorker.loadLanguage('eng');
    
    console.log('Initializing worker with parameters...');
    await clientWorker.initialize('eng', {
      tessedit_ocr_engine_mode: 1,
      preserve_interword_spaces: 1,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?@#$%&*()-+=:;/\\ '
    });
  }
  return clientWorker;
}

export async function terminateClientWorker() {
  if (clientWorker) {
    await clientWorker.terminate();
    clientWorker = null;
  }
}

export async function extractTextFromImageClient(imageUrl, progressHandler = null) {
  try {
    console.log('Starting client-side image text extraction...', { imageUrl });
    
    // Get the worker with progress handler
    const worker = await getClientWorker(progressHandler);
    
    // Use our proxy endpoint instead of direct Firebase URL
    const proxyUrl = convertToProxyUrl(imageUrl);
    console.log('Using proxy URL for image:', proxyUrl);
    
    // Fetch the image with credentials
    console.log('Fetching image from URL:', proxyUrl);
    const response = await fetch(proxyUrl, {
      credentials: 'include',
      headers: {
        'Accept': 'image/*'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch image:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText
      });
      throw new Error(`Failed to fetch image: ${response.status} - ${errorText}`);
    }
    
    const imageBlob = await response.blob();
    console.log('Image fetched successfully, size:', imageBlob.size, 'bytes');
    
    // Convert the blob to a data URL
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(imageBlob);
    });
    
    console.log('Image converted to data URL, length:', dataUrl.length);
    
    // Create an image element to ensure the image is valid
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
    
    console.log('Image loaded successfully, dimensions:', img.width, 'x', img.height);
    
    // Create a canvas to convert the image to a format Tesseract can handle
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    // Get the canvas data as PNG (a format Tesseract handles well)
    const pngDataUrl = canvas.toDataURL('image/png');
    console.log('Image converted to PNG data URL, length:', pngDataUrl.length);
    
    // Recognize text in the image using the PNG data URL
    console.log('Starting OCR recognition...');
    const result = await worker.recognize(pngDataUrl);
    console.log('OCR recognition completed');
    
    // Extract the text
    const extractedText = result.data.text;
    console.log('Text extracted from image, length:', extractedText.length);
    console.log('First 100 chars of extracted text:', extractedText.substring(0, 100));
    
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('No text was extracted from the image');
    }
    
    return extractedText;
  } catch (error) {
    console.error('Client-side image OCR error:', error);
    throw new Error(`Client-side image OCR failed: ${error.message}`);
  }
}

// Helper function to extract structured data from OCR TSV output
function extractStructuredDataFromOCR(tsv) {
  try {
    if (!tsv) return null;
    
    // Parse TSV data
    const lines = tsv.split('\n').filter(line => line.trim().length > 0);
    if (lines.length <= 1) return null; // Only header or empty
    
    // Extract potential fields based on position and content
    const potentialFields = {
      patientName: [],
      totalAmount: [],
      dates: [],
      serviceDescriptions: []
    };
    
    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length < 12) continue;
      
      const text = parts[11].trim();
      const confidence = parseFloat(parts[10]);
      
      // Skip low confidence text
      if (confidence < 60) continue;
      
      // Check for patient name patterns
      if (/patient|name/i.test(text)) {
        potentialFields.patientName.push({ text, confidence, line: i });
      }
      
      // Check for amount patterns
      if (/\$?\d+\.\d{2}|\$?\d{1,3}(,\d{3})*(\.\d{2})?/i.test(text)) {
        potentialFields.totalAmount.push({ text, confidence, line: i });
      }
      
      // Check for date patterns
      if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i.test(text)) {
        potentialFields.dates.push({ text, confidence, line: i });
      }
      
      // Check for service descriptions
      if (text.length > 10 && !/patient|name|total|amount|date/i.test(text)) {
        potentialFields.serviceDescriptions.push({ text, confidence, line: i });
      }
    }
    
    return potentialFields;
  } catch (error) {
    console.error('Error extracting structured data from OCR:', error);
    return null;
  }
}

export async function extractTextFromPDFClient(pdfUrl, progressHandler = null) {
  console.log('Starting client-side PDF text extraction...');
  
  try {
    // Use our proxy endpoint instead of direct Firebase URL
    const proxyUrl = convertToProxyUrl(pdfUrl);
    console.log('Using proxy URL for PDF:', proxyUrl);
    
    // Load the PDF.js library
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    
    // Fetch the PDF
    console.log('Fetching PDF from URL:', proxyUrl);
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
    }
    
    const pdfData = await response.arrayBuffer();
    console.log('PDF fetched successfully, size:', pdfData.byteLength, 'bytes');
    
    // Load the PDF document
    console.log('Loading PDF document...');
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    console.log('PDF document loaded, pages:', pdf.numPages);
    
    // Extract text from each page
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      console.log(`Processing page ${i} of ${pdf.numPages}...`);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = processPageText(textContent);
      fullText += pageText + '\n\n';
    }
    
    console.log('Text extracted from PDF, length:', fullText.length);
    console.log('First 100 chars of extracted text:', fullText.substring(0, 100));
    
    return fullText;
  } catch (error) {
    console.error('Client-side PDF text extraction error:', error);
    throw new Error(`Client-side PDF text extraction failed: ${error.message}`);
  }
}

// Helper function to process PDF.js text content with position information
function processPageText(textContent) {
  if (!textContent.items || textContent.items.length === 0) {
    return { text: '', items: [] };
  }
  
  // Sort items by y position (top to bottom) and then by x position (left to right)
  const items = [...textContent.items];
  items.sort((a, b) => {
    if (Math.abs(a.transform[5] - b.transform[5]) < 5) {
      return a.transform[4] - b.transform[4];
    }
    return b.transform[5] - a.transform[5];
  });
  
  let lastY = null;
  let text = '';
  const processedItems = [];
  
  for (const item of items) {
    const y = Math.round(item.transform[5]);
    const x = Math.round(item.transform[4]);
    
    // Add newline if y position changes significantly
    if (lastY !== null && Math.abs(y - lastY) > 5) {
      text += '\n';
    } else if (lastY !== null && text.length > 0 && !text.endsWith(' ')) {
      // Add space between words on the same line
      text += ' ';
    }
    
    text += item.str;
    processedItems.push({
      text: item.str,
      x,
      y,
      width: item.width,
      height: item.height
    });
    
    lastY = y;
  }
  
  return {
    text,
    items: processedItems
  };
}

export async function detectFileTypeClient(fileUrl) {
  console.log('Detecting file type for URL:', fileUrl);
  
  try {
    // Use our proxy endpoint instead of direct Firebase URL
    const proxyUrl = convertToProxyUrl(fileUrl);
    console.log('Using proxy URL for file type detection:', proxyUrl);
    
    // Try to determine the file type from the headers
    console.log('Sending HEAD request to determine file type...');
    const response = await fetch(proxyUrl, { method: 'HEAD' });
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      console.log('Content-Type from headers:', contentType);
      
      if (contentType) {
        if (contentType.includes('application/pdf')) {
          console.log('File type detected from headers: PDF');
          return 'pdf';
        } else if (contentType.includes('image/')) {
          console.log('File type detected from headers: Image');
          return 'image';
        }
      }
    }
  } catch (error) {
    console.log('HEAD request failed, falling back to extension-based detection:', error);
  }
  
  // Fallback to extension-based detection
  console.log('Could not determine file type from headers, guessing based on URL');
  const url = new URL(fileUrl);
  const path = url.pathname;
  const extension = path.split('.').pop().toLowerCase();
  
  if (extension === 'pdf') {
    console.log('File type detected from extension: PDF');
    return 'pdf';
  } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif'].includes(extension)) {
    console.log('File type detected from extension: Image');
    return 'image';
  }
  
  // If we can't determine the type, default to image
  console.log('Could not determine file type, defaulting to: Image');
  return 'image';
}

// Helper function to convert Firebase Storage URLs to our proxy endpoint
function convertToProxyUrl(fileUrl) {
  try {
    const url = new URL(fileUrl);
    console.log('Converting URL:', fileUrl);
    
    // Check if it's a Firebase Storage URL
    if (url.hostname.includes('firebasestorage.googleapis.com')) {
      // Extract the path from the URL
      const pathMatch = url.pathname.match(/\/v0\/b\/[^\/]+\/o\/(.+)/);
      
      if (pathMatch && pathMatch[1]) {
        const encodedPath = pathMatch[1];
        const decodedPath = decodeURIComponent(encodedPath);
        console.log('Decoded Firebase path:', decodedPath);
        
        // Extract userId and billId from the path if possible
        const pathParts = decodedPath.split('/');
        console.log('Path parts:', pathParts);
        
        if (pathParts.length >= 2 && pathParts[0] === 'bills') {
          const userId = pathParts[1];
          
          // Try to extract billId from the URL search params
          const urlParams = new URLSearchParams(url.search);
          const billId = urlParams.get('billId');
          
          if (billId) {
            console.log('Using billId from URL params:', billId);
            const proxyUrl = `${window.location.origin}/api/proxy-file?path=${encodeURIComponent(decodedPath)}&userId=${encodeURIComponent(userId)}&billId=${encodeURIComponent(billId)}`;
            console.log('Generated proxy URL with auth:', proxyUrl);
            return proxyUrl;
          }
          
          // If no billId in URL params, try to get it from the current URL
          const currentUrl = new URL(window.location.href);
          const currentBillId = currentUrl.pathname.split('/').pop();
          
          if (currentBillId) {
            console.log('Using billId from current URL:', currentBillId);
            const proxyUrl = `${window.location.origin}/api/proxy-file?path=${encodeURIComponent(decodedPath)}&userId=${encodeURIComponent(userId)}&billId=${encodeURIComponent(currentBillId)}`;
            console.log('Generated proxy URL with auth:', proxyUrl);
            return proxyUrl;
          }
        }
        
        // If we can't extract userId and billId, just use the path
        const proxyUrl = `${window.location.origin}/api/proxy-file?path=${encodeURIComponent(decodedPath)}`;
        console.log('Generated simple proxy URL:', proxyUrl);
        return proxyUrl;
      }
    }
    
    // If it's not a Firebase Storage URL or we can't parse it, return the original URL
    console.log('Not a Firebase Storage URL, using original:', fileUrl);
    return fileUrl;
  } catch (error) {
    console.error('Error converting to proxy URL:', error);
    return fileUrl;
  }
}

export async function processWithClientLLM(text, isVerificationMode = false, previousResults = null) {
  try {
    console.log('Starting client-side LLM processing with text length:', text.length);
    console.log('Mode:', isVerificationMode ? 'Verification' : 'Data Extraction');
    
    // Include learning from previous results if available
    let enhancedInstructions = '';
    if (previousResults && !isVerificationMode) {
      enhancedInstructions = `
        PREVIOUS ANALYSIS FEEDBACK:
        This bill has been processed before. Here are insights from previous analyses that should guide your extraction:
        - Patient Name: ${previousResults.patientInfo?.fullName || 'Not previously identified correctly'}
        - Potential issues with previous extractions: ${previousResults.processingErrors || 'None noted'}
        
        NOTE: If previous data conflicts with what you observe in the document, trust your current analysis but explain the discrepancy.
      `;
    }
    
    // Try to use OpenAI API first if available
    if (canUseOpenAI()) {
      try {
        console.log('Attempting to use OpenAI API for processing...');
        setUsingOpenAI(true); // Set flag to prevent recursive calls
        
        // Call the OpenAI API with enhanced instructions
        const result = await analyzeWithOpenAI(text, {
          mode: isVerificationMode ? 'verify' : 'extract',
          previousResults: previousResults,
          enhancedInstructions: enhancedInstructions
        });
        
        if (result.error) {
          console.warn('OpenAI API returned an error:', result.error);
          throw new Error(result.error);
        }
        
        console.log('Successfully processed with OpenAI API');
        setUsingOpenAI(false); // Reset flag
        
        // If we're in verification mode, ensure the result has the expected format
        if (isVerificationMode) {
          if (typeof result.isMedicalBill !== 'boolean') {
            console.warn('OpenAI API response missing isMedicalBill boolean, falling back to client-side processing');
            throw new Error('Invalid API response format');
          }
          return {
            isMedicalBill: result.isMedicalBill,
            confidence: result.confidence || 'medium',
            reason: result.reason || 'Processed with OpenAI API',
            processingMethod: 'openai'
          };
        }
        
        // For data extraction, add validation and cleaning logic
        if (!result.patientInfo && !result.billInfo) {
          console.warn('OpenAI API response missing required fields, falling back to client-side processing');
          throw new Error('Invalid API response format');
        }
        
        // Apply post-processing and validation
        const processedResult = validateAndCleanExtractedData(result, text);
        
        // Add the extracted text and processing metadata to the result
        processedResult.extractedText = text;
        processedResult.processingMethod = 'openai';
        processedResult.processingTimestamp = new Date().toISOString();
        
        // Add confidence metrics to the result
        processedResult.dataQualityMetrics = {
          patientInfoConfidence: calculateConfidenceScore(processedResult.patientInfo),
          billInfoConfidence: calculateConfidenceScore(processedResult.billInfo),
          servicesConfidence: Array.isArray(processedResult.services) ? 
            processedResult.services.map(service => calculateConfidenceScore(service)) : []
        };
        
        return processedResult;
      } catch (apiError) {
        console.warn('OpenAI API processing failed, falling back to client-side processing:', apiError);
        setUsingOpenAI(false); // Reset flag
        // Continue with client-side processing
      }
    } else {
      console.log('OpenAI API not available or already in use, using client-side processing');
    }
    
    // Original client-side processing logic
    if (isVerificationMode) {
      // Enhanced heuristic to check if it's a medical bill
      const medicalTerms = [
        'patient', 'diagnosis', 'procedure', 'insurance', 'claim', 'medical', 'hospital', 
        'doctor', 'treatment', 'billing', 'healthcare', 'clinic', 'physician', 'provider',
        'service', 'charge', 'payment', 'balance', 'due', 'amount', 'copay', 'deductible'
      ];
      
      const lowercaseText = text.toLowerCase();
      let matchCount = 0;
      const matchedTerms = [];
      
      for (const term of medicalTerms) {
        if (lowercaseText.includes(term)) {
          matchCount++;
          matchedTerms.push(term);
        }
      }
      
      const isMedicalBill = matchCount >= 3;
      const confidence = matchCount >= 6 ? 'high' : (matchCount >= 3 ? 'medium' : 'low');
      
      return {
        isMedicalBill,
        confidence,
        reason: isMedicalBill 
          ? `Found ${matchCount} medical bill indicators: ${matchedTerms.join(', ')}`
          : 'Not enough medical bill indicators found'
      };
    }
    
    // For data extraction, ensure we always return a complete structure
    const defaultData = {
      patientInfo: {
        fullName: "Not found",
        dateOfBirth: "Not found",
        accountNumber: "Not found",
        insuranceInfo: "Not found"
      },
      billInfo: {
        totalAmount: "Not found",
        serviceDates: "Not found",
        dueDate: "Not found",
        facilityName: "Not found"
      },
      services: [{
        description: "Medical service",
        code: "Not found",
        amount: "Not found",
        details: "Not found"
      }],
      insuranceInfo: {
        amountCovered: "Not found",
        patientResponsibility: "Not found",
        adjustments: "Not found"
      },
      isMedicalBill: false,
      confidence: "low",
      extractedText: text
    };
    
    // Try to extract information from the text
    const lowercaseText = text.toLowerCase();
    
    // Check if it's a medical bill (but don't gate extraction on this)
    const verificationResult = await processWithClientLLM(text, true, defaultData);
    defaultData.isMedicalBill = verificationResult.isMedicalBill;
    defaultData.confidence = verificationResult.confidence;
    
    // Always try to extract information, regardless of medical bill detection
    // Extract patient information
    const patientNameMatch = text.match(/(?:patient|name)[\s:]+([A-Za-z\s.,'-]+?)(?:\s+(?:number|dob|date|account|id|#|\r|\n|,|;|$))/i);
    if (patientNameMatch) {
      defaultData.patientInfo.fullName = patientNameMatch[1].trim();
    } else {
      // Try a more general approach if the specific pattern doesn't match
      const nameLines = text.split('\n').filter(line => 
        line.toLowerCase().includes('patient') || 
        line.toLowerCase().includes('name')
      );
      
      if (nameLines.length > 0) {
        // Take the first line that contains patient or name
        const nameLine = nameLines[0];
        // Extract just the name part after "patient:" or "name:"
        const simplifiedMatch = nameLine.match(/(?:patient|name)[\s:]+([A-Za-z\s.,'-]+)/i);
        if (simplifiedMatch) {
          // Limit to just the first 30 characters to avoid capturing too much
          const fullName = simplifiedMatch[1].trim();
          defaultData.patientInfo.fullName = fullName.length > 30 ? 
            fullName.substring(0, 30) : fullName;
        }
      }
    }
    
    // Extract amount - look for any currency amounts
    const amountMatches = text.match(/[$]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g);
    if (amountMatches && amountMatches.length > 0) {
      // Use the largest amount as the total
      const amounts = amountMatches.map(amt => parseFloat(amt.replace(/[$,]/g, '')));
      const maxAmount = Math.max(...amounts);
      defaultData.billInfo.totalAmount = maxAmount.toFixed(2);
    }
    
    // Extract dates - look for any dates
    const dateMatches = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g);
    if (dateMatches && dateMatches.length > 0) {
      defaultData.billInfo.serviceDates = dateMatches[0];
      if (dateMatches.length > 1) {
        defaultData.billInfo.dueDate = dateMatches[dateMatches.length - 1];
      }
    }
    
    // Extract facility/provider - look for any business names
    const facilityMatch = text.match(/(?:facility|hospital|provider|clinic|center|medical|health|care)[\s:]+([A-Za-z0-9\s.,'-]+)(?:\r|\n|,|;|$)/i);
    if (facilityMatch) {
      defaultData.billInfo.facilityName = facilityMatch[1].trim();
    }
    
    // Extract services - look for line items with amounts
    const serviceLines = text.match(/([A-Za-z0-9\s.,'-]+)[\s:]+[$]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g);
    if (serviceLines && serviceLines.length > 0) {
      defaultData.services = serviceLines.map(line => {
        const [description, amount] = line.split(/[\s:]+(?=[$]?\d)/);
        return {
          description: description.trim(),
          code: "Not found",
          amount: amount ? amount.trim() : "Not found",
          details: "Not found"
        };
      });
    }
    
    // Extract insurance information
    const insuranceMatch = text.match(/(?:insurance|coverage|plan|policy)[\s:]+([A-Za-z0-9\s.,'-]+)(?:\r|\n|,|;|$)/i);
    if (insuranceMatch) {
      defaultData.patientInfo.insuranceInfo = insuranceMatch[1].trim();
    }
    
    // Add processing metadata
    defaultData.processingMethod = 'client';
    defaultData.processingTimestamp = new Date().toISOString();
    
    return defaultData;
  } catch (error) {
    console.error('Client-side LLM processing error:', error);
    setUsingOpenAI(false); // Reset flag in case of error
    // Return a valid structure even on error
    return {
      patientInfo: { fullName: "Error", dateOfBirth: "Error", accountNumber: "Error", insuranceInfo: "Error" },
      billInfo: { totalAmount: "Error", serviceDates: "Error", dueDate: "Error", facilityName: "Error" },
      services: [{ description: "Error", code: "Error", amount: "Error", details: "Error" }],
      insuranceInfo: { amountCovered: "Error", patientResponsibility: "Error", adjustments: "Error" },
      isMedicalBill: false,
      confidence: "error",
      extractedText: "Error processing document",
      processingMethod: 'error',
      error: error.message
    };
  }
}

/**
 * Validates and cleans extracted data to ensure quality and consistency
 * @param {Object} data - The extracted data from OCR and OpenAI
 * @param {string} rawText - The raw OCR text for verification
 * @returns {Object} - Cleaned and validated data
 */
function validateAndCleanExtractedData(data, rawText) {
  // Create a deep copy to avoid modifying the original
  const cleanedData = JSON.parse(JSON.stringify(data));
  
  // Add numerical data extraction if not present
  if (!cleanedData.numericalData) {
    cleanedData.numericalData = extractAllNumericalData(rawText);
    console.log('Added numerical data extraction with', 
      cleanedData.numericalData.allAmounts.length, 'amounts and',
      cleanedData.numericalData.allDates.length, 'dates');
  }
  
  // Clean patient name - remove any text after indicators that aren't part of names
  if (cleanedData.patientInfo?.fullName && cleanedData.patientInfo.fullName !== "Not found") {
    cleanedData.patientInfo.fullName = cleanPatientName(cleanedData.patientInfo.fullName);
    
    // Verify name appears in the raw text (basic validation)
    if (!rawText.includes(cleanedData.patientInfo.fullName.split(' ')[0])) {
      console.warn('Patient name may be incorrect - first name not found in raw text');
      cleanedData.processingErrors = (cleanedData.processingErrors || []).concat(['Potential issue with patient name extraction']);
    }
  }
  
  // Clean and validate amount - ensure it follows currency format
  if (cleanedData.billInfo?.totalAmount && cleanedData.billInfo.totalAmount !== "Not found") {
    // Standardize amount format to include currency symbol and two decimal places
    const amountMatch = cleanedData.billInfo.totalAmount.match(/(\$?)(\d+(?:\.\d+)?)/);
    if (amountMatch) {
      const [_, symbol, amount] = amountMatch;
      // Format to proper currency with 2 decimal places
      cleanedData.billInfo.totalAmount = `${symbol || '$'}${parseFloat(amount).toFixed(2)}`;
    }
    
    // Verify amount appears in numerical data
    if (cleanedData.numericalData?.allAmounts) {
      const totalAmountWithoutSymbol = cleanedData.billInfo.totalAmount.replace(/[$,]/g, '');
      const amountFound = cleanedData.numericalData.allAmounts.some(amt => 
        amt.replace(/[$,]/g, '') === totalAmountWithoutSymbol
      );
      
      if (!amountFound) {
        console.warn('Total amount may be incorrect - not found in extracted numerical data');
        cleanedData.billInfo.totalAmountVerified = false;
        cleanedData.processingErrors = (cleanedData.processingErrors || []).concat(['Potential issue with total amount extraction']);
      } else {
        cleanedData.billInfo.totalAmountVerified = true;
      }
    }
  }
  
  // Validate service codes
  if (Array.isArray(cleanedData.services)) {
    cleanedData.services = cleanedData.services.map(service => {
      // Check and standardize CPT/HCPCS codes format
      if (service.code && service.code !== "Not found") {
        // Validate CPT/HCPCS code format (5 digits for CPT, alphanumeric for HCPCS)
        const isValidCptCode = /^\d{5}$/.test(service.code.trim());
        const isValidHcpcsCode = /^[A-Z]\d{4}$/.test(service.code.trim());
        
        if (!isValidCptCode && !isValidHcpcsCode) {
          console.warn(`Potentially invalid service code: ${service.code}`);
          service.codeValidationNote = 'Format may not match standard CPT/HCPCS';
        }
      }
      
      // Validate and standardize service amount
      if (service.amount && service.amount !== "Not found") {
        const amountMatch = service.amount.match(/(\$?)(\d+(?:\.\d+)?)/);
        if (amountMatch) {
          const [_, symbol, amount] = amountMatch;
          // Format to proper currency with 2 decimal places
          service.amount = `${symbol || '$'}${parseFloat(amount).toFixed(2)}`;
        }
      }
      
      return service;
    });
  }
  
  // Validate dates - ensure they follow standard formats
  if (cleanedData.billInfo?.serviceDates && cleanedData.billInfo.serviceDates !== "Not found") {
    const standardizedDate = standardizeDate(cleanedData.billInfo.serviceDates);
    if (standardizedDate !== cleanedData.billInfo.serviceDates) {
      cleanedData.billInfo.serviceDates = standardizedDate;
    }
  }
  
  if (cleanedData.billInfo?.dueDate && cleanedData.billInfo.dueDate !== "Not found") {
    const standardizedDate = standardizeDate(cleanedData.billInfo.dueDate);
    if (standardizedDate !== cleanedData.billInfo.dueDate) {
      cleanedData.billInfo.dueDate = standardizedDate;
    }
  }
  
  // Validate diagnostic codes
  if (Array.isArray(cleanedData.diagnosticCodes)) {
    cleanedData.diagnosticCodes = cleanedData.diagnosticCodes
      .filter(code => code && code !== "Not found")
      .map(code => {
        // ICD-10 codes typically start with a letter followed by numbers and possibly a decimal
        const isValidIcd10 = /^[A-Z]\d+(\.\d+)?$/.test(code.trim());
        if (!isValidIcd10) {
          console.warn(`Potentially invalid diagnostic code: ${code}`);
          return { code, validationNote: 'Format may not match standard ICD-10' };
        }
        return code;
      });
  }
  
  return cleanedData;
}

/**
 * Extract all numerical data from raw text
 * @param {string} text - Raw OCR text
 * @returns {Object} - Object with arrays of extracted amounts and dates
 */
function extractAllNumericalData(text) {
  if (!text) return { allAmounts: [], allDates: [] };
  
  // Extract all monetary amounts
  const amounts = [];
  const amountRegex = /(\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{2})/g;
  let amountMatch;
  while ((amountMatch = amountRegex.exec(text)) !== null) {
    amounts.push(amountMatch[0]);
  }
  
  // Extract all dates
  const dates = [];
  // Various date formats: MM/DD/YYYY, MM-DD-YYYY, MM.DD.YYYY
  const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/g;
  let dateMatch;
  while ((dateMatch = dateRegex.exec(text)) !== null) {
    dates.push(dateMatch[0]);
  }
  
  // Extract alphanumeric medical codes
  const codes = [];
  const cptCodeRegex = /\b\d{5}\b/g; // CPT codes are 5 digits
  const hcpcsCodeRegex = /\b[A-Z]\d{4}\b/g; // HCPCS codes are letter followed by 4 digits
  const icdCodeRegex = /\b[A-Z]\d+\.\d+\b/g; // ICD-10 codes like F41.9
  
  let codeMatch;
  while ((codeMatch = cptCodeRegex.exec(text)) !== null) {
    codes.push({ type: 'CPT', code: codeMatch[0] });
  }
  while ((codeMatch = hcpcsCodeRegex.exec(text)) !== null) {
    codes.push({ type: 'HCPCS', code: codeMatch[0] });
  }
  while ((codeMatch = icdCodeRegex.exec(text)) !== null) {
    codes.push({ type: 'ICD', code: codeMatch[0] });
  }
  
  return {
    allAmounts: amounts,
    allDates: dates,
    allCodes: codes
  };
}

/**
 * Standardize date format
 * @param {string} dateStr - Date string to standardize
 * @returns {string} - Standardized date
 */
function standardizeDate(dateStr) {
  if (!dateStr) return "Not found";
  
  // Check if it's a date range
  if (dateStr.includes(' - ') || dateStr.includes(' to ')) {
    // Split and standardize each part
    const parts = dateStr.split(/ - | to /);
    if (parts.length === 2) {
      const start = standardizeSingleDate(parts[0]);
      const end = standardizeSingleDate(parts[1]);
      return `${start} - ${end}`;
    }
  }
  
  return standardizeSingleDate(dateStr);
}

/**
 * Standardize a single date
 * @param {string} dateStr - Single date string
 * @returns {string} - Standardized date
 */
function standardizeSingleDate(dateStr) {
  if (!dateStr) return "Not found";
  
  // Try to parse the date with various formats
  const dateMatch = dateStr.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dateMatch) {
    let [_, month, day, year] = dateMatch;
    
    // Ensure consistent padding
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    
    // Add century if needed
    if (year.length === 2) {
      const currentYear = new Date().getFullYear().toString();
      const century = currentYear.substring(0, 2);
      year = `${century}${year}`;
    }
    
    return `${month}/${day}/${year}`;
  }
  
  return dateStr; // Return as is if not recognized
}

/**
 * Calculate confidence score for extracted field
 * @param {Object} fieldData - Data object with extracted fields
 * @returns {number} - Confidence score between 0 and 1
 */
function calculateConfidenceScore(fieldData) {
  if (!fieldData || typeof fieldData !== 'object') return 0;
  
  // Count fields that are not "Not found"
  const fields = Object.keys(fieldData);
  if (fields.length === 0) return 0;
  
  const foundFields = fields.filter(key => 
    fieldData[key] && 
    fieldData[key] !== "Not found" && 
    fieldData[key] !== "Error"
  );
  
  return foundFields.length / fields.length;
}

/**
 * Clean patient name from common OCR artifacts
 * @param {string} name - Raw extracted patient name
 * @returns {string} - Cleaned patient name
 */
function cleanPatientName(name) {
  if (!name) return "Not found";
  
  // Remove any text after common separators in patient information
  const cleanName = name.split(/\s+(?:number|dob|date|account|id|#|paflent|pat|mrn)/i)[0].trim();
  
  // Remove common OCR artifacts
  const artifactFreeText = cleanName
    .replace(/[^\w\s\-'.,]/g, '') // Remove special characters except those common in names
    .replace(/\b(patient|name|ptname)\b/i, '') // Remove common labels
    .trim();
  
  // Limit length to avoid capturing too much text
  return artifactFreeText.length > 30 ? artifactFreeText.substring(0, 30) : artifactFreeText;
}

// Add this comment near the extractTextWithGoogleVision function
// Using the real Google Cloud Vision API endpoint
export async function extractTextWithGoogleVision(fileUrl, progressHandler = null) {
  try {
    if (progressHandler) {
      progressHandler({
        status: 'processing',
        step: 'google-vision',
        progress: 0.1,
        message: 'Sending document to Google Vision OCR...'
      });
    }
    
    // Validate the URL - it must be an HTTP(S) URL for Google Vision
    if (!fileUrl.startsWith('http')) {
      throw new Error('Google Vision requires an HTTP URL. Blob URLs are not supported.');
    }
    
    // Get the auth token for the API request
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }
    
    const token = await currentUser.getIdToken();
    
    console.log('Calling Google Vision API with URL:', fileUrl);
    
    // Using the real Google Vision API endpoint to test if billing is enabled
    const response = await fetch('/api/google-vision-ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ fileUrl })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { error: errorText };
      }
      
      console.error('Google Vision OCR error:', errorData);
      
      // Handle specific error types
      if (response.status === 402 || (errorData && errorData.processingMethod === 'google-vision-billing-error')) {
        throw new Error('Google Cloud Vision requires billing to be enabled. Please contact the administrator to enable billing on the Google Cloud project.');
      }
      
      if (response.status === 429 || (errorData && errorData.processingMethod === 'google-vision-quota-error')) {
        throw new Error('Google Cloud Vision API quota has been exceeded. Please try again later or contact the administrator.');
      }
      
      if (errorData && errorData.processingMethod === 'google-vision-api-error') {
        throw new Error('Google Cloud Vision API is not enabled for this project. Please contact the administrator to enable the API.');
      }
      
      throw new Error(`Google Vision OCR failed: ${errorData.message || errorData.error || response.statusText}`);
    }

    if (progressHandler) {
      progressHandler({
        status: 'processing',
        step: 'google-vision',
        progress: 0.5,
        message: 'Processing OCR results...'
      });
    }
    
    const data = await response.json();
    
    // Check if this is mock data and log it
    if (data._mockNotice) {
      console.log('NOTICE:', data._mockNotice);
    }
    
    // Prepare the structured data from the OCR results
    let structuredData = {
      extractedText: data.extractedText,
      ocrConfidence: data.confidence,
      processingMethod: data.processingMethod || 'google-vision',
      extractedData: extractStructuredDataFromOCR(data.extractedText)
    };
    
    // Try to extract table data if available
    if (data.tables && data.tables.length > 0) {
      structuredData.tables = data.tables;
      
      // Extract services from the tables if they look like service line items
      const servicesFromTables = extractServicesFromTables(data.tables);
      if (servicesFromTables.length > 0) {
        structuredData.extractedData.services = [
          ...(structuredData.extractedData.services || []),
          ...servicesFromTables
        ];
      }
    }
    
    if (progressHandler) {
      progressHandler({
        status: 'complete',
        step: 'google-vision',
        progress: 1.0,
        message: 'OCR processing complete'
      });
    }
    
    return structuredData;
  } catch (error) {
    console.error('Google Vision OCR processing error:', error);
    
    if (progressHandler) {
      progressHandler({
        status: 'error',
        step: 'google-vision',
        error: error.message,
        message: 'Error processing document with Google Vision OCR'
      });
    }
    
    throw error;
  }
}

// Helper function to extract services from OCR detected tables
function extractServicesFromTables(tables) {
  const services = [];
  
  tables.forEach(table => {
    // Skip tables with less than 2 rows (header + at least one service)
    if (!table.rows || table.rows.length < 2) return;
    
    // Look for tables that look like service line items
    // Typically they have columns for service name, date, code, quantity, amount, etc.
    table.rows.slice(1).forEach(row => {
      // Skip rows with less than 2 cells
      if (row.length < 2) return;
      
      // Try to identify service information from the row
      const serviceObj = {
        description: '',
        code: '',
        amount: 0,
        date: '',
        _raw: row.join(' | ')
      };
      
      // Check each cell for potential service information
      row.forEach((cell, index) => {
        // If this cell appears to be a description (longer text without numbers)
        if (cell.length > 5 && !/^\d+$/.test(cell)) {
          serviceObj.description = cell;
        }
        
        // If this looks like a service code (alphanumeric code format)
        if (/^[A-Z0-9]{5,}$/.test(cell)) {
          serviceObj.code = cell;
        }
        
        // If this looks like a dollar amount
        if (/\$?\d+\.\d{2}/.test(cell)) {
          const match = cell.match(/\$?(\d+\.\d{2})/);
          if (match) {
            serviceObj.amount = parseFloat(match[1]);
          }
        }
        
        // If this looks like a date
        if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(cell)) {
          serviceObj.date = cell;
        }
      });
      
      // Only add services that have at least a description or code, and an amount
      if ((serviceObj.description || serviceObj.code) && serviceObj.amount) {
        services.push(serviceObj);
      }
    });
  });
  
  return services;
}

// Enhance the analyzeBillDocument function to use Google Vision OCR with fallback
export async function analyzeDocumentClient(fileUrl, progressHandler = null) {
  console.log('Starting client-side document analysis process...');
  
  try {
    // Detect file type first
    const fileType = await detectFileTypeClient(fileUrl);
    console.log('Detected file type:', fileType);
    
    let result;
    
    // Try Google Vision OCR first
    try {
      if (progressHandler) {
        progressHandler({
          status: 'processing',
          step: 'ocr',
          progress: 0.1,
          message: 'Starting OCR with Google Vision...'
        });
      }
      
      console.log('Attempting Google Vision OCR...');
      result = await extractTextWithGoogleVision(fileUrl, progressHandler);
      console.log('Google Vision OCR successful');
      
      // Add file type info
      result.fileType = fileType;
      return result;
    } catch (googleVisionError) {
      console.warn('Google Vision OCR failed, falling back to alternative methods:', googleVisionError);
      
      if (progressHandler) {
        progressHandler({
          status: 'processing',
          step: 'ocr',
          progress: 0.2,
          message: 'Falling back to alternative OCR methods...'
        });
      }
      
      // Continue with existing methods as fallback
      if (fileType === 'image') {
        console.log('Using image OCR fallback');
        result = await extractTextFromImageClient(fileUrl, progressHandler);
      } else if (fileType === 'pdf') {
        console.log('Using PDF extraction fallback');
        result = await extractTextFromPDFClient(fileUrl, progressHandler);
      } else {
        throw new Error(`Unsupported file type: ${fileType}`);
      }
      
      // Add file type info
      result.fileType = fileType;
      return result;
    }
  } catch (error) {
    console.error('Client document analysis error:', error);
    if (progressHandler) {
      progressHandler({
        status: 'error',
        step: 'analysis',
        message: `Document analysis failed: ${error.message}`,
        error: error.message
      });
    }
    throw error;
  }
}

/**
 * Helper function to update progress handler if available
 * @param {Function} handler - Progress handler function
 * @param {Object} progressData - Progress data to send
 */
function setOcrProgress(handler, progressData) {
  if (typeof handler === 'function') {
    handler(progressData);
  }
} 