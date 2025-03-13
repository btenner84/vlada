import { adminDb } from '../firebase/admin.js';
import { OpenAI } from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * The enhanced 7-category classification system
 */
const ENHANCED_CATEGORIES = {
  OFFICE_VISITS: 'Office Visits & Consultations',
  OUTPATIENT_PROCEDURES: 'Outpatient Procedures & Surgeries',
  INPATIENT_PROCEDURES: 'Inpatient Procedures & Surgeries',
  LAB_DIAGNOSTIC: 'Lab & Diagnostic Tests',
  DRUGS_INFUSIONS: 'Drugs & Infusions (Hospital vs. Retail)',
  MEDICAL_EQUIPMENT: 'Medical Equipment (DME) & Therapies',
  HOSPITAL_STAYS: 'Hospital Stays & Emergency Visits'
};

/**
 * Pricing models for each category
 */
const PRICING_MODELS = {
  [ENHANCED_CATEGORIES.OFFICE_VISITS]: 'PFS',
  [ENHANCED_CATEGORIES.OUTPATIENT_PROCEDURES]: 'OPPS',
  [ENHANCED_CATEGORIES.INPATIENT_PROCEDURES]: 'DRG',
  [ENHANCED_CATEGORIES.LAB_DIAGNOSTIC]: 'CLFS',
  [ENHANCED_CATEGORIES.DRUGS_INFUSIONS]: 'ASP',
  [ENHANCED_CATEGORIES.MEDICAL_EQUIPMENT]: 'DMEPOS',
  [ENHANCED_CATEGORIES.HOSPITAL_STAYS]: 'DRG'
};

/**
 * Map from old 6-category system to new 7-category system
 * @param {string} oldCategory - The old category
 * @param {string} setting - The service setting (inpatient/outpatient)
 * @returns {string} - The enhanced category
 */
function mapToEnhancedCategory(oldCategory, setting) {
  switch (oldCategory) {
    case 'Office visits and Consultations':
      return ENHANCED_CATEGORIES.OFFICE_VISITS;
      
    case 'Procedures and Surgeries':
      return setting === 'inpatient' 
        ? ENHANCED_CATEGORIES.INPATIENT_PROCEDURES 
        : ENHANCED_CATEGORIES.OUTPATIENT_PROCEDURES;
      
    case 'Lab and Diagnostic Tests':
      return ENHANCED_CATEGORIES.LAB_DIAGNOSTIC;
      
    case 'Drugs and Infusions':
      return ENHANCED_CATEGORIES.DRUGS_INFUSIONS;
      
    case 'Medical Equipment':
      return ENHANCED_CATEGORIES.MEDICAL_EQUIPMENT;
      
    case 'Hospital stays and emergency care visits':
      return ENHANCED_CATEGORIES.HOSPITAL_STAYS;
      
    default:
      return ENHANCED_CATEGORIES.OUTPATIENT_PROCEDURES; // Default fallback
  }
}

/**
 * Determine if a service is inpatient or outpatient
 * @param {Object} service - The service object
 * @param {Object} extractedCodes - Extracted billing codes
 * @param {Object} billContext - Additional context about the bill
 * @returns {Promise<string>} - 'inpatient' or 'outpatient'
 */
async function determineServiceSetting(service, extractedCodes = {}, billContext = {}) {
  console.log('[ADVANCED_CLASSIFIER] Determining service setting for:', service.description);
  
  // If setting is already specified, use it
  if (service.setting) {
    console.log(`[ADVANCED_CLASSIFIER] Using pre-specified setting: ${service.setting}`);
    return service.setting;
  }
  
  // STEP 1: Try to determine setting using OpenAI for full context analysis
  try {
    console.log('[ADVANCED_CLASSIFIER] Using OpenAI to determine service setting from full context');
    
    // Extract relevant information
    const description = service.description || '';
    const code = service.code || '';
    const codeDescription = service.codeDescription || '';
    
    // Create a prompt for OpenAI
    const prompt = `I need to determine if this medical service was provided in an inpatient or outpatient setting:
    
Service Description: "${description}"
${code ? `CPT/HCPCS/Revenue Code: ${code}` : ''}
${codeDescription ? `Code Description: "${codeDescription}"` : ''}
${extractedCodes.drgCodes?.length > 0 ? `DRG Codes: ${extractedCodes.drgCodes.map(c => c.code).join(', ')}` : ''}
${extractedCodes.revenueCodes?.length > 0 ? `Revenue Codes: ${extractedCodes.revenueCodes.map(c => c.code).join(', ')}` : ''}
${extractedCodes.ndcCodes?.length > 0 ? `NDC Codes: ${extractedCodes.ndcCodes.map(c => c.code).join(', ')}` : ''}
${extractedCodes.icd10Codes?.length > 0 ? `ICD-10 Codes: ${extractedCodes.icd10Codes.map(c => c.code).join(', ')}` : ''}
${billContext.facilityName ? `Facility Name: ${billContext.facilityName}` : ''}
${billContext.providerName ? `Provider Name: ${billContext.providerName}` : ''}
${billContext.billType ? `Bill Type: ${billContext.billType}` : ''}
${billContext.placeOfService ? `Place of Service: ${billContext.placeOfService}` : ''}

Please determine if this service was provided in an inpatient or outpatient setting.
Respond in JSON format with the following structure:
{
  "setting": "inpatient" or "outpatient",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this setting determination is appropriate"
}`;

    console.log('[ADVANCED_CLASSIFIER] Calling OpenAI API for service setting determination');
    
    // Call OpenAI API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are a medical billing expert specializing in determining if services were provided in inpatient or outpatient settings. Your task is to analyze the service description, codes, and other context to make this determination. Be precise and consider all available information.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    }, { signal: controller.signal });
    
    clearTimeout(timeoutId);
    
    // Parse the response
    const contentStr = response.choices[0]?.message?.content;
    if (!contentStr) {
      throw new Error('Empty response from OpenAI');
    }

    // Try to parse JSON with error handling
    let result;
    try {
      result = JSON.parse(contentStr);
    } catch (parseError) {
      console.error('[ADVANCED_CLASSIFIER] Failed to parse OpenAI response:', contentStr);
      throw new Error(`Failed to parse OpenAI response: ${parseError.message}`);
    }
    
    console.log('[ADVANCED_CLASSIFIER] OpenAI response for setting determination:', JSON.stringify(result, null, 2));
    
    // Validate the setting
    if (result.setting === 'inpatient' || result.setting === 'outpatient') {
      console.log(`[ADVANCED_CLASSIFIER] OpenAI determined setting as ${result.setting} with confidence ${result.confidence || 'unknown'}`);
      console.log(`[ADVANCED_CLASSIFIER] Reasoning: ${result.reasoning || 'No reasoning provided'}`);
      
      // Only use OpenAI result if confidence is high enough
      if (result.confidence >= 0.7) {
        return result.setting;
      } else {
        console.log(`[ADVANCED_CLASSIFIER] OpenAI confidence too low (${result.confidence}), falling back to code-based approach`);
      }
    } else {
      console.warn(`[ADVANCED_CLASSIFIER] OpenAI returned invalid setting: ${result.setting}`);
    }
  } catch (error) {
    console.error('[ADVANCED_CLASSIFIER] Error using OpenAI for setting determination:', error);
    console.log('[ADVANCED_CLASSIFIER] Falling back to code-based approach');
  }
  
  // STEP 2: Fall back to code-based approach if OpenAI fails or has low confidence
  
  // If DRG codes are present, it's inpatient
  if (extractedCodes?.drgCodes?.length > 0) {
    console.log('[ADVANCED_CLASSIFIER] DRG codes present, setting as inpatient');
    return 'inpatient';
  }
  
  // Check revenue codes that indicate inpatient
  const inpatientRevenueCodes = ['0100', '0101', '0110', '0111', '0112', '0113', '0114', '0116', '0117', '0118', '0119', '0120', '0121', '0122', '0123', '0124', '0125', '0126', '0127', '0128', '0129', '0130', '0131', '0132', '0133', '0134', '0135', '0136', '0137', '0138', '0139', '0140', '0141', '0142', '0143', '0144', '0145', '0146', '0147', '0148', '0149', '0150', '0151', '0152', '0153', '0154', '0155', '0156', '0157', '0158', '0159', '0160', '0164', '0167', '0169', '0200', '0201', '0202', '0203', '0204', '0206', '0207', '0208', '0209', '0210', '0211', '0212', '0213', '0214', '0219'];
  
  if (extractedCodes?.revenueCodes?.some(rc => inpatientRevenueCodes.includes(rc.code))) {
    console.log('[ADVANCED_CLASSIFIER] Inpatient revenue codes present, setting as inpatient');
    return 'inpatient';
  }
  
  // Check bill type if available (UB-04 bill types starting with 1 are inpatient)
  if (billContext?.billType) {
    if (billContext.billType.startsWith('1')) {
      console.log(`[ADVANCED_CLASSIFIER] Inpatient bill type detected: ${billContext.billType}, setting as inpatient`);
      return 'inpatient';
    } else if (billContext.billType.startsWith('7') || billContext.billType.startsWith('8')) {
      console.log(`[ADVANCED_CLASSIFIER] Outpatient bill type detected: ${billContext.billType}, setting as outpatient`);
      return 'outpatient';
    }
  }
  
  // Check place of service code if available
  if (billContext?.placeOfService) {
    const inpatientPOS = ['21', '51', '61']; // 21=Inpatient Hospital, 51=Inpatient Psych Facility, 61=Inpatient Rehab
    if (inpatientPOS.includes(billContext.placeOfService)) {
      console.log(`[ADVANCED_CLASSIFIER] Inpatient place of service detected: ${billContext.placeOfService}, setting as inpatient`);
      return 'inpatient';
    } else {
      console.log(`[ADVANCED_CLASSIFIER] Outpatient place of service detected: ${billContext.placeOfService}, setting as outpatient`);
      return 'outpatient';
    }
  }
  
  // Check for inpatient keywords in description
  const inpatientKeywords = ['inpatient', 'admitted', 'admission', 'hospital stay', 'overnight', 'room and board'];
  if (service.description && inpatientKeywords.some(keyword => service.description.toLowerCase().includes(keyword))) {
    console.log('[ADVANCED_CLASSIFIER] Inpatient keywords found in description, setting as inpatient');
    return 'inpatient';
  }
  
  // Check for outpatient keywords in description
  const outpatientKeywords = ['outpatient', 'ambulatory', 'same day', 'day surgery', 'office visit'];
  if (service.description && outpatientKeywords.some(keyword => service.description.toLowerCase().includes(keyword))) {
    console.log('[ADVANCED_CLASSIFIER] Outpatient keywords found in description, setting as outpatient');
    return 'outpatient';
  }
  
  // Default to outpatient
  console.log('[ADVANCED_CLASSIFIER] No definitive setting indicators found, defaulting to outpatient');
  return 'outpatient';
}

/**
 * Extract billing codes from text
 * @param {string} text - The extracted text
 * @returns {Object} - Object containing extracted billing codes
 */
function extractBillingCodes(text) {
  console.log('[ADVANCED_CLASSIFIER] Extracting billing codes from text');
  
  const result = {
    drgCodes: [],
    revenueCodes: [],
    ndcCodes: [],
    icd10Codes: []
  };
  
  if (!text) {
    console.log('[ADVANCED_CLASSIFIER] No text provided for code extraction');
    return result;
  }
  
  // Extract DRG codes
  const drgPattern = /(?:DRG|MS-DRG|DIAGNOSIS RELATED GROUP)\s*:?\s*(\d{3})/gi;
  let match;
  while ((match = drgPattern.exec(text)) !== null) {
    result.drgCodes.push({
      code: match[1],
      source: 'text_extraction'
    });
  }
  
  // Extract Revenue codes
  const revPattern = /(?:REV|REVENUE CODE|RC)\s*:?\s*(\d{3,4})/gi;
  while ((match = revPattern.exec(text)) !== null) {
    result.revenueCodes.push({
      code: match[1],
      source: 'text_extraction'
    });
  }
  
  // Extract NDC codes
  const ndcPattern = /(?:NDC|NATIONAL DRUG CODE)\s*:?\s*(\d{5}-\d{4}-\d{2}|\d{11})/gi;
  while ((match = ndcPattern.exec(text)) !== null) {
    result.ndcCodes.push({
      code: match[1],
      source: 'text_extraction'
    });
  }
  
  // Extract ICD-10 codes
  const icdPattern = /(?:ICD|DX|DIAG|DIAGNOSIS)\s*:?\s*([A-Z]\d{2}(?:\.\d{1,2})?)/gi;
  while ((match = icdPattern.exec(text)) !== null) {
    result.icd10Codes.push({
      code: match[1],
      source: 'text_extraction'
    });
  }
  
  console.log('[ADVANCED_CLASSIFIER] Extracted codes:', {
    drgCodes: result.drgCodes.length,
    revenueCodes: result.revenueCodes.length,
    ndcCodes: result.ndcCodes.length,
    icd10Codes: result.icd10Codes.length
  });
  
  return result;
}

/**
 * Enhance a service object with advanced classification fields
 * @param {Object} service - The original service object
 * @returns {Object} - Enhanced service object
 */
function enhanceServiceStructure(service) {
  console.log('[ADVANCED_CLASSIFIER] Enhancing service structure for:', service.description);
  
  // If service already has the enhanced structure, return it
  if (service.setting && service.billingCodes && service.pricingModel) {
    return service;
  }
  
  return {
    ...service,
    // Add new fields for advanced classification
    setting: service.setting || null, // 'inpatient' or 'outpatient'
    billingCodes: service.billingCodes || {
      drgCodes: [],
      revenueCodes: [],
      ndcCodes: [],
      icd10Codes: []
    },
    pricingModel: service.pricingModel || null, // 'PFS', 'OPPS', 'DRG', 'CLFS', 'ASP', etc.
    enhancedCategory: service.enhancedCategory || null // Will store the new 7-category classification
  };
}

/**
 * Categorize a service using the advanced 7-category system
 * @param {Object} service - The service to categorize
 * @param {Object} extractedCodes - Extracted billing codes
 * @param {Object} billContext - Additional context about the bill
 * @returns {Promise<Object>} - The categorization result
 */
async function categorizeWithAdvancedSystem(service, extractedCodes = {}, billContext = {}) {
  console.log('[ADVANCED_CLASSIFIER] Starting advanced categorization for:', service.description);
  
  // If service already has an enhanced category, use it
  if (service.enhancedCategory) {
    console.log('[ADVANCED_CLASSIFIER] Service already has enhanced category:', service.enhancedCategory);
    return {
      category: service.enhancedCategory,
      reasoning: service.categoryReasoning || "Category already determined",
      pricingModel: service.pricingModel || PRICING_MODELS[service.enhancedCategory] || 'PFS'
    };
  }
  
  // Determine service setting if not already set
  const setting = service.setting || await determineServiceSetting(service, extractedCodes, billContext);
  console.log('[ADVANCED_CLASSIFIER] Service setting:', setting);
  
  // STEP 1: Try to get a code-based classification first (for later comparison)
  let codeBasedCategory = null;
  let codeBasedReasoning = null;
  
  // If service has a code, try to determine category from it
  if (service.code) {
    console.log(`[ADVANCED_CLASSIFIER] Attempting code-based classification with code: ${service.code}`);
    codeBasedCategory = getCategoryFromCode(service.code, setting);
    
    if (codeBasedCategory) {
      codeBasedReasoning = `Determined from billing code: ${service.code}`;
      console.log(`[ADVANCED_CLASSIFIER] Code-based classification result: ${codeBasedCategory}`);
    } else {
      console.log(`[ADVANCED_CLASSIFIER] Could not determine category from code: ${service.code}`);
    }
  }
  
  // If service has an old category, map it as a fallback
  let mappedCategory = null;
  if (service.category) {
    mappedCategory = mapToEnhancedCategory(service.category, setting);
    console.log('[ADVANCED_CLASSIFIER] Mapped from old category:', service.category, 'to', mappedCategory);
  }
  
  // STEP 2: Use OpenAI for primary classification
  let aiResult = null;
  try {
    console.log('[ADVANCED_CLASSIFIER] Using OpenAI as primary classification method');
    aiResult = await categorizeWithOpenAI(service, extractedCodes, setting, billContext);
    console.log(`[ADVANCED_CLASSIFIER] OpenAI classification result: ${aiResult.category} with confidence ${aiResult.confidence || 'unknown'}`);
  } catch (error) {
    console.error('[ADVANCED_CLASSIFIER] Error in OpenAI categorization:', error);
    // If OpenAI fails, we'll fall back to code-based or mapped category
  }
  
  // STEP 3: Determine final category based on confidence and available classifications
  
  // If we have a high-confidence AI result (>0.8), use it regardless of code match
  if (aiResult && aiResult.confidence >= 0.8) {
    console.log(`[ADVANCED_CLASSIFIER] Using high-confidence OpenAI result: ${aiResult.category}`);
    
    // If we also have a code-based category that differs, note this in the reasoning
    if (codeBasedCategory && codeBasedCategory !== aiResult.category) {
      aiResult.reasoning += ` (Note: Code ${service.code} suggests category "${codeBasedCategory}" but overridden due to high confidence in description-based classification)`;
      console.log(`[ADVANCED_CLASSIFIER] Overriding code-based category due to high AI confidence`);
    }
    
    return {
      category: aiResult.category,
      reasoning: aiResult.reasoning,
      confidence: aiResult.confidence,
      pricingModel: aiResult.pricingModel || PRICING_MODELS[aiResult.category] || 'PFS'
    };
  }
  
  // If we have a medium-confidence AI result (0.6-0.8) and it matches code-based category, use it
  if (aiResult && aiResult.confidence >= 0.6 && codeBasedCategory && codeBasedCategory === aiResult.category) {
    console.log(`[ADVANCED_CLASSIFIER] Using medium-confidence OpenAI result that matches code-based category: ${aiResult.category}`);
    
    return {
      category: aiResult.category,
      reasoning: `${aiResult.reasoning} (Confirmed by code ${service.code})`,
      confidence: Math.min(0.9, aiResult.confidence + 0.1), // Boost confidence due to code match
      pricingModel: aiResult.pricingModel || PRICING_MODELS[aiResult.category] || 'PFS'
    };
  }
  
  // If we have a code-based category and either no AI result or low-confidence AI result, use code-based
  if (codeBasedCategory && (!aiResult || aiResult.confidence < 0.6)) {
    console.log(`[ADVANCED_CLASSIFIER] Using code-based category: ${codeBasedCategory}`);
    
    return {
      category: codeBasedCategory,
      reasoning: codeBasedReasoning,
      confidence: 0.85, // High confidence for code-based classification
      pricingModel: PRICING_MODELS[codeBasedCategory] || 'PFS'
    };
  }
  
  // If we have a medium-confidence AI result but no code match, use AI result
  if (aiResult && aiResult.confidence >= 0.6) {
    console.log(`[ADVANCED_CLASSIFIER] Using medium-confidence OpenAI result: ${aiResult.category}`);
    
    return {
      category: aiResult.category,
      reasoning: aiResult.reasoning,
      confidence: aiResult.confidence,
      pricingModel: aiResult.pricingModel || PRICING_MODELS[aiResult.category] || 'PFS'
    };
  }
  
  // If we have a mapped category from old system, use it as fallback
  if (mappedCategory) {
    console.log(`[ADVANCED_CLASSIFIER] Using mapped category as fallback: ${mappedCategory}`);
    
    return {
      category: mappedCategory,
      reasoning: `Mapped from original category: ${service.category}`,
      confidence: 0.7, // Moderate confidence for mapped categories
      pricingModel: PRICING_MODELS[mappedCategory] || 'PFS'
    };
  }
  
  // If we have a low-confidence AI result, use it as last resort before fallback
  if (aiResult) {
    console.log(`[ADVANCED_CLASSIFIER] Using low-confidence OpenAI result as last resort: ${aiResult.category}`);
    
    return {
      category: aiResult.category,
      reasoning: `${aiResult.reasoning} (Low confidence classification)`,
      confidence: aiResult.confidence,
      pricingModel: aiResult.pricingModel || PRICING_MODELS[aiResult.category] || 'PFS'
    };
  }
  
  // Final fallback to keyword-based classification
  console.log('[ADVANCED_CLASSIFIER] All classification methods failed, using fallback categorization');
  const fallbackResult = fallbackAdvancedCategorization(service, extractedCodes, setting);
  
  return {
    ...fallbackResult,
    confidence: 0.5, // Low confidence for fallback
  };
}

/**
 * Determine category based on billing code patterns
 * @param {string} code - The billing code
 * @param {string} setting - The service setting (inpatient/outpatient)
 * @returns {string|null} - The category or null if not determinable
 */
function getCategoryFromCode(code, setting) {
  if (!code) return null;
  
  // Normalize the code
  code = code.trim().toUpperCase();
  
  // E&M codes (99201-99499)
  if (/^99\d{3}$/.test(code)) {
    // ER codes (99281-99288)
    if (/^992[8][1-8]$/.test(code)) {
      return ENHANCED_CATEGORIES.HOSPITAL_STAYS;
    }
    
    // Hospital admission codes (99221-99239)
    if (/^992[2-3]\d$/.test(code)) {
      return ENHANCED_CATEGORIES.HOSPITAL_STAYS;
    }
    
    // Other E&M codes are typically office visits
    return ENHANCED_CATEGORIES.OFFICE_VISITS;
  }
  
  // Surgery codes (10000-69999)
  if (/^[1-6]\d{4}$/.test(code)) {
    return setting === 'inpatient' 
      ? ENHANCED_CATEGORIES.INPATIENT_PROCEDURES 
      : ENHANCED_CATEGORIES.OUTPATIENT_PROCEDURES;
  }
  
  // Lab codes (80000-89999)
  if (/^8\d{4}$/.test(code)) {
    return ENHANCED_CATEGORIES.LAB_DIAGNOSTIC;
  }
  
  // Radiology codes (70000-79999)
  if (/^7\d{4}$/.test(code)) {
    return ENHANCED_CATEGORIES.LAB_DIAGNOSTIC;
  }
  
  // J codes for drugs
  if (/^J\d{4}$/.test(code)) {
    return ENHANCED_CATEGORIES.DRUGS_INFUSIONS;
  }
  
  // E, K, or L codes for equipment
  if (/^[EKL]\d{4}$/.test(code)) {
    return ENHANCED_CATEGORIES.MEDICAL_EQUIPMENT;
  }
  
  // Revenue codes
  if (/^\d{4}$/.test(code)) {
    // Room revenue codes (01xx)
    if (/^01\d{2}$/.test(code)) {
      return ENHANCED_CATEGORIES.HOSPITAL_STAYS;
    }
    
    // ER revenue codes (045x)
    if (/^045\d$/.test(code)) {
      return ENHANCED_CATEGORIES.HOSPITAL_STAYS;
    }
    
    // Pharmacy revenue codes (025x, 026x, 063x)
    if (/^0(25|26|63)\d$/.test(code)) {
      return ENHANCED_CATEGORIES.DRUGS_INFUSIONS;
    }
    
    // Lab revenue codes (030x, 031x)
    if (/^03[01]\d$/.test(code)) {
      return ENHANCED_CATEGORIES.LAB_DIAGNOSTIC;
    }
    
    // Medical equipment revenue codes (027x, 029x)
    if (/^02[79]\d$/.test(code)) {
      return ENHANCED_CATEGORIES.MEDICAL_EQUIPMENT;
    }
    
    // Surgery revenue codes (036x, 071x)
    if (/^0(36|71)\d$/.test(code)) {
      return setting === 'inpatient' 
        ? ENHANCED_CATEGORIES.INPATIENT_PROCEDURES 
        : ENHANCED_CATEGORIES.OUTPATIENT_PROCEDURES;
    }
  }
  
  // DRG codes (typically 3 digits)
  if (/^\d{3}$/.test(code)) {
    // DRG codes are always inpatient
    return ENHANCED_CATEGORIES.INPATIENT_PROCEDURES;
  }
  
  // Could not determine category from code
  return null;
}

/**
 * Categorize a service using OpenAI with the advanced system
 * @param {Object} service - The service to categorize
 * @param {Object} extractedCodes - Extracted billing codes
 * @param {string} setting - The service setting (inpatient/outpatient)
 * @param {Object} billContext - Additional context about the bill
 * @returns {Promise<Object>} - The categorization result
 */
async function categorizeWithOpenAI(service, extractedCodes, setting, billContext = {}) {
  console.log('[ADVANCED_CLASSIFIER] Using OpenAI for advanced categorization');
  
  const MAX_RETRIES = 3;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < MAX_RETRIES) {
    try {
      console.log(`[ADVANCED_CLASSIFIER] OpenAI categorization attempt ${retryCount + 1}/${MAX_RETRIES}`);
      
      // Extract relevant information
      const description = service.description || '';
      const codeDescription = service.codeDescription || '';
      const code = service.code || '';
      
      // Create a prompt for OpenAI
      const prompt = `I need to categorize this medical service into one of seven predefined categories:
      
Service Description: "${description}"
${code ? `CPT/HCPCS Code: ${code}` : ''}
${codeDescription ? `Code Description: "${codeDescription}"` : ''}
Service Setting: ${setting}
${extractedCodes.drgCodes?.length > 0 ? `DRG Codes: ${extractedCodes.drgCodes.map(c => c.code).join(', ')}` : ''}
${extractedCodes.revenueCodes?.length > 0 ? `Revenue Codes: ${extractedCodes.revenueCodes.map(c => c.code).join(', ')}` : ''}
${extractedCodes.ndcCodes?.length > 0 ? `NDC Codes: ${extractedCodes.ndcCodes.map(c => c.code).join(', ')}` : ''}
${extractedCodes.icd10Codes?.length > 0 ? `ICD-10 Codes: ${extractedCodes.icd10Codes.map(c => c.code).join(', ')}` : ''}
${billContext.facilityName ? `Facility Name: ${billContext.facilityName}` : ''}
${billContext.providerName ? `Provider Name: ${billContext.providerName}` : ''}
${billContext.billType ? `Bill Type: ${billContext.billType}` : ''}
${billContext.placeOfService ? `Place of Service: ${billContext.placeOfService}` : ''}
${billContext.patientType ? `Patient Type: ${billContext.patientType}` : ''}
${billContext.serviceDate ? `Service Date: ${billContext.serviceDate}` : ''}

The seven categories are:
1. Office Visits & Consultations - CPT (99xxx), HCPCS, Revenue Codes (051X, 052X)
2. Outpatient Procedures & Surgeries - CPT (10xxx-69xxx), APCs, HCPCS
3. Inpatient Procedures & Surgeries - DRG Codes, Revenue Codes (036X, 045X)
4. Lab & Diagnostic Tests - CPT (80xxx-89xxx), CLFS, OPPS
5. Drugs & Infusions (Hospital vs. Retail) - HCPCS J-Codes, NDC, Revenue Codes (025X, 063X)
6. Medical Equipment (DME) & Therapies - HCPCS Level II (E, L, K Series), Revenue Codes (027X, 294X)
7. Hospital Stays & Emergency Visits - MS-DRG, Revenue Codes (010X, 045X), CPT (ER 99281-99285)

Please categorize this service into one of these seven categories. Respond in JSON format with the following structure:
{
  "category": "Category Name",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this category is appropriate",
  "pricingModel": "Appropriate pricing model (PFS, OPPS, DRG, CLFS, ASP, DMEPOS)"
}`;

      console.log('[ADVANCED_CLASSIFIER] Calling OpenAI API for service categorization');
      
      // Call OpenAI API with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
        messages: [
          { 
            role: 'system', 
            content: 'You are a medical billing expert specializing in categorizing medical services. Your task is to categorize services into one of seven predefined categories using the advanced classification system. Be precise and consider the service description, codes, setting, and all other contextual information provided.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      }, { signal: controller.signal });
      
      clearTimeout(timeoutId);
      
      // Parse the response
      const contentStr = response.choices[0]?.message?.content;
      if (!contentStr) {
        throw new Error('Empty response from OpenAI');
      }

      // Try to parse JSON with error handling
      let result;
      try {
        result = JSON.parse(contentStr);
      } catch (parseError) {
        console.error('[ADVANCED_CLASSIFIER] Failed to parse OpenAI response:', contentStr);
        throw new Error(`Failed to parse OpenAI response: ${parseError.message}`);
      }
      
      console.log('[ADVANCED_CLASSIFIER] OpenAI response:', JSON.stringify(result, null, 2));
      
      // Validate the category
      const validCategories = Object.values(ENHANCED_CATEGORIES);
      
      if (!validCategories.includes(result.category)) {
        console.warn('[ADVANCED_CLASSIFIER] OpenAI returned invalid category:', result.category);
        // Try to map to the closest category
        for (const validCategory of validCategories) {
          if (result.category.toLowerCase().includes(validCategory.toLowerCase())) {
            console.log(`[ADVANCED_CLASSIFIER] Mapped invalid category "${result.category}" to "${validCategory}"`);
            return { 
              category: validCategory, 
              reasoning: result.reasoning || `Mapped from "${result.category}"`,
              confidence: result.confidence || 0.7, // Default confidence if not provided
              pricingModel: result.pricingModel || PRICING_MODELS[validCategory] || 'PFS'
            };
          }
        }
        throw new Error(`Invalid category: ${result.category}`);
      }
      
      // Ensure we have a pricing model
      if (!result.pricingModel) {
        result.pricingModel = PRICING_MODELS[result.category] || 'PFS';
      }
      
      // Ensure we have a confidence score
      if (result.confidence === undefined || result.confidence === null) {
        result.confidence = 0.8; // Default high confidence if not provided
        console.log(`[ADVANCED_CLASSIFIER] No confidence score provided, using default: ${result.confidence}`);
      }
      
      console.log(`[ADVANCED_CLASSIFIER] Categorized as "${result.category}" with confidence ${result.confidence}`);
      return { 
        category: result.category, 
        reasoning: result.reasoning,
        confidence: result.confidence,
        pricingModel: result.pricingModel
      };
    } catch (error) {
      lastError = error;
      console.error(`[ADVANCED_CLASSIFIER] Error categorizing service with OpenAI (Attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
      
      // Implement exponential backoff
      const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 8000); // Max 8 second backoff
      console.log(`[ADVANCED_CLASSIFIER] Retrying in ${backoffTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffTime));
      
      retryCount++;
    }
  }

  // After all retries failed, use a fallback method
  console.error(`[ADVANCED_CLASSIFIER] All ${MAX_RETRIES} attempts failed. Last error:`, lastError);
  throw new Error(`Failed to categorize with OpenAI after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

/**
 * Fallback categorization using keyword matching when OpenAI fails
 * @param {Object} service - The service to categorize
 * @param {Object} extractedCodes - Extracted billing codes
 * @param {string} setting - The service setting (inpatient/outpatient)
 * @returns {Object} - The categorization result
 */
function fallbackAdvancedCategorization(service, extractedCodes, setting) {
  console.log('[ADVANCED_CLASSIFIER] Using fallback categorization');
  
  const description = (service.description || '').toLowerCase();
  
  // Define category keywords for the advanced system
  const categoryKeywords = {
    [ENHANCED_CATEGORIES.OFFICE_VISITS]: ['office visit', 'consult', 'evaluation', 'exam', 'check-up', 'checkup'],
    [ENHANCED_CATEGORIES.OUTPATIENT_PROCEDURES]: ['outpatient', 'procedure', 'surgery', 'biopsy', 'repair', 'implant', 'removal'],
    [ENHANCED_CATEGORIES.INPATIENT_PROCEDURES]: ['inpatient procedure', 'inpatient surgery'],
    [ENHANCED_CATEGORIES.LAB_DIAGNOSTIC]: ['lab', 'test', 'blood', 'urine', 'specimen', 'diagnostic', 'x-ray', 'scan', 'mri', 'ct'],
    [ENHANCED_CATEGORIES.DRUGS_INFUSIONS]: ['drug', 'medication', 'injection', 'infusion', 'iv', 'vaccine', 'ondansetron', 'promethazine', 'famotidine'],
    [ENHANCED_CATEGORIES.MEDICAL_EQUIPMENT]: ['equipment', 'supply', 'device', 'prosthetic', 'orthotic', 'brace'],
    [ENHANCED_CATEGORIES.HOSPITAL_STAYS]: ['emergency', 'er', 'hospital', 'inpatient', 'room', 'admission']
  };
  
  // Check each category for matching keywords
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (description.includes(keyword)) {
        console.log(`[ADVANCED_CLASSIFIER] Matched service to "${category}" based on keyword "${keyword}"`);
        return {
          category,
          reasoning: `Fallback categorization based on keyword match: "${keyword}"`,
          confidence: 0.65, // Moderate confidence for keyword matches
          pricingModel: PRICING_MODELS[category] || 'PFS'
        };
      }
    }
  }
  
  // Check for DRG codes (indicates inpatient)
  if (extractedCodes.drgCodes?.length > 0) {
    return {
      category: ENHANCED_CATEGORIES.INPATIENT_PROCEDURES,
      reasoning: 'Fallback categorization based on presence of DRG codes',
      confidence: 0.8, // High confidence for DRG-based classification
      pricingModel: 'DRG'
    };
  }
  
  // Check for revenue codes
  if (extractedCodes.revenueCodes?.length > 0) {
    const revCode = extractedCodes.revenueCodes[0].code;
    
    // Lab revenue codes
    if (revCode.startsWith('030') || revCode.startsWith('031')) {
      return {
        category: ENHANCED_CATEGORIES.LAB_DIAGNOSTIC,
        reasoning: `Fallback categorization based on lab revenue code: ${revCode}`,
        confidence: 0.75, // Good confidence for revenue code matches
        pricingModel: 'CLFS'
      };
    }
    
    // Pharmacy revenue codes
    if (revCode.startsWith('025') || revCode.startsWith('026')) {
      return {
        category: ENHANCED_CATEGORIES.DRUGS_INFUSIONS,
        reasoning: `Fallback categorization based on pharmacy revenue code: ${revCode}`,
        confidence: 0.75, // Good confidence for revenue code matches
        pricingModel: 'ASP'
      };
    }
    
    // Room revenue codes
    if (revCode.startsWith('01')) {
      return {
        category: ENHANCED_CATEGORIES.HOSPITAL_STAYS,
        reasoning: `Fallback categorization based on room revenue code: ${revCode}`,
        confidence: 0.75, // Good confidence for revenue code matches
        pricingModel: 'DRG'
      };
    }
  }
  
  // Check CPT code patterns
  const code = (service.code || '').trim();
  
  // Lab codes (80000-89999)
  if (/^8\d{4}$/.test(code)) {
    return {
      category: ENHANCED_CATEGORIES.LAB_DIAGNOSTIC,
      reasoning: 'Fallback categorization based on CPT code pattern for lab tests',
      confidence: 0.8, // High confidence for code pattern matches
      pricingModel: 'CLFS'
    };
  }
  
  // E&M codes (99201-99499)
  if (/^99\d{3}$/.test(code)) {
    // ER codes (99281-99288)
    if (/^992[8][1-8]$/.test(code)) {
      return {
        category: ENHANCED_CATEGORIES.HOSPITAL_STAYS,
        reasoning: 'Fallback categorization based on CPT code pattern for ER visits',
        confidence: 0.8, // High confidence for code pattern matches
        pricingModel: 'OPPS'
      };
    }
    
    return {
      category: ENHANCED_CATEGORIES.OFFICE_VISITS,
      reasoning: 'Fallback categorization based on CPT code pattern for office visits',
      confidence: 0.8, // High confidence for code pattern matches
      pricingModel: 'PFS'
    };
  }
  
  // Surgery codes (10000-69999)
  if (/^[1-6]\d{4}$/.test(code)) {
    return {
      category: setting === 'inpatient' 
        ? ENHANCED_CATEGORIES.INPATIENT_PROCEDURES 
        : ENHANCED_CATEGORIES.OUTPATIENT_PROCEDURES,
      reasoning: 'Fallback categorization based on CPT code pattern for procedures',
      confidence: 0.8, // High confidence for code pattern matches
      pricingModel: setting === 'inpatient' ? 'DRG' : 'OPPS'
    };
  }
  
  // J codes for drugs
  if (/^J\d{4}$/.test(code)) {
    return {
      category: ENHANCED_CATEGORIES.DRUGS_INFUSIONS,
      reasoning: 'Fallback categorization based on HCPCS J-code pattern',
      confidence: 0.8, // High confidence for code pattern matches
      pricingModel: 'ASP'
    };
  }
  
  // E or K codes for equipment
  if (/^[EK]\d{4}$/.test(code)) {
    return {
      category: ENHANCED_CATEGORIES.MEDICAL_EQUIPMENT,
      reasoning: 'Fallback categorization based on HCPCS E/K-code pattern',
      confidence: 0.8, // High confidence for code pattern matches
      pricingModel: 'DMEPOS'
    };
  }
  
  // Default based on setting
  if (setting === 'inpatient') {
    return {
      category: ENHANCED_CATEGORIES.INPATIENT_PROCEDURES,
      reasoning: 'Default fallback categorization based on inpatient setting',
      confidence: 0.6, // Moderate confidence for setting-based defaults
      pricingModel: 'DRG'
    };
  }
  
  // Final default
  return { 
    category: ENHANCED_CATEGORIES.OUTPATIENT_PROCEDURES, 
    reasoning: 'Default fallback categorization when no other criteria match',
    confidence: 0.5, // Low confidence for last-resort defaults
    pricingModel: 'OPPS'
  };
}

/**
 * Look up a DRG code
 * @param {string} drgCode - The DRG code to look up
 * @returns {Promise<Object|null>} - The DRG code information or null if not found
 */
async function lookupDRGCode(drgCode) {
  try {
    console.log(`[ADVANCED_CLASSIFIER] Looking up DRG code: ${drgCode}`);
    
    // Try to find in Firestore
    const docRef = await adminDb.collection('drgCodes').doc(drgCode).get();
    
    if (docRef.exists) {
      const data = docRef.data();
      console.log('[ADVANCED_CLASSIFIER] Found DRG code in database:', data);
      
      return {
        code: data.code,
        description: data.description,
        rate: data.rate,
        averageLength: data.averageLength,
        relativeWeight: data.relativeWeight
      };
    }
    
    // If not in database, use some common DRG codes
    const commonDRGCodes = {
      '470': {
        code: '470',
        description: 'Major Joint Replacement or Reattachment of Lower Extremity w/o MCC',
        rate: 12000,
        averageLength: 2.4,
        relativeWeight: 2.0235
      },
      '291': {
        code: '291',
        description: 'Heart Failure and Shock with MCC',
        rate: 9500,
        averageLength: 4.8,
        relativeWeight: 1.7522
      },
      '392': {
        code: '392',
        description: 'Esophagitis, Gastroenteritis and Misc Digestive Disorders w/o MCC',
        rate: 5800,
        averageLength: 2.7,
        relativeWeight: 0.7798
      }
    };
    
    if (commonDRGCodes[drgCode]) {
      console.log('[ADVANCED_CLASSIFIER] Found DRG code in common codes:', commonDRGCodes[drgCode]);
      return commonDRGCodes[drgCode];
    }
    
    console.log(`[ADVANCED_CLASSIFIER] DRG code ${drgCode} not found`);
    return null;
  } catch (error) {
    console.error('[ADVANCED_CLASSIFIER] Error looking up DRG code:', error);
    return null;
  }
}

// Export functions using ES module exports
export {
  ENHANCED_CATEGORIES,
  PRICING_MODELS,
  mapToEnhancedCategory,
  determineServiceSetting,
  extractBillingCodes,
  enhanceServiceStructure,
  categorizeWithAdvancedSystem,
  categorizeWithOpenAI,
  lookupDRGCode,
  getCategoryFromCode
}; 