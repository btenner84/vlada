import { createWorker } from 'tesseract.js';
import OpenAI from 'openai';

// Client-side worker management
let clientWorker = null;

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
          
          // Try to extract billId from the URL search params first
          const urlParams = new URLSearchParams(url.search);
          const billIdParam = urlParams.get('billId');
          
          if (billIdParam) {
            console.log('Extracted billId from URL params:', billIdParam);
            
            // Construct the proxy URL with userId and billId
            const origin = window.location.origin;
            const proxyUrl = `${origin}/api/proxy-file?path=${encodeURIComponent(decodedPath)}&userId=${encodeURIComponent(userId)}&billId=${encodeURIComponent(billIdParam)}`;
            console.log('Generated proxy URL with auth:', proxyUrl);
            return proxyUrl;
          }
          
          // If no billId in params, try to extract it from the filename
          const filename = pathParts[pathParts.length - 1];
          const billId = filename.split('_')[0]; // Assuming billId is the first part before underscore
          
          if (billId) {
            console.log('Extracted billId from filename:', billId);
            const proxyUrl = `${window.location.origin}/api/proxy-file?path=${encodeURIComponent(decodedPath)}&userId=${encodeURIComponent(userId)}&billId=${encodeURIComponent(billId)}`;
            console.log('Generated proxy URL with auth from filename:', proxyUrl);
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

export async function processWithClientLLM(text, isVerificationMode = false) {
  try {
    console.log('Starting client-side LLM processing with text length:', text.length);
    console.log('Mode:', isVerificationMode ? 'Verification' : 'Data Extraction');
    
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
    const verificationResult = await processWithClientLLM(text, true);
    defaultData.isMedicalBill = verificationResult.isMedicalBill;
    defaultData.confidence = verificationResult.confidence;
    
    // Always try to extract information, regardless of medical bill detection
    // Extract patient information
    const patientNameMatch = text.match(/(?:patient|name)[\s:]+([A-Za-z\s.,'-]+)(?:\r|\n|,|;|$)/i);
    if (patientNameMatch) {
      defaultData.patientInfo.fullName = patientNameMatch[1].trim();
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
    
    return defaultData;
  } catch (error) {
    console.error('Client-side LLM processing error:', error);
    // Return a valid structure even on error
    return {
      patientInfo: { fullName: "Error", dateOfBirth: "Error", accountNumber: "Error", insuranceInfo: "Error" },
      billInfo: { totalAmount: "Error", serviceDates: "Error", dueDate: "Error", facilityName: "Error" },
      services: [{ description: "Error", code: "Error", amount: "Error", details: "Error" }],
      insuranceInfo: { amountCovered: "Error", patientResponsibility: "Error", adjustments: "Error" },
      isMedicalBill: false,
      confidence: "error",
      extractedText: "Error processing document"
    };
  }
}

export async function analyzeDocumentClient(fileUrl, progressHandler = null) {
  console.log('Starting client-side document analysis...', { fileUrl });
  
  try {
    // Detect the file type
    const fileType = await detectFileTypeClient(fileUrl);
    
    // Extract text based on file type
    console.log('Starting client-side text extraction process...');
    let extractedText = '';
    
    if (fileType === 'pdf') {
      extractedText = await extractTextFromPDFClient(fileUrl, progressHandler);
    } else if (fileType === 'image') {
      extractedText = await extractTextFromImageClient(fileUrl, progressHandler);
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