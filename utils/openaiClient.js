const axios = require('axios');

/**
 * Client for interacting with OpenAI API for medical bill analysis
 */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Analyzes extracted medical bill text using OpenAI to extract structured information
 * 
 * @param {string} extractedText - Raw text extracted from the medical bill via Vision API
 * @returns {Promise<Object>} - Structured bill data with enhanced analysis
 */
async function analyzeMedicalBillText(extractedText) {
  if (!extractedText || typeof extractedText !== 'string') {
    console.error('Invalid text provided for OpenAI analysis:', extractedText);
    throw new Error('Invalid text provided for AI analysis');
  }

  console.log('Starting OpenAI analysis of medical bill text...');
  console.log(`Text length: ${extractedText.length} characters`);

  try {
    // Construct the system prompt for the OpenAI model
    const systemPrompt = `You are a medical billing expert AI. Your job is to analyze unstructured medical bill text and extract structured data.
      
You will receive raw text extracted from a medical bill image. This text may contain OCR errors or formatting issues.
      
Please extract and return the following information in a structured JSON format:
- patientInfo: Include name, contact details, and any patient identifiers
- providerInfo: Include provider name, facility, contact information
- billing: Include total cost, amount due, date of service, due date
- services: An array of services rendered, each with description and cost
- insurance: Any insurance details including plan, coverage, co-pays
- additionalInfo: Any other relevant information from the bill
      
Return ONLY valid JSON without explanations or markdown formatting. If information is not found, use null or leave the field empty.`;

    // Construct the OpenAI API request
    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: "gpt-4-turbo", // Or your preferred model
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: extractedText }
        ],
        temperature: 0.1, // Low temperature for more deterministic results
        max_tokens: 2000,
        response_format: { type: "json_object" }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        }
      }
    );

    // Parse and validate the response
    const aiResponse = response.data.choices[0].message.content;
    console.log('OpenAI analysis completed successfully');
    
    try {
      // Parse and return the JSON
      const parsedData = JSON.parse(aiResponse);
      return parsedData;
    } catch (parseError) {
      console.error('Failed to parse OpenAI response as JSON:', parseError);
      console.log('Raw response:', aiResponse);
      throw new Error('Invalid response format from AI analysis');
    }

  } catch (error) {
    console.error('Error during OpenAI analysis:', error.message);
    if (error.response) {
      console.error('OpenAI API response error:', error.response.data);
      console.error('Status:', error.response.status);
    }
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}

module.exports = {
  analyzeMedicalBillText
}; 