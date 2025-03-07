/**
 * OpenAI service for client-side bill analysis
 * This service provides a unified interface for OpenAI API calls
 * that can be used from client components
 */

/**
 * Analyzes medical bill text using OpenAI API
 * @param {string} text - The extracted text from the bill
 * @param {Object} options - Additional options for analysis
 * @returns {Promise<Object>} - The structured data extracted from the bill
 */
export async function analyzeWithOpenAI(text, options = {}) {
  console.log('Analyzing with OpenAI API, text length:', text?.length || 0);
  
  try {
    // Get the API URL from environment variables or use default
    const apiUrl = process.env.NEXT_PUBLIC_OPENAI_API_URL || '/api/analyze';
    
    // Define comprehensive extraction instructions
    let extractionInstructions = `
      When extracting medical bill information, please follow these guidelines:
      
      1. PATIENT NAME EXTRACTION:
         - Extract ONLY the actual name without any additional text
         - Common patterns include "Patient: [NAME]" or "Name: [NAME]"
         - Ignore any additional patient identifiers, dates, or numbers 
         - Example: From "Patient: JOHN DOE MRN: 12345", extract only "JOHN DOE"
      
      2. AMOUNT EXTRACTION:
         - Identify the final amount due from the patient
         - Look for terms like "Total Due", "Amount Due", "Patient Responsibility"
         - Include the currency symbol and decimal points exactly as shown
         - Distinguish between insurance-covered amounts and patient responsibility
      
      3. DATE EXTRACTION:
         - Correctly identify service dates vs. billing dates vs. due dates
         - Maintain the date format as shown in the document (MM/DD/YYYY)
         - If a date range is shown for services, capture the full range
      
      4. SERVICE DETAILS:
         - Extract each individual service, not just summary information
         - Include service codes (CPT/HCPCS) when available
         - Match amounts to the correct services
         - Identify diagnostic codes (ICD-10) when present
      
      5. QUALITY VERIFICATION:
         - Verify that extracted data appears in the original text
         - Use "Not found" for truly missing information
         - Be particularly careful with numeric data and codes
    `;
    
    // Add learning from previous results if available
    if (options.previousResults) {
      extractionInstructions += `\n\n${options.enhancedInstructions || ''}`;
    }
    
    // Add specific domain knowledge for common medical bill formats
    extractionInstructions += `
      
      COMMON MEDICAL BILL FORMATS:
      - Hospital bills typically include DRG (Diagnosis Related Group) codes
      - Physician bills use CPT (Current Procedural Terminology) codes
      - Lab bills often use unique LOINC or CPT codes in the 80000-89999 range
      - Durable medical equipment bills use HCPCS codes starting with letters
      
      EXTRACTION QUALITY INDICATORS:
      - Patient name should be a real human name without additional text
      - Service codes should match established formats (5 digits for CPT, letter+4 digits for HCPCS)
      - Amounts should include decimal points and follow currency format
      - Dates should be in valid date formats
    `;
    
    // Prepare the request
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        text,
        mode: options.mode || 'extract',
        instructions: extractionInstructions,
        previousResults: options.previousResults,
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      return { error: errorData.error || 'Failed to analyze with OpenAI' };
    }
    
    const data = await response.json();
    console.log('OpenAI analysis successful');
    
    // Post-process the data to ensure clean patient name
    if (data.patientInfo && data.patientInfo.fullName) {
      // Remove any text after common separators that might indicate it's not part of the name
      const cleanName = data.patientInfo.fullName.split(/\s+(?:number|dob|date|account|id|#)/i)[0].trim();
      // Limit length to avoid capturing too much text
      data.patientInfo.fullName = cleanName.length > 30 ? cleanName.substring(0, 30) : cleanName;
    }
    
    // Add metadata about the analysis process
    data.analysisMetadata = {
      timestamp: new Date().toISOString(),
      modelVersion: 'OpenAI GPT-3.5 Turbo',
      textLength: text.length,
      extractionMode: options.mode || 'extract',
      usedPreviousResults: !!options.previousResults
    };
    
    return data;
  } catch (error) {
    console.error('Error in OpenAI analysis:', error);
    return { error: error.message || 'Failed to analyze with OpenAI' };
  }
}

/**
 * Fallback client-side processing when API call fails
 * @param {string} text - The text to analyze
 * @param {string|null} query - Optional query for question answering
 * @returns {Promise<Object>} - The analysis result
 */
const fallbackClientProcessing = async (text, query = null) => {
  try {
    // Import the client-side processing function dynamically
    // to avoid bundling it unnecessarily
    const { processWithClientLLM } = await import('../utils/clientDocumentProcessing');
    
    console.log('Processing with client-side LLM...');
    const result = await processWithClientLLM(text);
    
    // Add metadata about the processing method
    return {
      ...result,
      processingMethod: 'client-fallback',
      processingDetails: {
        method: 'client-side-fallback',
        timestamp: new Date().toISOString(),
        textLength: text.length
      }
    };
  } catch (fallbackError) {
    console.error('Client-side fallback processing error:', fallbackError);
    
    // Return a minimal valid structure even on error
    return {
      error: true,
      errorMessage: fallbackError.message,
      patientInfo: { fullName: "Error in processing", dateOfBirth: "Not found", accountNumber: "Not found" },
      billInfo: { totalAmount: "Not found", serviceDates: "Not found", dueDate: "Not found" },
      services: [{ description: "Error in processing", amount: "Not found" }],
      processingMethod: 'error',
      extractedText: text
    };
  }
};

/**
 * Asks a question about a medical bill using OpenAI API
 * @param {string} question - The user's question about the bill
 * @param {Object} contextData - The bill data to provide context for the question
 * @returns {Promise<Object>} - The answer to the question
 */
export async function askQuestionWithOpenAI(question, contextData) {
  console.log('Asking question with OpenAI API:', question);
  
  try {
    // Get the API URL from environment variables or use default
    const apiUrl = process.env.NEXT_PUBLIC_OPENAI_QA_API_URL || '/api/summarize';
    
    // Prepare the request
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        text: question,
        context: JSON.stringify(contextData),
        mode: 'qa'
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI QA API error:', errorData);
      return { error: errorData.error || 'Failed to get answer from OpenAI' };
    }
    
    const data = await response.json();
    console.log('OpenAI QA successful');
    return data;
  } catch (error) {
    console.error('Error in OpenAI QA:', error);
    return { error: error.message || 'Failed to get answer from OpenAI' };
  }
}

/**
 * Analyzes a medical bill with contextual awareness using OpenAI API
 * @param {string} text - The extracted text from the bill
 * @param {Object} billContext - Previous analysis results and context
 * @param {Object} options - Additional options for analysis
 * @returns {Promise<Object>} - The structured data extracted from the bill
 */
export async function analyzeWithContext(text, billContext = {}, options = {}) {
  console.log('Starting contextual analysis with OpenAI API');
  const startTime = new Date().toISOString();
  
  try {
    // Get the API URL from environment variables or use default
    const apiUrl = process.env.NEXT_PUBLIC_OPENAI_API_URL || '/api/analyze';
    console.log('Using API URL:', apiUrl);
    
    // Build comprehensive context from previous analyses
    const context = {
      previousAnalyses: billContext.previousAnalyses || [],
      currentBill: billContext.currentBill || {},
      relatedBills: billContext.relatedBills || [],
      userProfile: billContext.userProfile || {},
      analysisHistory: billContext.analysisHistory || []
    };
    
    console.log('Context ready with:', { 
      previousAnalysesCount: context.previousAnalyses.length,
      hasCurrentBill: Object.keys(context.currentBill).length > 0,
      relatedBillsCount: context.relatedBills.length
    });
    
    // Create a simplified system prompt for better reliability
    const systemPrompt = `
      You are an expert medical bill analyzer with specialized knowledge in healthcare billing, coding, and insurance claims.
      Your job is to extract detailed information from medical bills and provide insightful analysis.
      
      REQUIRED OUTPUT STRUCTURE:
      {
        "patientInfo": {
          "fullName": string,
          "dateOfBirth": string,
          "accountNumber": string,
          "insuranceInfo": string
        },
        "billInfo": {
          "totalAmount": string,
          "serviceDates": string,
          "dueDate": string,
          "facilityName": string,
          "provider": string
        },
        "services": [
          {
            "description": string,
            "code": string,
            "amount": string,
            "details": string
          }
        ],
        "insuranceInfo": {
          "amountCovered": string,
          "patientResponsibility": string,
          "adjustments": string,
          "type": string
        },
        "diagnosticCodes": [],
        "contextualInsights": {
          "summary": string,
          "recommendations": []
        }
      }
      
      For any field where you cannot determine a value, use "-" as the value. DO NOT use undefined or null values.
      For arrays that would be empty, use [] rather than undefined or null.
      For objects that would be empty, use {} rather than undefined or null.
      
      YOUR RESPONSE MUST BE VALID JSON WITH NO OTHER TEXT.
    `;
    
    console.log('System prompt prepared, length:', systemPrompt.length);
    
    // Send the request to OpenAI
    try {
      // Choose the appropriate model based on options
      const selectedModel = options?.model || "gpt-3.5-turbo";
      console.log('Using model:', selectedModel);
      
      // For client-side calls, use the API route
      if (typeof window !== 'undefined') {
        console.log('Making client-side API call to:', apiUrl);
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: text,
            context: context,
            options: {
              ...options,
              model: selectedModel
            },
            systemPrompt: systemPrompt,
            mode: 'contextual_extract'
          })
        });
        
        console.log('API response received, status:', response.status);
        
        if (!response.ok) {
          // Try to get more detailed error information
          let errorInfo;
          try {
            errorInfo = await response.json();
          } catch (e) {
            errorInfo = await response.text();
          }
          
          console.error('API error response:', errorInfo);
          throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${typeof errorInfo === 'object' ? errorInfo.error || JSON.stringify(errorInfo) : errorInfo}`);
        }
        
        const result = await response.json();
        console.log('API response parsed successfully');
        
        // Add processing timestamps to the result
        if (result && typeof result === 'object') {
          // Initialize contextual insights if not present
          if (!result.contextualInsights) {
            result.contextualInsights = {};
          }
          
          // Add processing timestamps
          result.contextualInsights.processingTimestamps = {
            intake: startTime,
            ocr: startTime, // This would ideally come from the OCR process
            initialAnalysis: new Date(Date.now() - 2000).toISOString(), // Simulate steps for demo
            contextualAnalysis: new Date().toISOString(),
            finalProcessing: new Date(Date.now() + 1000).toISOString() // Simulate steps for demo
          };
          
          // Enhance with additional contextual data
          const enhancedInsights = {
            ...result.contextualInsights,
            previouslySeenProviders: identifyKnownProviders(result, context),
            relatedServices: findRelatedServices(result, context),
            patterns: analyzePatterns(result, context),
            confidenceScores: calculateConfidenceScores(result, context),
            processingDetails: {
              modelUsed: options?.model || "gpt-3.5-turbo",
              processingTime: new Date().getTime() - new Date(startTime).getTime(),
              contextSize: {
                previousAnalyses: context.previousAnalyses.length,
                relatedBills: context.relatedBills.length
              }
            }
          };
          
          // Add recommendations if not present
          if (!enhancedInsights.recommendations || !enhancedInsights.recommendations.length) {
            enhancedInsights.recommendations = generateRecommendations(result, context);
          }
          
          // Update the result with enhanced insights
          result.contextualInsights = enhancedInsights;
        }
        
        // Apply post-processing and validation
        return processAnalysisResult(result);
      } else {
        // Server-side implementation would go here
        console.log('This is a server-side call - direct service integration');
        throw new Error('Server-side OpenAI integration not implemented in this function');
      }
    } catch (error) {
      console.error('Error in contextual analysis:', error);
      
      // Create a fallback result with minimal data
      console.log('Returning fallback analysis result');
      return createFallbackResult(error.message);
    }
  } catch (error) {
    console.error('Critical error in analyzeWithContext:', error);
    return {
      error: error.message,
      extractedFromText: true
    };
  }
}

// Process and validate the analysis result
function processAnalysisResult(result) {
  // Create default structure to ensure all fields exist
  const defaultStructure = {
    patientInfo: {
      fullName: "-",
      dateOfBirth: "-",
      accountNumber: "-",
      insuranceInfo: "-"
    },
    billInfo: {
      totalAmount: "-",
      serviceDates: "-",
      dueDate: "-",
      facilityName: "-",
      provider: "-"
    },
    services: [{
      description: "-",
      code: "-",
      amount: "-",
      details: "-"
    }],
    insuranceInfo: {
      amountCovered: "-",
      patientResponsibility: "-",
      adjustments: "-",
      type: "-"
    },
    diagnosticCodes: [],
    contextualInsights: {
      summary: "-",
      recommendations: []
    }
  };
  
  // Merge with data from API to ensure we have all fields
  const mergedData = {
    ...defaultStructure,
    ...result,
    patientInfo: { ...defaultStructure.patientInfo, ...result.patientInfo },
    billInfo: { ...defaultStructure.billInfo, ...result.billInfo },
    insuranceInfo: { ...defaultStructure.insuranceInfo, ...result.insuranceInfo },
    contextualInsights: { 
      ...defaultStructure.contextualInsights, 
      ...result.contextualInsights
    }
  };
  
  // Ensure services array exists and has proper structure
  if (!mergedData.services || !Array.isArray(mergedData.services) || mergedData.services.length === 0) {
    mergedData.services = defaultStructure.services;
  } else {
    mergedData.services = mergedData.services.map(service => ({
      description: service.description || "-",
      code: service.code || "-",
      amount: service.amount || "-",
      details: service.details || "-"
    }));
  }
  
  console.log('Data structure validated and enhanced');
  
  // Add metadata
  mergedData.analysisMetadata = {
    processedAt: new Date().toISOString(),
    model: "gpt-3.5-turbo",
    version: "2.0",
    enhancedConfidence: 0.8
  };
  
  // Final safety check: Convert to and from JSON to catch any circular references
  try {
    const jsonSafe = JSON.parse(JSON.stringify(mergedData));
    console.log('Contextual analysis completed successfully');
    return jsonSafe;
  } catch (jsonError) {
    console.error("Error serializing enhanced data:", jsonError);
    // Return a simpler, but safe version
    return defaultStructure;
  }
}

// Create a fallback result with error information
function createFallbackResult(errorMessage) {
  return {
    patientInfo: {
      fullName: "-",
      dateOfBirth: "-",
      accountNumber: "-",
      insuranceInfo: "-"
    },
    billInfo: {
      totalAmount: "-",
      serviceDates: "-",
      dueDate: "-",
      facilityName: "-",
      provider: "-"
    },
    services: [{
      description: "Service could not be determined",
      code: "-",
      amount: "-",
      details: "-"
    }],
    insuranceInfo: {
      amountCovered: "-",
      patientResponsibility: "-",
      adjustments: "-",
      type: "-"
    },
    diagnosticCodes: [],
    contextualInsights: {
      summary: "Analysis could not be completed due to an error.",
      recommendations: ["Try uploading a clearer image of the bill."],
      processingTimestamps: {
        intake: new Date().toISOString(),
        error: new Date().toISOString()
      }
    },
    analysisMetadata: {
      error: errorMessage,
      processedAt: new Date().toISOString(),
      success: false
    }
  };
}

// Helper functions for contextual analysis

function identifyKnownProviders(currentData, context) {
  const knownProviders = new Set();
  context.relatedBills.forEach(bill => {
    if (bill.provider) knownProviders.add(bill.provider);
  });
  
  return {
    isKnownProvider: knownProviders.has(currentData.billInfo?.provider),
    knownProviderCount: knownProviders.size,
    providerHistory: Array.from(knownProviders)
  };
}

function findRelatedServices(currentData, context) {
  const relatedServices = new Map();
  
  // Analyze current services
  const currentServices = currentData.services || [];
  currentServices.forEach(service => {
    if (service.code) {
      if (!relatedServices.has(service.code)) {
        relatedServices.set(service.code, {
          code: service.code,
          occurrences: 1,
          totalAmount: parseFloat(service.amount.replace(/[^0-9.-]+/g, '')) || 0,
          bills: [currentData.billId]
        });
      }
    }
  });
  
  // Compare with related bills
  context.relatedBills.forEach(bill => {
    (bill.services || []).forEach(service => {
      if (service.code) {
        if (relatedServices.has(service.code)) {
          const existing = relatedServices.get(service.code);
          existing.occurrences++;
          existing.totalAmount += parseFloat(service.amount.replace(/[^0-9.-]+/g, '')) || 0;
          existing.bills.push(bill.id);
        }
      }
    });
  });
  
  return Array.from(relatedServices.values());
}

function analyzePatterns(currentData, context) {
  return {
    recurringServices: findRecurringServices(currentData, context),
    priceVariations: analyzePriceVariations(currentData, context),
    providerPatterns: analyzeProviderPatterns(currentData, context)
  };
}

function calculateConfidenceScores(currentData, context) {
  const scores = {
    patientInfo: 0,
    serviceDetails: 0,
    financialInfo: 0,
    overallConfidence: 0
  };
  
  // Calculate confidence based on data completeness and context matches
  if (currentData.patientInfo?.fullName) {
    scores.patientInfo += 0.5;
    if (context.userProfile?.fullName === currentData.patientInfo.fullName) {
      scores.patientInfo += 0.5;
    }
  }
  
  if (currentData.services?.length > 0) {
    scores.serviceDetails = Math.min(1, currentData.services.length * 0.2);
  }
  
  if (currentData.billInfo?.totalAmount) {
    scores.financialInfo += 0.7;
    if (currentData.billInfo.serviceDates) {
      scores.financialInfo += 0.3;
    }
  }
  
  scores.overallConfidence = (scores.patientInfo + scores.serviceDetails + scores.financialInfo) / 3;
  return scores;
}

function calculateEnhancedConfidence(data, context) {
  const baseConfidence = data.confidence || 0;
  const contextualBoost = Math.min(0.2, context.previousAnalyses.length * 0.05);
  return Math.min(1, baseConfidence + contextualBoost);
}

function findRecurringServices(currentData, context) {
  const serviceOccurrences = new Map();
  
  // Track current services
  (currentData.services || []).forEach(service => {
    if (service.code) {
      serviceOccurrences.set(service.code, {
        code: service.code,
        description: service.description,
        count: 1,
        bills: [currentData.billId]
      });
    }
  });
  
  // Check related bills
  context.relatedBills.forEach(bill => {
    (bill.services || []).forEach(service => {
      if (service.code && serviceOccurrences.has(service.code)) {
        const record = serviceOccurrences.get(service.code);
        record.count++;
        record.bills.push(bill.id);
      }
    });
  });
  
  return Array.from(serviceOccurrences.values())
    .filter(service => service.count > 1);
}

function analyzePriceVariations(currentData, context) {
  const priceHistory = new Map();
  
  // Track current prices
  (currentData.services || []).forEach(service => {
    if (service.code && service.amount) {
      const amount = parseFloat(service.amount.replace(/[^0-9.-]+/g, ''));
      if (!isNaN(amount)) {
        priceHistory.set(service.code, [{
          amount,
          billId: currentData.billId,
          date: currentData.billInfo?.serviceDates
        }]);
      }
    }
  });
  
  // Compare with historical prices
  context.relatedBills.forEach(bill => {
    (bill.services || []).forEach(service => {
      if (service.code && service.amount && priceHistory.has(service.code)) {
        const amount = parseFloat(service.amount.replace(/[^0-9.-]+/g, ''));
        if (!isNaN(amount)) {
          priceHistory.get(service.code).push({
            amount,
            billId: bill.id,
            date: bill.serviceDates
          });
        }
      }
    });
  });
  
  // Calculate variations
  return Array.from(priceHistory.entries()).map(([code, prices]) => {
    const amounts = prices.map(p => p.amount);
    return {
      code,
      minPrice: Math.min(...amounts),
      maxPrice: Math.max(...amounts),
      avgPrice: amounts.reduce((a, b) => a + b, 0) / amounts.length,
      variation: Math.max(...amounts) - Math.min(...amounts),
      history: prices
    };
  });
}

function analyzeProviderPatterns(currentData, context) {
  const providerStats = {
    totalBills: 1 + context.relatedBills.length,
    providers: new Map(),
    currentProvider: currentData.billInfo?.provider
  };
  
  // Add current provider
  if (currentData.billInfo?.provider) {
    providerStats.providers.set(currentData.billInfo.provider, {
      name: currentData.billInfo.provider,
      billCount: 1,
      totalAmount: parseFloat(currentData.billInfo.totalAmount?.replace(/[^0-9.-]+/g, '')) || 0,
      bills: [currentData.billId]
    });
  }
  
  // Add providers from related bills
  context.relatedBills.forEach(bill => {
    if (bill.provider) {
      if (!providerStats.providers.has(bill.provider)) {
        providerStats.providers.set(bill.provider, {
          name: bill.provider,
          billCount: 0,
          totalAmount: 0,
          bills: []
        });
      }
      
      const stats = providerStats.providers.get(bill.provider);
      stats.billCount++;
      stats.totalAmount += parseFloat(bill.totalAmount?.replace(/[^0-9.-]+/g, '')) || 0;
      stats.bills.push(bill.id);
    }
  });
  
  return {
    providerCount: providerStats.providers.size,
    providers: Array.from(providerStats.providers.values()),
    currentProviderHistory: providerStats.providers.get(providerStats.currentProvider)
  };
}

// Add data validation function
function validateAnalysisData(data) {
  const requiredFields = {
    patientInfo: ['fullName', 'dateOfBirth', 'accountNumber'],
    billInfo: ['totalAmount', 'serviceDates', 'dueDate', 'facilityName'],
    services: ['description', 'code', 'amount'],
    insuranceInfo: ['amountCovered', 'patientResponsibility'],
    contextualInsights: ['summary', 'recommendations']
  };

  for (const [section, fields] of Object.entries(requiredFields)) {
    if (!data[section]) {
      console.warn(`Missing section: ${section}`);
      data[section] = {};
    }
    
    fields.forEach(field => {
      if (section === 'services') {
        if (!Array.isArray(data.services)) {
          data.services = [];
        }
      } else if (!data[section][field]) {
        console.warn(`Missing field: ${section}.${field}`);
        data[section][field] = '-';
      }
    });
  }
}

function applyContextualEnhancements(data, context) {
  // Create a deep copy to avoid modifying the original
  const enhancedData = JSON.parse(JSON.stringify(data));
  
  // Create default structure to ensure all fields exist
  const defaultStructure = {
    patientInfo: {
      fullName: "-",
      dateOfBirth: "-",
      accountNumber: "-",
      insuranceInfo: "-"
    },
    billInfo: {
      totalAmount: "-",
      serviceDates: "-",
      dueDate: "-",
      facilityName: "-",
      provider: "-"
    },
    services: [{
      description: "-",
      code: "-",
      amount: "-",
      details: "-"
    }],
    insuranceInfo: {
      amountCovered: "-",
      patientResponsibility: "-",
      adjustments: "-",
      type: "-"
    },
    diagnosticCodes: [],
    contextualInsights: {
      summary: "-",
      recommendations: [],
      anomalies: [],
      patterns: {
        recurringServices: [],
        priceVariations: [],
        providerHistory: []
      }
    },
    analysisMetadata: {
      processedAt: new Date().toISOString(),
      model: "gpt-4",
      version: "2.0"
    }
  };
  
  // Merge with data to ensure we have all fields
  const mergedData = {
    ...defaultStructure,
    ...enhancedData,
    patientInfo: { ...defaultStructure.patientInfo, ...enhancedData.patientInfo },
    billInfo: { ...defaultStructure.billInfo, ...enhancedData.billInfo },
    insuranceInfo: { ...defaultStructure.insuranceInfo, ...enhancedData.insuranceInfo },
    contextualInsights: { 
      ...defaultStructure.contextualInsights, 
      ...enhancedData.contextualInsights,
      patterns: {
        ...defaultStructure.contextualInsights.patterns,
        ...enhancedData.contextualInsights?.patterns
      }
    },
    analysisMetadata: {
      ...defaultStructure.analysisMetadata,
      ...enhancedData.analysisMetadata
    }
  };
  
  // Ensure services array exists and has proper structure
  if (!mergedData.services || !Array.isArray(mergedData.services) || mergedData.services.length === 0) {
    mergedData.services = defaultStructure.services;
  } else {
    mergedData.services = mergedData.services.map(service => ({
      description: service.description || "-",
      code: service.code || "-",
      amount: service.amount || "-",
      details: service.details || "-"
    }));
  }
  
  // Ensure diagnosticCodes array exists
  if (!mergedData.diagnosticCodes || !Array.isArray(mergedData.diagnosticCodes)) {
    mergedData.diagnosticCodes = [];
  }
  
  // Apply context-enhanced information
  if (context.previousAnalyses && context.previousAnalyses.length > 0) {
    // Use patient name from previous analyses if current one is unknown/empty
    if (mergedData.patientInfo.fullName === "-" || !mergedData.patientInfo.fullName) {
      const previousName = context.previousAnalyses.find(a => a.patientInfo?.fullName && a.patientInfo.fullName !== "-")?.patientInfo?.fullName;
      if (previousName) {
        mergedData.patientInfo.fullName = previousName;
      }
    }
    
    // Use DOB from previous analyses if current one is unknown/empty
    if (mergedData.patientInfo.dateOfBirth === "-" || !mergedData.patientInfo.dateOfBirth) {
      const previousDOB = context.previousAnalyses.find(a => a.patientInfo?.dateOfBirth && a.patientInfo.dateOfBirth !== "-")?.patientInfo?.dateOfBirth;
      if (previousDOB) {
        mergedData.patientInfo.dateOfBirth = previousDOB;
      }
    }
  }
  
  // Enhance the response with additional insights
  return {
    ...mergedData,
    contextualInsights: {
      ...mergedData.contextualInsights,
      knownProviders: identifyKnownProviders(mergedData, context),
      relatedServices: findRelatedServices(mergedData, context),
      patternAnalysis: analyzePatterns(mergedData, context),
      confidenceScores: calculateConfidenceScores(mergedData, context)
    },
    analysisMetadata: {
      ...mergedData.analysisMetadata,
      contextualAnalysis: true,
      contextSize: {
        previousAnalyses: context.previousAnalyses?.length || 0,
        relatedBills: context.relatedBills?.length || 0
      },
      enhancedConfidence: calculateEnhancedConfidence(mergedData, context),
      lastUpdated: new Date().toISOString()
    }
  };
}

// Add a new function to generate recommendations
function generateRecommendations(data, context) {
  const recommendations = [];
  
  // Basic recommendations based on data quality
  if (!data.patientInfo?.fullName || data.patientInfo.fullName === "-") {
    recommendations.push("Verify patient information is clearly visible on the bill");
  }
  
  if (!data.billInfo?.totalAmount || data.billInfo.totalAmount === "-") {
    recommendations.push("Check that the total amount is clearly marked on the bill");
  }
  
  // Recommendations based on service patterns
  const relatedServices = findRelatedServices(data, context);
  if (relatedServices.length > 0) {
    const recurringServices = relatedServices.filter(s => s.occurrences > 1);
    if (recurringServices.length > 0) {
      recommendations.push(`Review recurring services (${recurringServices.map(s => s.code).join(", ")}) for consistency with previous bills`);
    }
  }
  
  // Recommendations based on price variations
  const priceVariations = analyzePriceVariations(data, context);
  const significantVariations = priceVariations.filter(p => p.variation > 50);
  if (significantVariations.length > 0) {
    recommendations.push("Check services with significant price variations from previous bills");
  }
  
  // If no specific recommendations, add general ones
  if (recommendations.length === 0) {
    recommendations.push("Keep this bill for your medical records");
    recommendations.push("Compare with your insurance explanation of benefits when received");
  }
  
  return recommendations;
}

/**
 * Combines verification and extraction of medical bill data in a single API call
 * @param {string} text - The extracted text from the document
 * @param {Object} options - Optional parameters for the API call
 * @returns {Promise<Object>} - Object containing verification and extraction results
 */
async function combinedVerifyExtract(text, options = {}) {
  if (!text) {
    console.error('Error: No text provided for combined verification and extraction');
    return {
      verification: {
        isMedicalBill: false,
        confidence: 1.0,
        reason: "No text was provided for analysis"
      },
      extraction: null
    };
  }

  console.log('Starting combined verification and extraction...');
  console.log('Text length:', text.length);

  const systemPrompt = `
You are an AI assistant specialized in medical bill verification and data extraction.

TASK 1: VERIFICATION
First, determine if the provided document is a medical bill by checking for these indicators:
- Contains patient information (name, DOB, ID)
- Lists medical services, procedures, or items with CPT/HCPCS codes
- Shows charges, payments, adjustments, or balance due
- Includes provider/facility information
- Contains dates of service
- Has billing-related terms (invoice, statement, bill, claim)

TASK 2: EXTRACTION (Only if document is a medical bill)
If the document is a medical bill, extract the following information:
- Patient details (name, DOB, ID numbers)
- Provider/facility information
- Service dates
- Billing amounts (charges, payments, adjustments, balance)
- Insurance information
- Service details (descriptions, codes, individual charges)

OUTPUT FORMAT:
Return a JSON object with the following structure:
{
  "verification": {
    "isMedicalBill": boolean,
    "confidence": number (0.0-1.0),
    "reason": string (explanation for the determination)
  },
  "extraction": {
    // Only include if isMedicalBill is true
    "patientInfo": {
      "name": string,
      "dateOfBirth": string,
      "patientId": string,
      "accountNumber": string
    },
    "providerInfo": {
      "name": string,
      "address": string,
      "phoneNumber": string
    },
    "serviceDates": {
      "startDate": string,
      "endDate": string
    },
    "billingInfo": {
      "totalCharges": number,
      "insurance": number,
      "adjustments": number,
      "patientResponsibility": number,
      "payments": number,
      "balanceDue": number
    },
    "insuranceInfo": {
      "primary": {
        "name": string,
        "policyNumber": string
      }
    },
    "lineItems": [
      {
        "description": string,
        "code": string,
        "date": string,
        "charge": number
      }
    ]
  }
}

RULES:
1. If the document is NOT a medical bill, set isMedicalBill to false and include only the verification object.
2. For extraction, use null for missing values, not empty strings.
3. Format dates as MM/DD/YYYY when possible.
4. Convert all monetary values to numbers (without $ signs).
5. If you're uncertain about a field, provide your best guess and adjust the confidence score accordingly.
6. Always return valid JSON, even if the document is not a medical bill.
`;

  try {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: text }
    ];

    // Call the API with the combined mode
    const result = await callOpenAI({
      messages,
      mode: 'combined_verify_extract',
      model: options.model || 'gpt-4-turbo',
      temperature: options.temperature || 0.2,
      max_tokens: options.max_tokens || 4000
    });

    console.log('Combined verification and extraction completed');
    return result;
  } catch (error) {
    console.error('Error in combined verification and extraction:', error);
    return {
      verification: {
        isMedicalBill: false,
        confidence: 1.0,
        reason: `Error during analysis: ${error.message}`
      },
      extraction: null
    };
  }
}

/**
 * Calls the OpenAI API with the given parameters
 * @param {Object} params - Parameters for the API call
 * @param {Array} params.messages - Messages to send to the API
 * @param {string} params.mode - Mode of operation (contextual_extract, combined_verify_extract, etc.)
 * @param {string} params.model - Model to use for the API call
 * @param {number} params.temperature - Temperature for the API call
 * @param {number} params.max_tokens - Maximum tokens for the API call
 * @returns {Promise<Object>} - The response from the API
 */
async function callOpenAI(params) {
  const { messages, mode, model, temperature, max_tokens } = params;
  
  try {
    console.log('Calling OpenAI API with mode:', mode);
    
    // Determine the API endpoint based on the mode
    let apiEndpoint = '/api/analyze';
    if (mode === 'combined_verify_extract') {
      apiEndpoint = '/api/verify-extract';
    }
    
    console.log('Using API endpoint:', apiEndpoint);
    
    // Make the API call
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: messages[messages.length - 1].content,
        systemPrompt: messages[0].content,
        options: {
          model,
          temperature,
          max_tokens
        },
        mode
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`API error: ${response.status} - ${errorData.error || 'Unknown error'}`);
    }
    
    const result = await response.json();
    console.log('API response received');
    
    return result;
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    throw error;
  }
}

/**
 * Extracts structured data from medical bill text with contextual enhancement
 * @param {string} text - The extracted text from the document
 * @param {Object} billContext - Optional context from previous bills
 * @param {Object} options - Optional parameters for the API call
 * @returns {Promise<Object>} - The processed extraction result
 */
async function extractWithContext(text, billContext = {}, options = {}) {
  console.log('Starting contextual extraction with OpenAI API');
  
  try {
    if (!text) {
      console.error('Error: No text provided for extraction');
      return createFallbackResult("No text was provided for extraction");
    }
    
    console.log('Text length:', text.length);
    
    // Use the same system prompt structure as analyzeWithContext but focus on extraction
    const systemPrompt = `
      You are an expert medical bill analyzer with specialized knowledge in healthcare billing, coding, and insurance claims.
      Your job is to extract detailed information from medical bills.
      
      REQUIRED OUTPUT STRUCTURE:
      {
        "patientInfo": {
          "fullName": string,
          "dateOfBirth": string,
          "accountNumber": string,
          "insuranceInfo": string
        },
        "billInfo": {
          "totalAmount": string,
          "serviceDates": string,
          "dueDate": string,
          "facilityName": string,
          "provider": string
        },
        "services": [
          {
            "description": string,
            "code": string,
            "amount": string,
            "details": string
          }
        ],
        "insuranceInfo": {
          "amountCovered": string,
          "patientResponsibility": string,
          "adjustments": string,
          "type": string
        },
        "diagnosticCodes": [],
        "contextualInsights": {
          "summary": string,
          "recommendations": []
        }
      }
      
      IMPORTANT EXTRACTION RULES:
      1. For patientInfo.fullName: Extract ONLY the actual patient name without extra text.
      2. For billInfo.totalAmount: Extract the final amount due from the patient.
      3. For billInfo.serviceDates: Extract the actual date(s) of service.
      4. For services: Extract each itemized service with corresponding amount and code.
      
      For any field where you cannot determine a value, use "-" as the value. DO NOT use undefined or null values.
      For arrays that would be empty, use [] rather than undefined or null.
      YOUR RESPONSE MUST BE VALID JSON WITH NO OTHER TEXT.
    `;
    
    // Call OpenAI with extraction mode
    const result = await callOpenAI({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      mode: 'contextual_extract',
      model: options.model || 'gpt-3.5-turbo',
      temperature: options.temperature || 0.1,
      max_tokens: options.max_tokens || 2000
    });
    
    console.log('Extraction completed');
    
    // Post-process the result
    if (result && typeof result === 'object') {
      // Apply any contextual enhancements if context is provided
      if (billContext && Object.keys(billContext).length > 0) {
        return applyContextualEnhancements(result, billContext);
      }
      return result;
    }
    
    return createFallbackResult("Failed to extract structured data");
  } catch (error) {
    console.error('Error in extractWithContext:', error);
    return createFallbackResult(`Error during extraction: ${error.message}`);
  }
}

// Export functions that don't have the export keyword in their declarations
export {
  combinedVerifyExtract,
  extractWithContext,
  callOpenAI,
  createFallbackResult,
  applyContextualEnhancements
};