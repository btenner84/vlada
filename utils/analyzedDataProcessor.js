/**
 * Medical Bill Analyzed Data Processor
 * This module serves as the Model and Controller in an MCP pattern
 * for processing OCR data and ensuring it flows correctly to the UI
 */

/**
 * Processes raw OCR data into a structured format for UI display
 * @param {Object} rawData - Raw OCR and AI analyzed data
 * @returns {Object} Processed data ready for UI consumption
 */
export function processAnalyzedData(rawData) {
  console.log('processAnalyzedData called with:', rawData ? 'data present' : 'no data');
  
  if (!rawData) {
    console.log('No data provided, returning empty structure');
    return createEmptyDataStructure();
  }

  // Create a deep copy to avoid modifying the original
  const processedData = JSON.parse(JSON.stringify(rawData));
  
  // Preserve any existing metadata if it exists
  const existingMeta = processedData._meta || {};
  
  // Always treat as a potential medical bill for extraction purposes, regardless of isMedicalBill flag
  const forceAsMedicalBill = true;
  
  // Direct extraction - if raw data has extractedText, always try to extract information
  if (processedData.extractedText) {
    console.log('Raw text found - attempting aggressive information extraction');
    const extractedNumericalData = extractNumericalDataFromText(processedData.extractedText);
    
    // Initialize basic structures if they don't exist
    if (!processedData.patientInfo) processedData.patientInfo = {};
    if (!processedData.billInfo) processedData.billInfo = {};
    if (!processedData.services) processedData.services = [];
    
    // Always try to extract a patient name
    const patientName = extractPatientName(processedData.extractedText);
    if (patientName) {
      processedData.patientInfo.fullName = patientName;
      console.log('Extracted patient name:', patientName);
    }
    
    // Always try to extract dates
    if (extractedNumericalData.allDates && extractedNumericalData.allDates.length > 0) {
      // Sort dates to get potential service dates (earlier) and due dates (later)
      const sortedDates = [...extractedNumericalData.allDates].sort();
      if (sortedDates.length >= 2) {
        processedData.billInfo.serviceDates = sortedDates[0];
        processedData.billInfo.dueDate = sortedDates[sortedDates.length - 1];
        console.log('Extracted service date:', sortedDates[0], 'and due date:', sortedDates[sortedDates.length - 1]);
      } else if (sortedDates.length === 1) {
        processedData.billInfo.serviceDates = sortedDates[0];
        console.log('Extracted single date as service date:', sortedDates[0]);
      }
    }
    
    // Always try to extract amounts
    if (extractedNumericalData.allAmounts && extractedNumericalData.allAmounts.length > 0) {
      // Sort amounts by value (largest likely to be total)
      const sortedAmounts = extractedNumericalData.allAmounts
        .filter(amt => amt.includes('$') || amt.includes('.'))
        .map(amt => {
          const numValue = parseFloat(amt.replace(/[$,]/g, '')) || 0;
          return { original: amt, value: numValue };
        })
        .sort((a, b) => b.value - a.value); // Largest first
      
      if (sortedAmounts.length > 0) {
        // Use largest amount as total
        processedData.billInfo.totalAmount = sortedAmounts[0].original;
        console.log('Using largest amount as total:', sortedAmounts[0].original);
        
        // Create service entries for other significant amounts
        const significantAmounts = sortedAmounts
          .slice(1) // Skip the total amount
          .filter(amt => amt.value > 10); // Only include amounts over $10
        
        // Create at least one service from each significant amount
        if (significantAmounts.length > 0) {
          processedData.services = significantAmounts.slice(0, 5).map((amt, index) => ({
            description: `Service item ${index + 1}`,
            code: "Not found",
            amount: amt.original,
            details: "Extracted from numeric data"
          }));
          console.log('Created', processedData.services.length, 'service items from amounts');
        }
      }
    }
    
    // Always include the numerical data
    processedData.numericalData = extractedNumericalData;
    
    // Try to extract potential diagnosis or procedure codes
    const codes = extractMedicalCodes(processedData.extractedText);
    if (codes.length > 0) {
      processedData.diagnosticCodes = codes;
      console.log('Extracted', codes.length, 'potential medical codes');
    }
  }
  
  // Ensure all required data structures exist
  const result = {
    patientInfo: processPatientInfo(processedData.patientInfo || {}),
    billInfo: processBillInfo(processedData.billInfo || {}),
    services: processServices(processedData.services || []),
    insuranceInfo: processInsuranceInfo(processedData.insuranceInfo || {}),
    diagnosticCodes: processDiagnosticCodes(processedData.diagnosticCodes || []),
    numericalData: processNumericalData(processedData.numericalData || {})
  };

  // Add metadata
  result._meta = {
    ...existingMeta, // Preserve any existing metadata like processedFromRawText flag
    dataCompleteness: calculateDataCompleteness(result),
    processedAt: existingMeta.processedAt || new Date().toISOString(),
    hadRawNumericalData: !!processedData.numericalData?.allAmounts?.length,
    originalExtractedText: !!processedData.extractedText,
    forcedAsMedicalBill: forceAsMedicalBill
  };
  
  // Copy the original extracted text if available
  if (processedData.extractedText) {
    result.extractedText = processedData.extractedText;
  }

  console.log('Processed data results:', {
    patientName: result.patientInfo.fullName,
    totalAmount: result.billInfo.totalAmount,
    serviceDates: result.billInfo.serviceDates,
    servicesCount: result.services.length,
    completeness: result._meta.dataCompleteness
  });

  return result;
}

/**
 * Process patient information
 * @param {Object} patientInfo - Raw patient info
 * @returns {Object} Processed patient info
 */
function processPatientInfo(patientInfo) {
  return {
    fullName: ensureValue(patientInfo.fullName),
    dateOfBirth: ensureValue(patientInfo.dateOfBirth),
    accountNumber: ensureValue(patientInfo.accountNumber),
    insuranceInfo: ensureValue(patientInfo.insuranceInfo)
  };
}

/**
 * Process bill information
 * @param {Object} billInfo - Raw bill info
 * @returns {Object} Processed bill info
 */
function processBillInfo(billInfo) {
  return {
    totalAmount: ensureValue(billInfo.totalAmount),
    serviceDates: ensureValue(billInfo.serviceDates),
    dueDate: ensureValue(billInfo.dueDate),
    facilityName: ensureValue(billInfo.facilityName),
    provider: ensureValue(billInfo.provider)
  };
}

/**
 * Process services
 * @param {Array} services - Raw services array
 * @returns {Array} Processed services
 */
function processServices(services) {
  if (!Array.isArray(services) || services.length === 0) {
    return [createEmptyService()];
  }
  
  return services.map(service => ({
    description: ensureValue(service.description),
    code: ensureValue(service.code),
    amount: ensureValue(service.amount),
    details: ensureValue(service.details)
  }));
}

/**
 * Process insurance information
 * @param {Object} insuranceInfo - Raw insurance info
 * @returns {Object} Processed insurance info
 */
function processInsuranceInfo(insuranceInfo) {
  return {
    amountCovered: ensureValue(insuranceInfo.amountCovered),
    patientResponsibility: ensureValue(insuranceInfo.patientResponsibility),
    adjustments: ensureValue(insuranceInfo.adjustments),
    type: ensureValue(insuranceInfo.type)
  };
}

/**
 * Process diagnostic codes
 * @param {Array} codes - Raw diagnostic codes
 * @returns {Array} Processed diagnostic codes
 */
function processDiagnosticCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) {
    return [];
  }
  
  return codes.map(code => ensureValue(code));
}

/**
 * Process numerical data
 * @param {Object} numericalData - Raw numerical data
 * @returns {Object} Processed numerical data
 */
function processNumericalData(numericalData) {
  return {
    allAmounts: Array.isArray(numericalData.allAmounts) ? numericalData.allAmounts : [],
    allDates: Array.isArray(numericalData.allDates) ? numericalData.allDates : [],
    allCodes: Array.isArray(numericalData.allCodes) ? numericalData.allCodes : []
  };
}

/**
 * Ensure a value exists and is valid for UI display
 * @param {any} value - The value to check
 * @returns {string} A valid string for UI display
 */
function ensureValue(value) {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  
  if (value === 'Not found') {
    return '-';
  }
  
  return String(value);
}

/**
 * Calculate data completeness percentage
 * @param {Object} data - Processed data
 * @returns {number} Completeness percentage (0-100)
 */
function calculateDataCompleteness(data) {
  const requiredFields = [
    'patientInfo.fullName',
    'billInfo.totalAmount', 
    'billInfo.serviceDates',
    'billInfo.dueDate'
  ];
  
  let filledCount = 0;
  
  for (const field of requiredFields) {
    const [section, key] = field.split('.');
    if (data[section] && data[section][key] && data[section][key] !== '-') {
      filledCount++;
    }
  }
  
  // Include service items in completeness calculation
  if (data.services && data.services.length > 0 && 
      data.services[0].description !== '-' &&
      data.services[0].amount !== '-') {
    filledCount++;
  }
  
  return Math.round((filledCount / (requiredFields.length + 1)) * 100);
}

/**
 * Create empty service structure
 * @returns {Object} Empty service structure
 */
function createEmptyService() {
  return {
    description: '-',
    code: '-',
    amount: '-',
    details: '-'
  };
}

/**
 * Create empty data structure for new analysis
 * @returns {Object} Empty data structure
 */
function createEmptyDataStructure() {
  return {
    patientInfo: {
      fullName: '-',
      dateOfBirth: '-',
      accountNumber: '-',
      insuranceInfo: '-'
    },
    billInfo: {
      totalAmount: '-',
      serviceDates: '-',
      dueDate: '-',
      facilityName: '-',
      provider: '-'
    },
    services: [createEmptyService()],
    insuranceInfo: {
      amountCovered: '-',
      patientResponsibility: '-',
      adjustments: '-',
      type: '-'
    },
    diagnosticCodes: [],
    numericalData: {
      allAmounts: [],
      allDates: [],
      allCodes: []
    },
    _meta: {
      dataCompleteness: 0,
      processedAt: new Date().toISOString(),
      hadRawNumericalData: false
    }
  };
}

/**
 * Analyze raw OCR text for numerical data
 * @param {string} text - Raw OCR text
 * @returns {Object} Extracted numerical data
 */
export function extractNumericalDataFromText(text) {
  if (!text) return { allAmounts: [], allDates: [], allCodes: [] };
  
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
 * Choose the best patient name from multiple sources
 * @param {Object} extractedData - Extracted data from OCR/AI
 * @param {Object} user - User object from authentication
 * @returns {string} Best patient name
 */
export function chooseBestPatientName(extractedData, user) {
  if (!extractedData) return user?.displayName || '-';
  
  if (extractedData?.patientInfo?.fullName && 
      extractedData.patientInfo.fullName !== '-' && 
      extractedData.patientInfo.fullName !== 'Not found') {
    return extractedData.patientInfo.fullName;
  }
  
  // Try numericalData for potential name matches
  if (extractedData?.numericalData?.rawText) {
    // Simple name extraction logic - could be enhanced
    const nameMatches = extractedData.numericalData.rawText.match(/(?:patient|name)[\s:]+([A-Za-z\s.,'-]+?)(?:\s+(?:number|dob|date|account|id|#|\r|\n|,|;|$))/i);
    if (nameMatches && nameMatches[1]) {
      return nameMatches[1].trim();
    }
  }
  
  // Try extractedText if available
  if (extractedData?.extractedText) {
    const nameMatches = extractedData.extractedText.match(/(?:patient|name)[\s:]+([A-Za-z\s.,'-]+?)(?:\s+(?:number|dob|date|account|id|#|\r|\n|,|;|$))/i);
    if (nameMatches && nameMatches[1]) {
      return nameMatches[1].trim();
    }
  }
  
  // Fall back to user display name
  if (user?.displayName) {
    return user.displayName;
  }
  
  return '-';
}

/**
 * Extract patient name using various patterns
 * @param {string} text - Raw OCR text
 * @returns {string|null} - Extracted patient name or null
 */
function extractPatientName(text) {
  if (!text) return null;
  
  // Try different patterns for patient name extraction
  const patterns = [
    // Pattern 1: After "Patient:" or "Name:" with potential continued text
    /(?:patient|name|patient name)[\s:]+([A-Za-z\s.,'-]+?)(?=\s+(?:number|dob|date|account|id|#|\r|\n|,|;|$))/i,
    
    // Pattern 2: Capitalized names (2+ consecutive capitalized words)
    /\b([A-Z][A-Za-z]{1,20}(?:\s+[A-Z][A-Za-z]{1,20}){1,3})\b/,
    
    // Pattern 3: After "PatientNome" (common OCR error for "Patient Name")
    /(?:PatientNome)[\s:]+([A-Za-z\s.,'-]+?)(?=\s+(?:number|dob|date|account|id|#|\r|\n|,|;|$))/i,
    
    // Pattern 4: Name-like pattern with Mr./Mrs./Ms. prefix
    /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.)\s+([A-Za-z\s.,'-]+?)(?=\s+|\r|\n|,|;|$)/i
  ];
  
  // Try each pattern in sequence
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].trim().length > 3) {
      // Clean up the extracted name
      const name = match[1].trim()
        .replace(/\b(?:patient|name|PatientNome)\b/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (name.length > 0 && name.length < 40) {
        return name;
      }
    }
  }
  
  // If no pattern matches, look for any name-like sequence
  const wordsInText = text.split(/\s+/);
  for (let i = 0; i < wordsInText.length - 1; i++) {
    // Check for two consecutive capitalized words
    if (/^[A-Z][a-z]{2,}$/.test(wordsInText[i]) && /^[A-Z][a-z]{2,}$/.test(wordsInText[i+1])) {
      return `${wordsInText[i]} ${wordsInText[i+1]}`;
    }
  }
  
  return null;
}

/**
 * Extract potential medical codes from text
 * @param {string} text - Raw OCR text
 * @returns {Array} - Array of potential medical codes
 */
function extractMedicalCodes(text) {
  if (!text) return [];
  
  const codes = [];
  
  // CPT codes: 5 digits
  const cptRegex = /\b\d{5}\b/g;
  let match;
  while ((match = cptRegex.exec(text)) !== null) {
    codes.push(match[0]);
  }
  
  // ICD-10 codes: Letter followed by 1-7 characters including possible decimal
  const icdRegex = /\b[A-Z]\d{1,2}(?:\.\d{1,3})?\b/g;
  while ((match = icdRegex.exec(text)) !== null) {
    codes.push(match[0]);
  }
  
  // HCPCS codes: Letter followed by 4 digits
  const hcpcsRegex = /\b[A-Z]\d{4}\b/g;
  while ((match = hcpcsRegex.exec(text)) !== null) {
    codes.push(match[0]);
  }
  
  // Return unique codes
  return [...new Set(codes)].slice(0, 10); // Limit to top 10 codes
} 