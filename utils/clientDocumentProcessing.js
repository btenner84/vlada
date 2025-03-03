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
  console.log('Starting client-side text extraction process...');
  let clientWorker = null;
  
  try {
    clientWorker = await getClientWorker();
    console.log('Got client-side Tesseract worker');
    
    // Fetch the image
    console.log('Fetching image from URL:', imageUrl);
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    
    const imageBlob = await response.blob();
    console.log('Image fetched successfully, size:', imageBlob.size);
    
    // Create an object URL for the image
    const objectUrl = URL.createObjectURL(imageBlob);
    
    // Recognize text from the image
    console.log('Starting client-side OCR recognition...');
    
    // Set additional parameters for better recognition of medical documents
    await clientWorker.setParameters({
      tessedit_ocr_engine_mode: 3, // Legacy + LSTM mode for better accuracy
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?@#$%&*()-+=:;/" ',
      tessjs_create_hocr: '1', // Create HOCR output
      tessjs_create_tsv: '1', // Create TSV output
      tessjs_create_box: '0',
      tessjs_create_unlv: '0',
      tessjs_create_osd: '0'
    });
    
    const { data } = await clientWorker.recognize(objectUrl);
    const { text, hocr, tsv } = data;
    console.log('Client-side OCR recognition completed');

    // Clean up the object URL
    URL.revokeObjectURL(objectUrl);

    if (!text || text.trim().length === 0) {
      throw new Error('No text was extracted from the image');
    }

    console.log('Client-side OCR completed, text length:', text.length);
    console.log('First 200 chars:', text.substring(0, 200));
    
    // Extract structured data from HOCR/TSV if needed
    const structuredData = extractStructuredDataFromOCR(tsv);
    
    return {
      text,
      structuredData
    };
  } catch (error) {
    console.error('Client-side text extraction error:', error);
    throw new Error(`Client-side text extraction failed: ${error.message}`);
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
  try {
    console.log('Starting client-side PDF extraction from URL:', pdfUrl);
    
    // Fetch the PDF
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status}`);
    }
    
    const pdfBlob = await response.blob();
    console.log('PDF fetched successfully, size:', pdfBlob.size);
    
    // Load PDF.js dynamically
    if (!window.pdfjsLib) {
      console.log('Loading PDF.js library...');
      // Use CDN version to avoid bundling issues
      const pdfjsScript = document.createElement('script');
      pdfjsScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
      document.head.appendChild(pdfjsScript);
      
      // Wait for script to load
      await new Promise((resolve) => {
        pdfjsScript.onload = resolve;
      });
      
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    }
    
    // Create an object URL for the PDF
    const objectUrl = URL.createObjectURL(pdfBlob);
    
    // Load the PDF document
    const loadingTask = window.pdfjsLib.getDocument(objectUrl);
    const pdf = await loadingTask.promise;
    console.log('PDF document loaded with', pdf.numPages, 'pages');
    
    // Extract text from all pages
    let fullText = '';
    let pageTexts = [];
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Process text with position information
      const pageText = processPageText(textContent);
      pageTexts.push(pageText);
      fullText += pageText.text + '\n';
      
      // For the first page, try to extract as image as well (for PDFs with embedded images)
      if (i === 1) {
        try {
          const scale = 1.5;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;
          
          // Try OCR on the rendered page
          const dataUrl = canvas.toDataURL('image/png');
          const clientWorker = await getClientWorker();
          const { data } = await clientWorker.recognize(dataUrl);
          
          if (data.text && data.text.length > fullText.length * 0.5) {
            console.log('OCR extracted more text than PDF.js, using OCR result');
            fullText = data.text;
          }
        } catch (ocrError) {
          console.error('Error performing OCR on PDF page:', ocrError);
          // Continue with the text content from PDF.js
        }
      }
    }
    
    // Clean up the object URL
    URL.revokeObjectURL(objectUrl);
    
    if (!fullText || fullText.trim().length === 0) {
      throw new Error('No text content found in PDF');
    }
    
    console.log('PDF text extracted successfully, length:', fullText.length);
    console.log('First 200 chars:', fullText.substring(0, 200));
    
    return {
      text: fullText,
      pageTexts
    };
  } catch (error) {
    console.error('Client-side PDF parsing error:', error);
    throw new Error(`Client-side PDF extraction failed: ${error.message}`);
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
  try {
    console.log('Detecting file type for URL:', fileUrl);
    
    if (!fileUrl) {
      throw new Error('No file URL provided');
    }
    
    // Extract file extension from URL
    const urlParts = fileUrl.split('?')[0]; // Remove query parameters
    const extension = urlParts.split('.').pop().toLowerCase();
    
    // Common file extensions
    const pdfExtensions = ['pdf'];
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp', 'heic', 'heif'];
    
    if (pdfExtensions.includes(extension)) {
      console.log('Detected PDF file type from extension');
      return 'pdf';
    } else if (imageExtensions.includes(extension)) {
      console.log('Detected image file type from extension');
      return 'image';
    }
    
    // If extension doesn't provide clear type, try HEAD request
    try {
      const response = await fetch(fileUrl, { method: 'HEAD' });
      if (!response.ok) {
        console.warn(`Failed to fetch file headers: ${response.status}`);
      } else {
        const contentType = response.headers.get('content-type');
        if (contentType) {
          console.log('Content-Type:', contentType);
          
          if (contentType.includes('pdf')) {
            return 'pdf';
          } else if (contentType.includes('image')) {
            return 'image';
          }
        }
      }
    } catch (headError) {
      console.warn('HEAD request failed, falling back to extension-based detection:', headError);
    }
    
    // If we can't determine from HEAD request, make a best guess
    console.log('Could not determine file type from headers, guessing based on URL');
    if (fileUrl.includes('pdf') || fileUrl.includes('document')) {
      return 'pdf';
    } else {
      // Default to image if we can't determine
      return 'image';
    }
  } catch (error) {
    console.error('File type detection error:', error);
    throw new Error(`Failed to detect file type: ${error.message}`);
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
    // Detect file type first
    const fileType = await detectFileTypeClient(fileUrl);
    console.log('File type detected:', fileType);

    // Extract text based on file type
    let extractionResult;
    let extractedText;
    
    if (fileType === 'pdf') {
      extractionResult = await extractTextFromPDFClient(fileUrl);
      extractedText = extractionResult.text;
    } else {
      extractionResult = await extractTextFromImageClient(fileUrl);
      extractedText = extractionResult.text;
    }

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('No text was extracted from the document');
    }

    console.log('Text extracted successfully, length:', extractedText.length);
    console.log('First 200 chars:', extractedText.substring(0, 200));

    // First verify if it's a medical bill
    console.log('Verifying if document is a medical bill...');
    const verificationResult = await processWithClientLLM(extractedText, true);
    console.log('Verification result:', verificationResult);

    let structuredData = null;
    if (verificationResult.isMedicalBill) {
      // Then extract data if it is a medical bill
      console.log('Document is a medical bill, extracting data...');
      structuredData = await processWithClientLLM(extractedText, false);
      console.log('Data extraction complete:', structuredData);
    }

    // Ensure we're returning the extracted text
    const result = {
      success: true,
      extractedText: extractedText,
      extractedData: structuredData,
      isMedicalBill: verificationResult.isMedicalBill,
      confidence: verificationResult.confidence,
      reason: verificationResult.reason,
      fileType
    };
    
    console.log('Final client-side analysis result:', {
      success: result.success,
      textLength: result.extractedText.length,
      hasExtractedData: !!result.extractedData,
      isMedicalBill: result.isMedicalBill,
      confidence: result.confidence,
      fileType: result.fileType
    });
    
    return result;

  } catch (error) {
    console.error('Client-side analysis error:', error);
    throw new Error(`Client-side analysis failed: ${error.message}`);
  }
} 