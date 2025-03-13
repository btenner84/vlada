import { determineServiceSetting, categorizeWithAdvancedSystem, extractBillingCodes } from '../../utils/advancedClassifier.js';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { service, billContext } = req.body;

    if (!service || !service.description) {
      return res.status(400).json({ error: 'Service description is required' });
    }

    // Extract billing codes from a sample text (for testing purposes)
    const sampleText = `
      PATIENT: John Doe
      ACCOUNT: 12345678
      DATE OF SERVICE: ${billContext?.serviceDate || '01/01/2023'}

      DRG: 470 - MAJOR JOINT REPLACEMENT
      REVENUE CODE: 0110 - ROOM & BOARD
      REVENUE CODE: 0450 - EMERGENCY ROOM
      NDC: 12345-6789-01 - MEDICATION
      ICD-10: J12.82 - PNEUMONIA DUE TO COVID-19

      SERVICES:
      1. ${service.description} - ${service.amount || '$100.00'}
    `;

    const extractedCodes = extractBillingCodes(sampleText);
    
    // Determine the service setting
    const setting = await determineServiceSetting(service, extractedCodes, billContext);
    
    // Categorize the service
    const categoryResult = await categorizeWithAdvancedSystem(
      { ...service, setting },
      extractedCodes,
      billContext
    );
    
    // Return the results
    return res.status(200).json({
      setting,
      category: categoryResult.category,
      pricingModel: categoryResult.pricingModel,
      confidence: categoryResult.confidence,
      reasoning: categoryResult.reasoning,
      extractedCodes
    });
  } catch (error) {
    console.error('Error in test-classification API:', error);
    return res.status(500).json({ 
      error: 'Error processing classification',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
} 