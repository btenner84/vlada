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
 * Match a service to a drug code
 * @param {Object} service - The service to match
 * @param {Object} additionalContext - Additional context about the service
 * @returns {Promise<Object>} - The matched drug information
 */
const matchServiceToDrug = async (service, additionalContext = {}) => {
  try {
    console.log('[DRUG_MATCHER] Starting drug matching for:', service.description);
    
    if (!service.description) {
      console.log('[DRUG_MATCHER] No service description provided');
      return {
        matched: false,
        reasoning: 'No service description provided'
      };
    }

    // Extract the code if available (we'll use this for confirmation later)
    const extractedCode = service.code || extractCodeFromDescription(service.description);
    if (extractedCode) {
      console.log(`[DRUG_MATCHER] Extracted code from service: ${extractedCode}`);
    }
    
    // Parse dosage from service description (for price adjustment later)
    const serviceDosage = parseDosage(service.description);
    console.log('[DRUG_MATCHER] Parsed service dosage:', serviceDosage);

    // STEP 1: Use OpenAI as the first line of defense
    console.log(`[DRUG_MATCHER] Using OpenAI as primary matcher for: "${service.description}"`);
    const aiMatch = await findMatchWithOpenAI(service, additionalContext);
    
    if (aiMatch) {
      console.log(`[DRUG_MATCHER] OpenAI suggested code: ${aiMatch.code} with confidence: ${aiMatch.confidence.toFixed(2)}`);
      
      // STEP 2: If AI confidence is high (≥70%), use it directly
      if (aiMatch.confidence >= 0.7) {
        console.log(`[DRUG_MATCHER] High confidence AI match (${aiMatch.confidence.toFixed(2)}), using directly`);
        
        // Verify the AI match against the database
        const drugInfo = await lookupDrugCode(aiMatch.code);
        
        if (drugInfo) {
          console.log(`[DRUG_MATCHER] Verified AI match in database: ${drugInfo.code}`);
          
          // If we have an extracted code, check if it matches the AI suggestion
          if (extractedCode && extractedCode === aiMatch.code) {
            console.log(`[DRUG_MATCHER] AI match confirmed by extracted code: ${extractedCode}`);
            
            // Apply dosage-based price adjustment if applicable
            const drugDosage = parseDosage(drugInfo.dosage || drugInfo.description);
            const adjustedPrice = calculateAdjustedPrice(serviceDosage, drugDosage, drugInfo.price);
            
            return {
              matched: true,
              code: drugInfo.code,
              description: drugInfo.description,
              confidence: Math.max(aiMatch.confidence, 0.95), // Boost confidence due to code confirmation
              reasoning: aiMatch.reasoning + " (Confirmed by extracted code)" + 
                (adjustedPrice !== drugInfo.price ? ` with price adjusted for ${serviceDosage?.value}${serviceDosage?.unit} vs ${drugDosage?.value}${drugDosage?.unit}` : ""),
              matchMethod: 'ai_match_code_confirmed',
              originalPrice: drugInfo.price,
              price: adjustedPrice,
              dosage: drugInfo.dosage,
              dosageAdjusted: adjustedPrice !== drugInfo.price
            };
          }
          
          // Apply dosage-based price adjustment
          const drugDosage = parseDosage(drugInfo.dosage || drugInfo.description);
          const adjustedPrice = calculateAdjustedPrice(serviceDosage, drugDosage, drugInfo.price);
          
          return {
            matched: true,
            code: drugInfo.code,
            description: drugInfo.description,
            confidence: aiMatch.confidence,
            reasoning: aiMatch.reasoning + 
              (adjustedPrice !== drugInfo.price ? ` with price adjusted for ${serviceDosage?.value}${serviceDosage?.unit} vs ${drugDosage?.value}${drugDosage?.unit}` : ""),
            matchMethod: 'ai_match_primary',
            originalPrice: drugInfo.price,
            price: adjustedPrice,
            dosage: drugInfo.dosage,
            dosageAdjusted: adjustedPrice !== drugInfo.price
          };
        } else {
          console.log(`[DRUG_MATCHER] AI match ${aiMatch.code} not found in database, returning AI result only`);
          return {
            matched: true,
            code: aiMatch.code,
            description: aiMatch.suggestedDescription || service.description,
            confidence: aiMatch.confidence * 0.9, // Slightly reduce confidence for unverified matches
            reasoning: aiMatch.reasoning + " (Note: No price data available for this drug code)",
            matchMethod: 'ai_match_unverified',
            price: null
          };
        }
      } else {
        console.log(`[DRUG_MATCHER] Low confidence AI match (${aiMatch.confidence.toFixed(2)}), checking alternatives`);
      }
    } else {
      console.log(`[DRUG_MATCHER] OpenAI failed to provide a match, falling back to code lookup`);
    }
    
    // STEP 3: If AI confidence is low or AI failed, try using the extracted code
    if (extractedCode) {
      console.log(`[DRUG_MATCHER] Trying direct code lookup with extracted code: ${extractedCode}`);
      const drugInfo = await lookupDrugCode(extractedCode);
      
      if (drugInfo) {
        console.log(`[DRUG_MATCHER] Found direct match in drug database: ${extractedCode}`);
        
        // Apply dosage-based price adjustment
        const drugDosage = parseDosage(drugInfo.dosage || drugInfo.description);
        const adjustedPrice = calculateAdjustedPrice(serviceDosage, drugDosage, drugInfo.price);
        
        return {
          matched: true,
          code: drugInfo.code,
          description: drugInfo.description,
          confidence: 0.95, // High confidence for direct code match
          reasoning: `Direct match by code ${extractedCode}` + 
            (adjustedPrice !== drugInfo.price ? ` with price adjusted for ${serviceDosage?.value}${serviceDosage?.unit} vs ${drugDosage?.value}${drugDosage?.unit}` : ""),
          matchMethod: 'direct_code_match',
          originalPrice: drugInfo.price,
          price: adjustedPrice,
          dosage: drugInfo.dosage,
          dosageAdjusted: adjustedPrice !== drugInfo.price
        };
      } else {
        console.log(`[DRUG_MATCHER] Extracted code ${extractedCode} not found in database`);
      }
    }
    
    // STEP 4: If we have a low-confidence AI match but nothing else worked, use it as fallback
    if (aiMatch) {
      console.log(`[DRUG_MATCHER] Using low confidence AI match as fallback: ${aiMatch.code} (${aiMatch.confidence.toFixed(2)})`);
      
      // Try to verify it against the database one more time
      const drugInfo = await lookupDrugCode(aiMatch.code);
      
      if (drugInfo) {
        // Apply dosage-based price adjustment
        const drugDosage = parseDosage(drugInfo.dosage || drugInfo.description);
        const adjustedPrice = calculateAdjustedPrice(serviceDosage, drugDosage, drugInfo.price);
        
        return {
          matched: true,
          code: drugInfo.code,
          description: drugInfo.description,
          confidence: aiMatch.confidence,
          reasoning: aiMatch.reasoning + 
            (adjustedPrice !== drugInfo.price ? ` with price adjusted for ${serviceDosage?.value}${serviceDosage?.unit} vs ${drugDosage?.value}${drugDosage?.unit}` : ""),
          matchMethod: 'ai_match_fallback',
          originalPrice: drugInfo.price,
          price: adjustedPrice,
          dosage: drugInfo.dosage,
          dosageAdjusted: adjustedPrice !== drugInfo.price
        };
      }
      
      return {
        matched: true,
        code: aiMatch.code,
        description: aiMatch.suggestedDescription || service.description,
        confidence: aiMatch.confidence * 0.8, // Reduce confidence for unverified fallback
        reasoning: aiMatch.reasoning + " (Note: No price data available for this drug code)",
        matchMethod: 'ai_match_fallback_unverified',
        price: null
      };
    }
    
    // STEP 5: Last resort - try name-based matching
    console.log(`[DRUG_MATCHER] All primary methods failed, attempting name-based matching`);
    const nameMatch = findMatchByDrugName(service.description);
    
    if (nameMatch) {
      console.log(`[DRUG_MATCHER] Found name-based match: ${nameMatch.code} (${nameMatch.confidence.toFixed(2)})`);
      
      // Apply dosage-based price adjustment
      const drugDosage = parseDosage(nameMatch.dosage || nameMatch.description);
      const adjustedPrice = calculateAdjustedPrice(serviceDosage, drugDosage, nameMatch.price);
      
      return {
        matched: true,
        code: nameMatch.code,
        description: nameMatch.description,
        confidence: nameMatch.confidence,
        reasoning: `Matched by drug name similarity` + 
          (adjustedPrice !== nameMatch.price ? ` with price adjusted for ${serviceDosage?.value}${serviceDosage?.unit} vs ${drugDosage?.value}${drugDosage?.unit}` : ""),
        matchMethod: 'name_match_last_resort',
        originalPrice: nameMatch.price,
        price: adjustedPrice,
        dosage: nameMatch.dosage,
        dosageAdjusted: adjustedPrice !== nameMatch.price
      };
    }
    
    console.log(`[DRUG_MATCHER] No match found for service: "${service.description}"`);
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
    
    // Check ASP pricing map
    if (aspPricingMap.has(code)) {
      const data = aspPricingMap.get(code);
      console.log('[DRUG_MATCHER] Found drug code in ASP pricing map:', code, data);
      return data;
    }
    
    // Try to find in Firestore if available
    try {
      if (adminDb) {
        const docRef = adminDb.collection('drugCodes').doc(code);
        const doc = await docRef.get();
        
        if (doc.exists) {
          const data = doc.data();
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
 * Extract a drug code from a service description
 * @param {string} description - The service description
 * @returns {string|null} - The extracted code or null
 */
function extractCodeFromDescription(description) {
  if (!description) return null;
  
  // Look for patterns like "J-code: J1234" or "HCPCS J1234" or just "J1234"
  const codePatterns = [
    /J-code:?\s*([J][0-9]{4})/i,
    /HCPCS:?\s*([J][0-9]{4})/i,
    /Code:?\s*([J][0-9]{4})/i,
    /([J][0-9]{4})/i,
    /CPT:?\s*(9[0-9]{4})/i,  // For drug administration CPT codes
    /(9[0-9]{4})/            // For drug administration CPT codes
  ];
  
  for (const pattern of codePatterns) {
    const match = description.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Find a match using OpenAI's semantic understanding
 * @param {object} service - The service object with description
 * @param {object} additionalContext - Additional context about the service
 * @returns {Promise<object|null>} - The matched drug information or null
 */
async function findMatchWithOpenAI(service, additionalContext = {}) {
  try {
    console.log(`[DRUG_MATCHER] Finding match with OpenAI for: "${service.description}"`);
    
    // Create a more robust prompt for OpenAI
    let prompt = `I need to find the most appropriate drug code (J-code or CPT code) for this medical service:

Service Description: "${service.description}"`;

    // Add service code if available
    if (service.code) {
      prompt += `\nExtracted Code: ${service.code}`;
    }

    // Add service category if available
    if (additionalContext.category) {
      prompt += `\nService Category: ${additionalContext.category}`;
    }

    // Add patient information if available
    if (additionalContext.patientAge) {
      prompt += `\nPatient Age: ${additionalContext.patientAge}`;
    }
    
    // Add facility type if available
    if (additionalContext.facilityType) {
      prompt += `\nFacility Type: ${additionalContext.facilityType}`;
    }
    
    prompt += `\n\nThis is for drug identification and pricing. Please provide the most appropriate code that would be used for billing this drug or medication.

For drug services, consider the following:
1. J-codes (J0000-J9999) are used for injectable/infusible drugs
2. Drug administration CPT codes (96360-96379) for infusions and injections
3. Consider both generic and brand names of medications
4. Pay attention to dosage information in the description
5. Consider common drug name variations (e.g., Zofran for ondansetron)

Your task is to determine the most specific and accurate code that represents this drug or medication service.

Respond in JSON format with the following structure:
{
  "code": "J1234",
  "suggestedDescription": "Standard description of the drug with dosage",
  "confidence": 0.95,
  "reasoning": "Detailed explanation of why this code is appropriate for this drug service"
}

The confidence should reflect your certainty in the match, with values:
- 0.9-1.0: Very high confidence (exact match)
- 0.8-0.89: High confidence (strong match)
- 0.7-0.79: Good confidence (likely match)
- 0.5-0.69: Moderate confidence (possible match)
- <0.5: Low confidence (uncertain match)`;

    console.log('[DRUG_MATCHER] Calling OpenAI API for drug code matching with enhanced prompt');
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are a pharmaceutical billing expert specializing in drug codes and pricing. Your task is to match service descriptions to the most appropriate drug codes (J-codes) or drug administration codes (CPT). Be precise and consider both generic and brand names, dosage information, and administration methods. Provide detailed reasoning for your code selection.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });
    
    // Parse the response
    const result = JSON.parse(response.choices[0].message.content);
    console.log('[DRUG_MATCHER] OpenAI response:', JSON.stringify(result, null, 2));
    
    // Validate the code format (J-code or drug administration CPT)
    const isValidCode = /^J\d{4}$/i.test(result.code) || /^9\d{4}$/i.test(result.code);
    
    if (!isValidCode) {
      console.warn('[DRUG_MATCHER] OpenAI returned invalid code format:', result.code);
      return null;
    }
    
    return {
      code: result.code,
      suggestedDescription: result.suggestedDescription,
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning || 'Matched using AI'
    };
  } catch (error) {
    console.error('[DRUG_MATCHER] Error finding match with OpenAI:', error);
    return null;
  }
}

/**
 * Find a match by drug name similarity
 * @param {string} description - The service description
 * @returns {Object|null} - The matched drug information or null
 */
function findMatchByDrugName(description) {
  try {
    if (!description) return null;
    
    console.log(`[DRUG_MATCHER] Finding match by drug name for: "${description}"`);
    
    const normalizedDesc = description.toLowerCase();
    
    // First check for exact matches in the drug name map
    if (drugNameMap.has(normalizedDesc)) {
      const match = drugNameMap.get(normalizedDesc);
      console.log(`[DRUG_MATCHER] Found exact name match: ${match.code}`);
      return {
        ...match,
        confidence: 0.95
      };
    }
    
    // Check for drug name variations
    for (const [genericName, variations] of Object.entries(drugNameVariations)) {
      for (const variation of variations) {
        if (normalizedDesc.includes(variation)) {
          // Find the drug with this generic name
          for (const drug of aspPricingMap.values()) {
            if (drug.description.toLowerCase().includes(genericName)) {
              console.log(`[DRUG_MATCHER] Found match through name variation: ${variation} -> ${genericName} -> ${drug.code}`);
              return {
                ...drug,
                confidence: 0.85
              };
            }
          }
        }
      }
    }
    
    // Check for partial matches in drug descriptions
    let bestMatch = null;
    let bestScore = 0;
    
    for (const drug of aspPricingMap.values()) {
      const score = calculateDrugMatchScore(normalizedDesc, drug.description.toLowerCase());
      if (score > 0.6 && score > bestScore) {
        bestScore = score;
        bestMatch = { ...drug, confidence: score };
      }
    }
    
    if (bestMatch) {
      console.log(`[DRUG_MATCHER] Found best partial match: ${bestMatch.code} (${bestScore.toFixed(2)})`);
      return bestMatch;
    }
    
    console.log('[DRUG_MATCHER] No name-based match found');
    return null;
  } catch (error) {
    console.error('[DRUG_MATCHER] Error finding match by drug name:', error);
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
    if (!str) return null;
    
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
 * Calculate adjusted price based on dosage ratio
 * @param {Object} serviceDosage - Parsed service dosage
 * @param {Object} drugDosage - Parsed drug dosage
 * @param {number} basePrice - Original drug price
 * @returns {number} - Adjusted price
 */
function calculateAdjustedPrice(serviceDosage, drugDosage, basePrice) {
  if (!serviceDosage || !drugDosage || !basePrice) return basePrice;

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
  
  // If units are incompatible or values don't make sense, return base price
  if (!serviceValueMg || !drugValueMg || serviceValueMg <= 0 || drugValueMg <= 0) {
    return basePrice;
  }
  
  return (serviceValueMg / drugValueMg) * basePrice;
}

export {
  matchServiceToDrug
}; 