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