// Client-side document processing utilities
// This file now serves as a client-side wrapper for server-side processing

/**
 * Analyzes a document using the server-side API
 * @param {string} fileUrl - URL of the file to analyze
 * @param {string|null} userId - Optional user ID for authenticated requests
 * @param {string|null} billId - Optional bill ID for authenticated requests
 * @returns {Promise<Object>} - Analysis results
 */
export async function analyzeDocumentClient(fileUrl, userId = null, billId = null) {
  try {
    console.log('Starting document analysis via server API...', { fileUrl, userId, billId });
    
    // Get the current origin for API calls
    const origin = window.location.origin;
    const apiUrl = `${origin}/api/analyze-full`;
    
    // Prepare the request body
    const requestBody = {
      fileUrl,
      userId,
      billId
    };
    
    console.log('Sending request to server API:', apiUrl);
    
    // Call the server endpoint
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Server processing failed');
    }

    console.log('Server API returned successful result:', {
      textLength: result.extractedText?.length,
      isMedicalBill: result.isMedicalBill,
      confidence: result.confidence
    });

    // Return a consistent data structure
    return {
      extractedText: result.extractedText,
      extractedData: result.extractedData || {
        patientInfo: {},
        billInfo: {},
        services: [],
        insuranceInfo: {}
      },
      confidence: result.confidence,
      processingMethod: 'server',
      isMedicalBill: result.isMedicalBill || false,
      processingTimestamp: new Date().toISOString(),
      status: 'analyzed',
      fileType: result.fileType
    };
  } catch (error) {
    console.error('Document analysis error:', error);
    // Return error structure
    return {
      extractedText: "Error processing document",
      extractedData: {
        patientInfo: { fullName: "Error", dateOfBirth: "Error", accountNumber: "Error", insuranceInfo: "Error" },
        billInfo: { totalAmount: "Error", serviceDates: "Error", dueDate: "Error", facilityName: "Error" },
        services: [{ description: "Error", code: "Error", amount: "Error", details: "Error" }],
        insuranceInfo: { amountCovered: "Error", patientResponsibility: "Error", adjustments: "Error" }
      },
      confidence: "error",
      processingMethod: 'error',
      isMedicalBill: false,
      processingTimestamp: new Date().toISOString(),
      status: 'error',
      error: error.message,
      fileType: 'unknown'
    };
  }
} 