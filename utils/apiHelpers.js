/**
 * Calls the combined verification and extraction API endpoint
 * @param {string} text - The extracted text from the document
 * @param {Object} options - Optional parameters for the API call
 * @returns {Promise<Object>} - Object containing verification and extraction results
 */
export async function callVerifyExtractAPI(text, options = {}) {
  try {
    console.log('Calling verify-extract API...');
    console.log('Text length:', text.length);
    console.log('Options:', options);

    const response = await fetch('/api/verify-extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        options
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('Error calling verify-extract API:', errorData);
      throw new Error(`API error: ${response.status} - ${errorData.error || 'Unknown error'}`);
    }

    const result = await response.json();
    console.log('Verify-extract API response received');
    return result;
  } catch (error) {
    console.error('Error in callVerifyExtractAPI:', error);
    throw error;
  }
} 