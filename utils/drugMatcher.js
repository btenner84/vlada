import xlsx from 'xlsx';
import path from 'path';
import { OpenAI } from 'openai';
import { adminDb } from '../firebase/admin.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize ASP pricing data
const commonDrugCodes = {
  'J2405': { code: 'J2405', description: 'Ondansetron HCL 4mg injection', dosage: '4 MG', price: 0.32 },
  'J2550': { code: 'J2550', description: 'Promethazine HCL 50mg injection', dosage: '50 MG', price: 2.50 },
  'J2780': { code: 'J2780', description: 'Famotidine 20mg injection', dosage: '20 MG', price: 0.85 },
  '96374': { code: '96374', description: 'IV push, single or initial substance/drug', dosage: null, price: 35.50 },
  '96375': { code: '96375', description: 'IV push, each additional substance/drug', dosage: null, price: 18.75 }
};

// Load ASP pricing data
function loadASPPricingData() {
  const aspPricingMap = new Map();
  const drugNameMap = new Map();

  // Add common drug codes to the maps
  Object.values(commonDrugCodes).forEach(drug => {
    aspPricingMap.set(drug.code, drug);
    drugNameMap.set(drug.description.toLowerCase(), drug);
  });

  return { aspPricingMap, drugNameMap };
}

// Initialize ASP pricing data
const { aspPricingMap, drugNameMap } = loadASPPricingData();

// Common drug name variations
const drugNameVariations = {
  'ondansetron': ['zofran', 'ondansetron hcl', 'ondansetron hydrochloride'],
  'promethazine': ['phenergan', 'promethazine hcl', 'promethazine hydrochloride'],
  'famotidine': ['pepcid', 'famotidine injection'],
  'methylprednisolone': ['solu-medrol', 'depo-medrol', 'medrol'],
  'dexamethasone': ['decadron', 'dexamethasone sodium phosphate'],
  'ketorolac': ['toradol', 'ketorolac tromethamine'],
  'diphenhydramine': ['benadryl', 'diphenhydramine hcl'],
  'metoclopramide': ['reglan', 'metoclopramide hcl'],
};

/**
 * Look up a drug code in the database
 * @param {string} code - The drug code to look up
 * @returns {Promise<Object|null>} - The drug information or null if not found
 */
async function lookupDrugCode(code) {
  try {
    console.log('[DRUG_MATCHER] Looking up drug code:', code);
    
    // Check common drug codes first
    if (commonDrugCodes[code]) {
      const data = commonDrugCodes[code];
      console.log('[DRUG_MATCHER] Found common drug code:', code, data);
      return data;
    }
    
    // Try to find in Firestore if available
    try {
      if (adminDb && adminDb.firestore) {
        const docRef = await adminDb.firestore().collection('drugCodes').doc(code).get();
        
        if (docRef.exists) {
          const data = docRef.data();
          console.log('[DRUG_MATCHER] Found drug data in Firestore:', data);
          return data;
        }
      }
    } catch (firestoreError) {
      console.error('[DRUG_MATCHER] Firestore error, using local data only:', firestoreError.message);
    }
    
    console.log('[DRUG_MATCHER] No drug code found for:', code);
    return null;
  } catch (error) {
    console.error('[DRUG_MATCHER] Error looking up drug code:', error);
    return null;
  }
}

/**
 * Find an exact match in the drug database
 * @param {string} serviceDescription - The service description
 * @returns {Object|null} - The matched drug information or null
 */
async function findExactDrugMatch(serviceDescription) {
  try {
    const normalizedDesc = serviceDescription.toLowerCase().trim();
    
    // Check drug name map
    const drugMatch = drugNameMap.get(normalizedDesc);
    if (drugMatch) {
      console.log('[DRUG_MATCHER] Found exact name match:', drugMatch);
      return {
        code: drugMatch.code,
        description: drugMatch.description,
        dosage: drugMatch.dosage,
        price: drugMatch.price,
        confidence: 1.0,
        reasoning: 'Exact match by drug name'
      };
    }
    
    return null;
  } catch (error) {
    console.error('[DRUG_MATCHER] Error finding exact match:', error);
    return null;
  }
}

/**
 * Calculate match score between service description and drug descriptions
 * @param {string} serviceDesc - The service description
 * @param {string} drugDesc - The drug description
 * @returns {number} - Match score between 0 and 1
 */
function calculateDrugMatchScore(serviceDesc, drugDesc) {
  const normalizedService = serviceDesc.toLowerCase();
  const normalizedDrug = drugDesc.toLowerCase();
  
  // Check for exact matches
  if (normalizedDrug === normalizedService) return 1.0;
  if (normalizedDrug.includes(normalizedService)) return 0.95;
  if (normalizedService.includes(normalizedDrug)) return 0.9;
  
  // Calculate word overlap score
  const serviceWords = new Set(normalizedService.split(' '));
  const drugWords = new Set(normalizedDrug.split(' '));
  
  const intersection = new Set([...serviceWords].filter(word => drugWords.has(word)));
  const union = new Set([...serviceWords, ...drugWords]);
  
  return intersection.size / union.size;
}

/**
 * Parse dosage from a string
 * @param {string} str - String containing dosage information
 * @returns {Object} - Parsed dosage information
 */
function parseDosage(str) {
  try {
    const normalized = str.toLowerCase();
    const dosageMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|unit|u)/);
    
    if (dosageMatch) {
      return {
        value: parseFloat(dosageMatch[1]),
        unit: dosageMatch[2],
        original: dosageMatch[0]
      };
    }
    
    return null;
  } catch (error) {
    console.error('[DRUG_MATCHER] Error parsing dosage:', error);
    return null;
  }
}

/**
 * Compare two dosages for equivalence
 * @param {Object} dosage1 - First dosage
 * @param {Object} dosage2 - Second dosage
 * @returns {boolean} - Whether dosages are equivalent
 */
function compareDosages(dosage1, dosage2) {
  if (!dosage1 || !dosage2) return false;
  
  // Convert units to mg for comparison
  function convertToMg(value, unit) {
    switch(unit) {
      case 'g': return value * 1000;
      case 'mcg': return value / 1000;
      case 'mg': return value;
      default: return value;
    }
  }
  
  const value1 = convertToMg(dosage1.value, dosage1.unit);
  const value2 = convertToMg(dosage2.value, dosage2.unit);
  
  // Allow for some flexibility in matching (within 10%)
  const ratio = Math.max(value1, value2) / Math.min(value1, value2);
  return ratio <= 1.1;
}

/**
 * Calculate adjusted price based on dosage ratio
 * @param {Object} serviceDosage - Parsed service dosage
 * @param {Object} drugDosage - Parsed drug dosage
 * @param {number} basePrice - Original drug price
 * @returns {number} - Adjusted price
 */
function calculateAdjustedPrice(serviceDosage, drugDosage, basePrice) {
  if (!serviceDosage || !drugDosage) return basePrice;

  // Convert both to mg for comparison
  function convertToMg(value, unit) {
    switch(unit) {
      case 'g': return value * 1000;
      case 'mcg': return value / 1000;
      case 'mg': return value;
      default: return value;
    }
  }

  const serviceValueMg = convertToMg(serviceDosage.value, serviceDosage.unit);
  const drugValueMg = convertToMg(drugDosage.value, drugDosage.unit);
  
  return (serviceValueMg / drugValueMg) * basePrice;
}

/**
 * Match a service to a drug using OpenAI
 * @param {Object} service - The service to match
 * @param {Object} aspData - ASP pricing data for context
 * @returns {Promise<Object|null>} - The matched drug information
 */
async function matchDrugWithOpenAI(service, aspData = null) {
  try {
    console.log('[DRUG_MATCHER_AI] Starting OpenAI drug matching for:', service.description);
    
    const prompt = `I need to match this medical service to a drug in our ASP pricing database:

Service Description: "${service.description}"
${service.code ? `Service Code: ${service.code}` : ''}
${service.codeDescription ? `Code Description: "${service.codeDescription}"` : ''}

${aspData ? `Potential Match Found:
- Code: ${aspData.code}
- Description: ${aspData.description}
- Dosage: ${aspData.dosage}
- Price: ${aspData.price}` : 'No direct match found in database.'}

Please analyze the service description and determine if it matches a drug. Consider:
1. Generic and brand names
2. Drug class and therapeutic category
3. Dosage forms and strengths
4. Administration methods
5. Common variations in drug names

Focus on J-codes (J0000-J9999) for injectable/infusible drugs.

Respond in JSON format:
{
  "isMatch": true/false,
  "confidence": 0.95,
  "reasoning": "Brief explanation of the match or why no match was found",
  "suggestedCode": "J1234",
  "suggestedDescription": "Drug name with strength/form"
}`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a pharmaceutical billing expert specializing in matching medical services to drugs in the ASP pricing database. Focus on accuracy and consider both generic and brand names.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log('[DRUG_MATCHER_AI] OpenAI response:', result);

    if (result.isMatch && result.suggestedCode) {
      // Verify the suggested code exists in our database
      const verifiedData = await lookupDrugCode(result.suggestedCode);
      if (verifiedData) {
        return {
          ...verifiedData,
          confidence: result.confidence,
          reasoning: result.reasoning
        };
      }
    }

    return null;
  } catch (error) {
    console.error('[DRUG_MATCHER_AI] Error matching with OpenAI:', error);
    return null;
  }
}

/**
 * Verify an AI-generated match against the database
 * @param {string} drugCode - The drug code to verify
 * @param {string} serviceDescription - The original service description
 * @returns {Promise<Object|null>} - The verified match or null
 */
async function verifyDrugAIMatch(drugCode, serviceDescription) {
  try {
    const match = await lookupDrugCode(drugCode);
    if (!match) return null;
    
    const score = calculateDrugMatchScore(
      serviceDescription,
      match.description
    );
    
    return {
      ...match,
      confidence: Math.max(score, 0.7) // Minimum confidence of 0.7 for verified matches
    };
  } catch (error) {
    console.error('[DRUG_MATCHER] Error verifying AI match:', error);
    return null;
  }
}

/**
 * Match a service to a drug code
 * @param {Object} service - The service to match
 * @returns {Promise<Object>} - The matched drug information
 */
const matchServiceToDrug = async (service) => {
  try {
    console.log('[DRUG_MATCHER] Attempting to match service:', service.description);
    
    if (!service.description) {
      console.log('[DRUG_MATCHER] No service description provided');
      return {
        matched: false,
        reasoning: 'No service description provided'
      };
    }

    // First check if service.code is in our commonDrugCodes
    if (service.code && commonDrugCodes[service.code]) {
      const drugInfo = commonDrugCodes[service.code];
      console.log('[DRUG_MATCHER] Direct match by CPT/HCPCS code:', service.code);
      return {
        matched: true,
        code: drugInfo.code,
        description: drugInfo.description,
        confidence: 0.99,
        reasoning: `Direct match by code ${service.code}`,
        matchMethod: 'direct_code',
        price: drugInfo.price
      };
    }

    // Parse dosage from service description
    const serviceDosage = parseDosage(service.description);
    console.log('[DRUG_MATCHER] Parsed service dosage:', serviceDosage);

    // First try to match by J-code if available
    if (service.code && service.code.startsWith('J')) {
      const drugInfo = await lookupDrugCode(service.code);
      if (drugInfo) {
        const drugDosage = parseDosage(drugInfo.dosage);
        const adjustedPrice = calculateAdjustedPrice(serviceDosage, drugDosage, drugInfo.price);
        
        return {
          matched: true,
          code: drugInfo.code,
          description: drugInfo.description,
          confidence: 0.99,
          reasoning: serviceDosage && drugDosage ? 
            `Direct match by J-code ${service.code} with adjusted price for ${serviceDosage.value}${serviceDosage.unit} vs ${drugDosage.value}${drugDosage.unit}` :
            `Direct match by J-code ${service.code}`,
          matchMethod: 'direct_code',
          originalPrice: drugInfo.price,
          price: adjustedPrice,
          dosageAdjusted: adjustedPrice !== drugInfo.price
        };
      }
    }
    
    // Try to match by description using OpenAI
    const aiMatch = await matchDrugWithOpenAI(service);
    console.log('[DRUG_MATCHER] AI match result:', aiMatch);
    
    if (aiMatch && aiMatch.isMatch) {
      const drugInfo = await lookupDrugCode(aiMatch.suggestedCode);
      if (drugInfo) {
        const drugDosage = parseDosage(drugInfo.dosage);
        const adjustedPrice = calculateAdjustedPrice(serviceDosage, drugDosage, drugInfo.price);
        
        return {
          matched: true,
          code: drugInfo.code,
          description: drugInfo.description,
          confidence: aiMatch.confidence,
          reasoning: serviceDosage && drugDosage ? 
            `${aiMatch.reasoning} with price adjusted for ${serviceDosage.value}${serviceDosage.unit} vs ${drugDosage.value}${drugDosage.unit}` :
            aiMatch.reasoning,
          matchMethod: 'ai_match',
          originalPrice: drugInfo.price,
          price: adjustedPrice,
          dosageAdjusted: adjustedPrice !== drugInfo.price
        };
      } else {
        // Return the AI match even without price data
        return {
          matched: true,
          code: aiMatch.suggestedCode,
          description: aiMatch.suggestedDescription,
          confidence: aiMatch.confidence * 0.8, // Reduce confidence slightly 
          reasoning: aiMatch.reasoning + ' (Note: No price data available for this drug code)',
          matchMethod: 'ai_match_no_price',
          price: null
        };
      }
    }
    
    return {
      matched: false,
      confidence: 0,
      reasoning: 'No matching drug found in database'
    };
  } catch (error) {
    console.error('[DRUG_MATCHER] Error matching drug:', error);
    return {
      matched: false,
      confidence: 0,
      reasoning: `Error matching drug: ${error.message}`
    };
  }
};

export {
  matchServiceToDrug
}; 