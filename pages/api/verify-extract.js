import { combinedVerifyExtract } from '../../services/openaiService';

/**
 * API endpoint for combined verification and extraction of medical bills
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 */
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, options } = req.body;

    // Validate input
    if (!text) {
      console.error('Error: No text provided for verification and extraction');
      return res.status(400).json({ 
        error: 'No text provided',
        verification: {
          isMedicalBill: false,
          confidence: 1.0,
          reason: "No text was provided for analysis"
        },
        extraction: null
      });
    }

    console.log('Starting combined verification and extraction process');
    console.log('Text length:', text.length);
    console.log('Options:', options);

    // Call the combined verification and extraction function
    const result = await combinedVerifyExtract(text, options || {});

    // Return the result
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in verify-extract API endpoint:', error);
    return res.status(500).json({ 
      error: `Server error: ${error.message}`,
      verification: {
        isMedicalBill: false,
        confidence: 1.0,
        reason: `Error during analysis: ${error.message}`
      },
      extraction: null
    });
  }
} 