import { createWorker } from 'tesseract.js';
import OpenAI from 'openai';

// Client-side worker management
let worker = null;

export async function getClientWorker() {
  if (!worker) {
    console.log('Creating new client-side Tesseract worker...');
    worker = await createWorker({
      logger: m => console.log('Client OCR Progress:', m),
      errorHandler: err => console.error('Client OCR Error:', err)
    });
    
    console.log('Initializing client worker...');
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({
      tessedit_ocr_engine_mode: 3,
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?@#$%&*()-+=:;/" '
    });
    console.log('Client worker initialized successfully');
  }
  return worker;
}

export async function terminateClientWorker() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

export async function extractTextFromImageClient(imageUrl) {
  console.log('Starting client-side image OCR process...');
  
  try {
    // Use our proxy endpoint instead of direct Firebase URL
    const proxyUrl = convertToProxyUrl(imageUrl);
    console.log('Using proxy URL for image:', proxyUrl);
    
    // Get the Tesseract worker
    const worker = await getClientWorker();
    
    // Fetch the image with credentials
    console.log('Fetching image from URL:', proxyUrl);
    const response = await fetch(proxyUrl, {
      credentials: 'include',
      headers: {
        'Accept': 'image/*'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    
    const imageBlob = await response.blob();
    console.log('Image fetched successfully, size:', imageBlob.size, 'bytes');
    
    // Recognize text in the image
    console.log('Starting OCR recognition...');
    const result = await worker.recognize(imageBlob);
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

export async function extractTextFromPDFClient(pdfUrl) {
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
    
    // Check if it's a Firebase Storage URL
    if (url.hostname.includes('firebasestorage.googleapis.com')) {
      // Extract the path from the URL
      // The path is in the format: /v0/b/[bucket]/o/[path]?alt=media&token=[token]
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
          
          // The billId might be part of the filename or a separate path component
          // Format is typically: timestamp_billId or just billId
          let billId = null;
          if (pathParts.length > 2) {
            const filenameMatch = pathParts[2].match(/\d+_([^\.]+)/);
            if (filenameMatch && filenameMatch[1]) {
              billId = filenameMatch[1];
            }
          }
          
          console.log('Extracted userId:', userId);
          console.log('Extracted billId:', billId);
          
          // Construct the proxy URL with userId and billId if available
          const origin = window.location.origin;
          const proxyUrl = `${origin}/api/proxy-file?path=${encodedPath}${userId ? `&userId=${userId}` : ''}${billId ? `&billId=${billId}` : ''}`;
          console.log('Generated proxy URL:', proxyUrl);
          return proxyUrl;
        }
        
        // If we can't extract userId and billId, just use the path
        const proxyUrl = `${window.location.origin}/api/proxy-file?path=${encodedPath}`;
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

export async function processWithClientLLM(text, isVerificationMode = false) {
  try {
    console.log('Starting client-side LLM processing with text length:', text.length);
    console.log('Mode:', isVerificationMode ? 'Verification' : 'Data Extraction');
    
    // For client-side, we'll use a more sophisticated approach with regex patterns
    
    if (isVerificationMode) {
      // Enhanced heuristic to check if it's a medical bill
      const medicalTerms = [
        'patient', 'diagnosis', 'procedure', 'insurance', 'claim', 'medical', 'hospital', 
        'doctor', 'treatment', 'billing', 'healthcare', 'clinic', 'physician', 'provider',
        'service', 'charge', 'payment', 'balance', 'due', 'amount', 'copay', 'deductible',
        'statement', 'invoice', 'account', 'visit', 'admission', 'discharge', 'emergency',
        'outpatient', 'inpatient', 'lab', 'radiology', 'pharmacy', 'prescription', 'medication'
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
      
      // Check for currency patterns
      const hasCurrencyPattern = /\$\s*\d+(?:[,.]\d+)*|\d+\s*(?:USD|dollars)/i.test(text);
      if (hasCurrencyPattern) {
        matchCount++;
        matchedTerms.push('currency');
      }
      
      // Check for date patterns
      const hasDatePattern = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+\s+\d{1,2},\s+\d{4}/i.test(text);
      if (hasDatePattern) {
        matchCount++;
        matchedTerms.push('date');
      }
      
      const isMedicalBill = matchCount >= 5;
      const confidence = matchCount >= 8 ? 'high' : (matchCount >= 5 ? 'medium' : 'low');
      const reason = isMedicalBill 
        ? `Found ${matchCount} medical bill indicators: ${matchedTerms.slice(0, 5).join(', ')}${matchedTerms.length > 5 ? '...' : ''}` 
        : 'Not enough medical bill indicators found in the document';
      
      return {
        isMedicalBill,
        confidence,
        reason
      };
    } else {
      // Enhanced extraction using regex patterns
      
      // Patient information
      const patientNameMatch = text.match(/(?:patient|name)[\s:]+([A-Za-z\s.,'-]+)(?:\r|\n|,|;|$)/i) || 
                              text.match(/(?:name|patient)[\s:]*([A-Za-z\s.,'-]+)(?:\r|\n|,|;|$)/i);
      
      const dobMatch = text.match(/(?:birth|dob|born)[\s:]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i) ||
                       text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})(?:\s+|\r|\n|,|;)(?:dob|birth|born)/i);
      
      const accountMatch = text.match(/(?:account|acct|acc)[\s:#]+([A-Z0-9-]+)/i) ||
                          text.match(/(?:mrn|record|chart)[\s:#]+([A-Z0-9-]+)/i);
      
      const insuranceMatch = text.match(/(?:insurance|insurer|plan|policy)[\s:]+([A-Za-z0-9\s.,'-]+)(?:\r|\n|,|;|$)/i);
      
      // Bill information
      const totalAmountMatch = text.match(/(?:total|amount|balance|due|pay this amount)[\s:]*[$]?([0-9,.]+)/i) ||
                              text.match(/[$]([0-9,.]+)(?:\s+|\r|\n|,|;)(?:total|amount|balance|due)/i);
      
      const serviceDateMatch = text.match(/(?:service|dos|date of service)[\s:]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i) ||
                              text.match(/([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})(?:\s+|\r|\n|,|;)(?:service|dos)/i);
      
      const dueDateMatch = text.match(/(?:due|payment due|pay by)[\s:]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i) ||
                          text.match(/([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})(?:\s+|\r|\n|,|;)(?:due date|payment due)/i);
      
      const facilityMatch = text.match(/(?:facility|hospital|provider|clinic|center)[\s:]+([A-Za-z0-9\s.,'-]+)(?:\r|\n|,|;|$)/i);
      
      // Extract services
      const services = [];
      
      // Look for service lines with amounts
      const serviceLines = text.match(/([A-Za-z0-9\s.,'-]+)[\s:]+[$]?([0-9,.]+)/g);
      if (serviceLines) {
        for (const line of serviceLines) {
          const parts = line.match(/([A-Za-z0-9\s.,'-]+)[\s:]+[$]?([0-9,.]+)/);
          if (parts && parts.length >= 3) {
            const description = parts[1].trim();
            const amount = parts[2].trim();
            
            // Skip if this looks like a total or subtotal
            if (!/total|balance|due|amount|pay/i.test(description)) {
              services.push({
                description,
                code: "Not found",
                amount,
                details: "Not found"
              });
            }
          }
        }
      }
      
      // If no services found, add a default one
      if (services.length === 0) {
        services.push({
          description: "Medical service",
          code: "Not found",
          amount: totalAmountMatch ? totalAmountMatch[1].trim() : "Not found",
          details: "Not found"
        });
      }
      
      // Insurance information
      const amountCoveredMatch = text.match(/(?:insurance paid|covered|plan paid)[\s:]*[$]?([0-9,.]+)/i);
      const patientResponsibilityMatch = text.match(/(?:patient responsibility|patient pays|you pay|your responsibility)[\s:]*[$]?([0-9,.]+)/i);
      const adjustmentsMatch = text.match(/(?:adjustment|discount|write-off)[\s:]*[$]?([0-9,.]+)/i);
      
      return {
        patientInfo: {
          fullName: patientNameMatch ? patientNameMatch[1].trim() : "Not found",
          dateOfBirth: dobMatch ? dobMatch[1].trim() : "Not found",
          accountNumber: accountMatch ? accountMatch[1].trim() : "Not found",
          insuranceInfo: insuranceMatch ? insuranceMatch[1].trim() : "Not found"
        },
        billInfo: {
          totalAmount: totalAmountMatch ? totalAmountMatch[1].trim() : "Not found",
          serviceDates: serviceDateMatch ? serviceDateMatch[1].trim() : "Not found",
          dueDate: dueDateMatch ? dueDateMatch[1].trim() : "Not found",
          facilityName: facilityMatch ? facilityMatch[1].trim() : "Not found"
        },
        services,
        insuranceInfo: {
          amountCovered: amountCoveredMatch ? amountCoveredMatch[1].trim() : "Not found",
          patientResponsibility: patientResponsibilityMatch ? patientResponsibilityMatch[1].trim() : 
                                (totalAmountMatch ? totalAmountMatch[1].trim() : "Not found"),
          adjustments: adjustmentsMatch ? adjustmentsMatch[1].trim() : "Not found"
        }
      };
    }
  } catch (error) {
    console.error('Client-side LLM processing error:', error);
    throw new Error(`Client-side LLM processing failed: ${error.message}`);
  }
}

export async function analyzeDocumentClient(fileUrl) {
  console.log('Starting client-side document analysis...', { fileUrl });
  
  try {
    // Detect the file type
    const fileType = await detectFileTypeClient(fileUrl);
    
    // Extract text based on file type
    console.log('Starting client-side text extraction process...');
    let extractedText = '';
    
    if (fileType === 'pdf') {
      extractedText = await extractTextFromPDFClient(fileUrl);
    } else if (fileType === 'image') {
      extractedText = await extractTextFromImageClient(fileUrl);
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
    
    if (!extractedText || extractedText.trim().length === 0) {
      console.warn('Extracted text is empty or whitespace only');
      extractedText = 'No text could be extracted from the document.';
    }
    
    // Process the extracted text with the LLM
    console.log('Processing extracted text with client-side LLM...');
    console.log('Extracted text length:', extractedText.length);
    console.log('First 100 chars of extracted text:', extractedText.substring(0, 100));
    
    const result = await processWithClientLLM(extractedText);
    
    // Add the extracted text to the result
    result.extractedText = extractedText;
    
    console.log('Client-side analysis complete:', { 
      textLength: extractedText.length,
      resultSummary: {
        hasPatientInfo: !!result.patientInfo,
        hasBillInfo: !!result.billInfo,
        servicesCount: result.services?.length || 0,
        hasInsuranceInfo: !!result.insuranceInfo
      }
    });
    
    return result;
  } catch (error) {
    console.error('Client-side analysis error:', error);
    throw new Error(`Client-side analysis failed: ${error.message}`);
  }
} 