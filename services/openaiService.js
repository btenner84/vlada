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
    
    // Add specific instructions for patient name extraction
    const enhancedOptions = {
      ...options,
      instructions: `
        When extracting patient information, please follow these guidelines:
        1. For patient name, extract ONLY the actual name without any additional text like "Patient Number" or "Dates of Service"
        2. If multiple potential names are found, choose the one most likely to be the patient name
        3. Ensure the extracted name is clean and properly formatted
        4. For dates, try to identify which is the service date and which is the due date
        5. For amounts, identify the total billed amount accurately
      `
    };
    
    // Prepare the request
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        text,
        mode: options.mode || 'extract',
        ...enhancedOptions
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