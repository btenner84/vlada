import { adminDb } from '../firebase/admin';
import { OpenAI } from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Enhanced common Medicare rates with more specific codes and descriptions
const commonMedicareRates = {
  // Emergency department visits
  '99283': { code: '99283', description: 'Emergency department visit, moderate severity', nonFacilityRate: 102.48, facilityRate: 51.24 },
  '99284': { code: '99284', description: 'Emergency department visit, high severity', nonFacilityRate: 155.40, facilityRate: 77.70 },
  '99285': { code: '99285', description: 'Emergency department visit, highest severity', nonFacilityRate: 229.32, facilityRate: 114.66 },
  
  // IV push services
  '96374': { code: '96374', description: 'IV push, single or initial substance/drug', nonFacilityRate: 74.52, facilityRate: 37.26 },
  '96375': { code: '96375', description: 'IV push, each additional substance/drug', nonFacilityRate: 27.54, facilityRate: 13.77 },
  
  // Office visits - Established patients
  '99211': { code: '99211', description: 'Office visit, established patient, minimal', nonFacilityRate: 25.20, facilityRate: 12.60 },
  '99212': { code: '99212', description: 'Office visit, established patient, low', nonFacilityRate: 50.40, facilityRate: 25.20 },
  '99213': { code: '99213', description: 'Office visit, established patient, moderate', nonFacilityRate: 88.96, facilityRate: 63.73 },
  '99214': { code: '99214', description: 'Office visit, established patient, high', nonFacilityRate: 129.60, facilityRate: 94.50 },
  '99215': { code: '99215', description: 'Office visit, established patient, high complexity', nonFacilityRate: 173.88, facilityRate: 130.41 },
  
  // Office visits - New patients
  '99201': { code: '99201', description: 'Office visit, new patient, minimal', nonFacilityRate: 47.52, facilityRate: 27.00 },
  '99202': { code: '99202', description: 'Office visit, new patient, low', nonFacilityRate: 77.76, facilityRate: 47.52 },
  '99203': { code: '99203', description: 'Office visit, new patient, moderate', nonFacilityRate: 115.92, facilityRate: 76.68 },
  '99204': { code: '99204', description: 'Office visit, new patient, high', nonFacilityRate: 176.40, facilityRate: 130.41 },
  '99205': { code: '99205', description: 'Office visit, new patient, high complexity', nonFacilityRate: 220.32, facilityRate: 165.24 },
  
  // Common specialty exams
  '92557': { code: '92557', description: 'Comprehensive audiometry', nonFacilityRate: 38.88, facilityRate: 38.88 },
  '92551': { code: '92551', description: 'Pure tone audiometry, air only', nonFacilityRate: 12.00, facilityRate: 12.00 },
  '92567': { code: '92567', description: 'Tympanometry', nonFacilityRate: 20.00, facilityRate: 20.00 },
  '92552': { code: '92552', description: 'Pure tone audiometry, air and bone', nonFacilityRate: 20.00, facilityRate: 20.00 },
  '92550': { code: '92550', description: 'Tympanometry and acoustic reflex', nonFacilityRate: 30.00, facilityRate: 30.00 },
  
  // Preventive visits for established patients
  '99395': { code: '99395', description: 'Comprehensive preventive visit, established patient, 18-39 years', nonFacilityRate: 140.00, facilityRate: 100.00 },
  '99396': { code: '99396', description: 'Comprehensive preventive visit, established patient, 40-64 years', nonFacilityRate: 150.00, facilityRate: 110.00 },
  
  // Preventive visits for new patients
  '99385': { code: '99385', description: 'Comprehensive preventive visit, new patient, 18-39 years', nonFacilityRate: 180.00, facilityRate: 140.00 },
  '99386': { code: '99386', description: 'Comprehensive preventive visit, new patient, 40-64 years', nonFacilityRate: 200.00, facilityRate: 160.00 },
};

// Common service mappings - direct text matching to specific CPT codes
const serviceDescriptionMappings = {
  // General check-ups and physical exams
  'physical exam': { code: '99395', isPreventive: true },
  'physical examination': { code: '99395', isPreventive: true },
  'annual physical': { code: '99395', isPreventive: true },
  'annual exam': { code: '99395', isPreventive: true },
  'routine physical': { code: '99395', isPreventive: true },
  'annual check': { code: '99395', isPreventive: true },
  'wellness exam': { code: '99395', isPreventive: true },
  'wellness visit': { code: '99395', isPreventive: true },
  'preventive exam': { code: '99395', isPreventive: true },
  'preventive visit': { code: '99395', isPreventive: true },
  'complete physical': { code: '99395', isPreventive: true },
  'comprehensive physical': { code: '99396', isPreventive: true },
  'comprehensive exam': { code: '99215', isPreventive: false },
  'comprehensive evaluation': { code: '99215', isPreventive: false },
  'full check up': { code: '99395', isPreventive: true },
  'full checkup': { code: '99395', isPreventive: true },
  'check up': { code: '99395', isPreventive: true },
  'checkup': { code: '99395', isPreventive: true },
  
  // ENT-specific exams
  'ear exam': { code: '92551', specialty: 'ENT' },
  'ear examination': { code: '92551', specialty: 'ENT' },
  'ear and throat': { code: '92557', specialty: 'ENT' },
  'ear & throat': { code: '92557', specialty: 'ENT' },
  'throat exam': { code: '99213', specialty: 'ENT' },
  'throat examination': { code: '99213', specialty: 'ENT' },
  'ear evaluation': { code: '92557', specialty: 'ENT' },
  'hearing test': { code: '92557', specialty: 'ENT' },
  'hearing evaluation': { code: '92557', specialty: 'ENT' },
  'audiometry': { code: '92557', specialty: 'ENT' },
  'tympanometry': { code: '92567', specialty: 'ENT' },
  
  // Emergency services
  'emergency room': { code: '99284', facilityRequired: true },
  'emergency department': { code: '99284', facilityRequired: true },
  'er visit': { code: '99284', facilityRequired: true },
  'ed visit': { code: '99284', facilityRequired: true },
  
  // IV services
  'iv push': { code: '96374', facilityRequired: false },
  'intravenous push': { code: '96374', facilityRequired: false },
  'iv injection': { code: '96374', facilityRequired: false },
  'intravenous injection': { code: '96374', facilityRequired: false },
  'iv additional': { code: '96375', facilityRequired: false },
  'additional iv': { code: '96375', facilityRequired: false },
};

/**
 * Match a service to a Medicare rate
 * @param {Object} service - The service to match
 * @param {Object} additionalContext - Additional context about the service
 * @returns {Promise<Object|null>} - The matched Medicare rate information
 */
async function matchServiceToMedicare(service, additionalContext = {}) {
  try {
    console.log(`[MEDICARE_MATCHER] Starting Medicare rate matching for: "${service.description}"`);
    
    if (!service.description) {
      console.log('[MEDICARE_MATCHER] No service description provided');
      return {
        matched: false,
        reasoning: 'No service description provided'
      };
    }

    // Extract the code if available (we'll use this for confirmation later)
    const extractedCode = service.code || extractCodeFromDescription(service.description);
    if (extractedCode) {
      console.log(`[MEDICARE_MATCHER] Extracted code from service: ${extractedCode}`);
    }

    // STEP 1: Use OpenAI as the first line of defense
    console.log(`[MEDICARE_MATCHER] Using OpenAI as primary matcher for: "${service.description}"`);
    const aiMatch = await findMatchWithOpenAI(service, additionalContext);
    
    if (aiMatch) {
      console.log(`[MEDICARE_MATCHER] OpenAI suggested code: ${aiMatch.code} with confidence: ${aiMatch.confidence.toFixed(2)}`);
      
      // STEP 2: If AI confidence is high (≥70%), use it directly
      if (aiMatch.confidence >= 0.7) {
        console.log(`[MEDICARE_MATCHER] High confidence AI match (${aiMatch.confidence.toFixed(2)}), using directly`);
        
        // Verify the AI match against the database
        const rateInfo = await lookupMedicareRate(aiMatch.code);
        
        if (rateInfo) {
          console.log(`[MEDICARE_MATCHER] Verified AI match in database: ${rateInfo.code}`);
          
          // If we have an extracted code, check if it matches the AI suggestion
          if (extractedCode && extractedCode === aiMatch.code) {
            console.log(`[MEDICARE_MATCHER] AI match confirmed by extracted code: ${extractedCode}`);
            return {
              matched: true,
              ...rateInfo,
              confidence: Math.max(aiMatch.confidence, 0.95), // Boost confidence due to code confirmation
              reasoning: aiMatch.reasoning + " (Confirmed by extracted code)",
              matchMethod: 'ai_match_code_confirmed'
            };
      }
      
      return {
            matched: true,
            ...rateInfo,
            confidence: aiMatch.confidence,
            reasoning: aiMatch.reasoning,
            matchMethod: 'ai_match_primary'
          };
        } else {
          console.log(`[MEDICARE_MATCHER] AI match ${aiMatch.code} not found in database, returning AI result only`);
          return {
            matched: true,
            code: aiMatch.code,
            description: aiMatch.suggestedDescription || service.description,
            confidence: aiMatch.confidence * 0.9, // Slightly reduce confidence for unverified matches
            reasoning: aiMatch.reasoning + " (Note: No rate data available for this code)",
            matchMethod: 'ai_match_unverified',
            nonFacilityRate: null,
            facilityRate: null
          };
        }
      } else {
        console.log(`[MEDICARE_MATCHER] Low confidence AI match (${aiMatch.confidence.toFixed(2)}), checking alternatives`);
      }
    } else {
      console.log(`[MEDICARE_MATCHER] OpenAI failed to provide a match, falling back to code lookup`);
    }
    
    // STEP 3: If AI confidence is low or AI failed, try using the extracted code
    if (extractedCode) {
      console.log(`[MEDICARE_MATCHER] Trying direct code lookup with extracted code: ${extractedCode}`);
      const rateInfo = await lookupMedicareRate(extractedCode);
      
      if (rateInfo) {
        console.log(`[MEDICARE_MATCHER] Found direct match in Medicare database: ${extractedCode}`);
        return {
          matched: true,
          ...rateInfo,
          confidence: 0.95, // High confidence for direct code match
          reasoning: `Direct match by code ${extractedCode}`,
          matchMethod: 'direct_code_match'
        };
      } else {
        console.log(`[MEDICARE_MATCHER] Extracted code ${extractedCode} not found in database`);
      }
    }
    
    // STEP 4: If we have a low-confidence AI match but nothing else worked, use it as fallback
    if (aiMatch) {
      console.log(`[MEDICARE_MATCHER] Using low confidence AI match as fallback: ${aiMatch.code} (${aiMatch.confidence.toFixed(2)})`);
      
      // Try to verify it against the database one more time
      const rateInfo = await lookupMedicareRate(aiMatch.code);
      
      if (rateInfo) {
        return {
          matched: true,
          ...rateInfo,
          confidence: aiMatch.confidence,
          reasoning: aiMatch.reasoning,
          matchMethod: 'ai_match_fallback'
        };
      }
      
      return {
        matched: true,
        code: aiMatch.code,
        description: aiMatch.suggestedDescription || service.description,
        confidence: aiMatch.confidence * 0.8, // Reduce confidence for unverified fallback
        reasoning: aiMatch.reasoning + " (Note: No rate data available for this code)",
        matchMethod: 'ai_match_fallback_unverified',
        nonFacilityRate: null,
        facilityRate: null
      };
    }
    
    // STEP 5: Last resort - try category-specific matching
    if (additionalContext.category) {
      console.log(`[MEDICARE_MATCHER] Trying category-specific matching for: ${additionalContext.category}`);
      
      let categoryMatch = null;
      
      switch (additionalContext.category) {
        case 'Office visits and Consultations':
          categoryMatch = await matchOfficeVisit(service.description, service, additionalContext);
          break;
        case 'Hospital stays and emergency care visits':
          categoryMatch = await matchEmergencyCare(service.description, service, additionalContext);
          break;
        default:
          categoryMatch = await findMatchByDescription(service.description, additionalContext.category);
      }
      
      if (categoryMatch) {
        console.log(`[MEDICARE_MATCHER] Found category-specific match: ${categoryMatch.code}`);
        return {
          matched: true,
          ...categoryMatch,
          matchMethod: 'category_specific_match'
        };
      }
    }
    
    console.log(`[MEDICARE_MATCHER] No match found for service: "${service.description}"`);
    return {
      matched: false,
      confidence: 0,
      reasoning: 'No matching Medicare rate found'
    };
    
  } catch (error) {
    console.error('[MEDICARE_MATCHER] Error in Medicare matching:', error);
    return {
      matched: false,
      confidence: 0,
      reasoning: `Error matching Medicare rate: ${error.message}`
    };
  }
}

/**
 * Look up a Medicare rate by CPT code
 * @param {string} code - The CPT code to look up
 * @returns {Promise<Object|null>} - The Medicare rate information or null
 */
async function lookupMedicareRate(code) {
  try {
    console.log(`[MEDICARE_MATCHER] Looking up Medicare rate for code: ${code}`);
    
    // Check common Medicare rates first
    if (commonMedicareRates[code]) {
      const data = commonMedicareRates[code];
      console.log(`[MEDICARE_MATCHER] Found common Medicare rate: ${code}`, data);
      return {
        code: data.code,
        description: data.description,
        nonFacilityRate: data.nonFacilityRate,
        facilityRate: data.facilityRate,
        reasoning: 'Direct match from common Medicare rates'
      };
    }
    
    // Try to find in Firestore
    try {
      if (adminDb) {
        // First try medicareCodes collection
        let docRef = await adminDb.collection('medicareCodes').doc(code).get();
        
        if (!docRef.exists) {
          // If not found, try cptCodeMappings collection
          docRef = await adminDb.collection('cptCodeMappings').doc(code).get();
        }
        
        if (docRef.exists) {
          const data = docRef.data();
          console.log(`[MEDICARE_MATCHER] Found Medicare rate data in database:`, data);
          return {
            code: data.code,
            description: data.description,
            nonFacilityRate: data.nonFacilityRate || null,
            facilityRate: data.facilityRate || null,
            reasoning: 'Match from Medicare Fee Schedule database'
          };
        }
      }
    } catch (firestoreError) {
      console.error('[MEDICARE_MATCHER] Firestore error:', firestoreError.message);
    }
    
    console.log(`[MEDICARE_MATCHER] No Medicare rate found for code: ${code}`);
    return null;
  } catch (error) {
    console.error('[MEDICARE_MATCHER] Error looking up Medicare rate:', error);
    return null;
  }
}

/**
 * Extract a CPT code from a service description
 * @param {string} description - The service description
 * @returns {string|null} - The extracted code or null
 */
function extractCodeFromDescription(description) {
  if (!description) return null;
  
  // Look for patterns like "CPT: 99213" or just "99213"
  const codePatterns = [
    /CPT:?\s*(\d{5})/i,
    /Code:?\s*(\d{5})/i,
    /\s(\d{5})\s/,
    /^(\d{5})$/,
    /\s(\d{5})$/,
    /(\d{5})/
  ];
  
  for (const pattern of codePatterns) {
    const match = description.match(pattern);
    if (match && match[1]) {
      const code = match[1];
      // Validate code range for E&M codes
      if ((code >= '99201' && code <= '99499') || 
          (code >= '10000' && code <= '69999') || // Surgery
          (code >= '70000' && code <= '79999') || // Radiology
          (code >= '80000' && code <= '89999') || // Lab
          (code >= '90000' && code <= '99099') || // Medicine
          (code >= '99100' && code <= '99499')) { // E&M
        return code;
      }
    }
  }
  
  return null;
}

/**
 * Find a match using OpenAI's semantic understanding
 * @param {Object} service - The service object
 * @param {Object} additionalContext - Additional context about the service
 * @returns {Promise<Object|null>} - The matched Medicare rate information or null
 */
async function findMatchWithOpenAI(service, additionalContext = {}) {
  try {
    console.log(`[MEDICARE_MATCHER] Finding match with OpenAI for: "${service.description}"`);
    
    // Create a robust prompt for OpenAI
    let prompt = `I need to find the most appropriate CPT code and Medicare rate for this medical service:

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
    
    // Add patient type if available
    if (additionalContext.patientType) {
      prompt += `\nPatient Type: ${additionalContext.patientType}`;
    }
    
    prompt += `\n\nThis is for Medicare rate determination. Please provide the most appropriate CPT code that would be used for billing this service.

For medical services, consider the following:
1. E&M codes (99201-99499) for office visits and consultations
2. Surgery codes (10000-69999) for procedures
3. Consider the level of service (minimal, low, moderate, high)
4. Consider if this is a new or established patient
5. Consider the setting (office, hospital, emergency department)
6. Consider the complexity and time spent

Your task is to determine the most specific and accurate code that represents this medical service.

Respond in JSON format with the following structure:
{
  "code": "99213",
  "suggestedDescription": "Standard description of the service",
  "confidence": 0.95,
  "reasoning": "Detailed explanation of why this code is appropriate"
}

The confidence should reflect your certainty in the match, with values:
- 0.9-1.0: Very high confidence (exact match)
- 0.8-0.89: High confidence (strong match)
- 0.7-0.79: Good confidence (likely match)
- 0.5-0.69: Moderate confidence (possible match)
- <0.5: Low confidence (uncertain match)`;

    console.log('[MEDICARE_MATCHER] Calling OpenAI API for CPT code matching');
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are a medical coding expert specializing in CPT codes and Medicare rates. Your task is to match service descriptions to the most appropriate CPT code. Be precise and consider the level of service, setting, and complexity. Provide detailed reasoning for your code selection.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });
    
    // Parse the response
    const result = JSON.parse(response.choices[0].message.content);
    console.log('[MEDICARE_MATCHER] OpenAI response:', JSON.stringify(result, null, 2));
    
    // Validate the CPT code format (5 digits)
    const isValidCode = /^\d{5}$/.test(result.code);
    
    if (!isValidCode) {
      console.warn('[MEDICARE_MATCHER] OpenAI returned invalid CPT code format:', result.code);
  return null;
    }
    
    return {
      code: result.code,
      suggestedDescription: result.suggestedDescription,
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning || 'Matched using AI'
    };
  } catch (error) {
    console.error('[MEDICARE_MATCHER] Error finding match with OpenAI:', error);
    return null;
  }
}

/**
 * Match office visit with appropriate E&M code
 * @param {string} description - The service description
 * @param {Object} service - The original service object
 * @param {Object} context - Additional context
 * @returns {Promise<Object|null>} - The matched Medicare rate information
 */
async function matchOfficeVisit(description, service, context) {
  try {
  console.log('[MEDICARE_MATCHER] Matching office visit or consultation');
    
    const normalizedDesc = description.toLowerCase();
  
  // Determine if this is a preventive visit
  const isPreventive = 
    normalizedDesc.includes('preventive') || 
    normalizedDesc.includes('annual') || 
    normalizedDesc.includes('physical') ||
      normalizedDesc.includes('wellness');
  
    // Check for new or established patient
    const isNewPatient = 
      normalizedDesc.includes('new patient') || 
                       normalizedDesc.includes('new visit') || 
      context.patientType === 'new';
  
    // Determine complexity/level
  let level = 3; // Default to level 3 (moderate)
  
  if (normalizedDesc.includes('comprehensive') || 
      normalizedDesc.includes('complex') || 
        normalizedDesc.includes('detailed')) {
      level = 4;
    } else if (normalizedDesc.includes('extended') || 
               normalizedDesc.includes('highest') || 
               normalizedDesc.includes('severe')) {
      level = 5;
    } else if (normalizedDesc.includes('brief') || 
               normalizedDesc.includes('limited')) {
      level = 2;
    } else if (normalizedDesc.includes('minimal')) {
      level = 1;
    }
    
    // Determine the appropriate code
    let code;
  if (isPreventive) {
      code = isNewPatient ? '99385' : '99395';
    } else {
      code = isNewPatient ? `9920${level}` : `9921${level}`;
    }
    
    // Look up the rate
    const rateInfo = await lookupMedicareRate(code);
  if (rateInfo) {
    return {
      ...rateInfo,
        confidence: 0.85,
        reasoning: `Matched as ${isNewPatient ? 'new' : 'established'} patient ${isPreventive ? 'preventive' : ''} visit, level ${level}`,
        matchMethod: 'office_visit_pattern'
    };
  }
  
  return null;
  } catch (error) {
    console.error('[MEDICARE_MATCHER] Error matching office visit:', error);
    return null;
  }
}

/**
 * Match emergency care service
 * @param {string} description - The service description
 * @param {Object} service - The original service object
 * @param {Object} context - Additional context
 * @returns {Promise<Object|null>} - The matched Medicare rate information
 */
async function matchEmergencyCare(description, service, context) {
  try {
  console.log('[MEDICARE_MATCHER] Matching emergency care service');
  
    const normalizedDesc = description.toLowerCase();
    
    // Determine severity level
    let code = '99283'; // Default to moderate severity
    
    if (normalizedDesc.includes('critical') || 
        normalizedDesc.includes('severe') || 
        normalizedDesc.includes('highest')) {
      code = '99285';
    } else if (normalizedDesc.includes('high') || 
               normalizedDesc.includes('complex')) {
      code = '99284';
    }
    
    // Look up the rate
    const rateInfo = await lookupMedicareRate(code);
    if (rateInfo) {
      return {
        ...rateInfo,
        confidence: 0.85,
        reasoning: `Matched as emergency department visit with ${code === '99285' ? 'highest' : code === '99284' ? 'high' : 'moderate'} severity`,
        matchMethod: 'emergency_care_pattern'
    };
  }
  
  return null;
  } catch (error) {
    console.error('[MEDICARE_MATCHER] Error matching emergency care:', error);
    return null;
  }
}

/**
 * Find match by description in the database
 * @param {string} description - The service description
 * @param {string} category - The service category
 * @returns {Promise<Object|null>} - The matched Medicare rate information
 */
async function findMatchByDescription(description, category) {
  try {
    console.log(`[MEDICARE_MATCHER] Finding match by description for: "${description}"`);
    
    const normalizedDesc = description.toLowerCase();
    
    // Get code range for category
    let codeRange = null;
      switch (category) {
        case 'Office visits and Consultations':
          codeRange = { start: '99201', end: '99499' };
          break;
        case 'Procedures and Surgeries':
          codeRange = { start: '10000', end: '69999' };
          break;
        case 'Hospital stays and emergency care visits':
          codeRange = { start: '99217', end: '99288' };
          break;
      default:
          break;  
    }
    
    // Query the database
    let query = adminDb.collection('medicareCodes');
    if (codeRange) {
      query = query.where('code', '>=', codeRange.start)
                  .where('code', '<=', codeRange.end);
    }
    
    const snapshot = await query.limit(20).get();
    
    if (snapshot.empty) {
        return null;
    }
    
    // Score matches
    const matches = [];
    snapshot.forEach(doc => {
          const data = doc.data();
      const score = calculateMatchScore(normalizedDesc, data.description);
      if (score >= 0.6) {
        matches.push({
          ...data,
          confidence: score,
          reasoning: `Matched by description similarity (${Math.round(score * 100)}% match)`
              });
            }
          });
    
    // Return best match
    if (matches.length > 0) {
      matches.sort((a, b) => b.confidence - a.confidence);
      return matches[0];
    }
    
    return null;
  } catch (error) {
    console.error('[MEDICARE_MATCHER] Error finding match by description:', error);
    return null;
  }
}

/**
 * Calculate match score between service description and Medicare description
 * @param {string} serviceDesc - The service description
 * @param {string} medicareDesc - The Medicare code description
 * @returns {number} - Match score between 0 and 1
 */
function calculateMatchScore(serviceDesc, medicareDesc) {
  // Important medical terms that should have higher weight
  const importantTerms = [
    'evaluation', 'management', 'consultation', 'emergency', 'critical',
    'comprehensive', 'detailed', 'expanded', 'problem', 'focused',
    'office', 'outpatient', 'inpatient', 'hospital', 'initial',
    'subsequent', 'follow', 'established', 'new', 'patient'
  ];
  
  const serviceWords = serviceDesc.split(/\s+/).filter(w => w.length > 2);
  const medicareWords = medicareDesc.split(/\s+/).filter(w => w.length > 2);
  
  let totalWeight = 0;
  let matchWeight = 0;
  
  for (const word of serviceWords) {
    const weight = importantTerms.includes(word) ? 2 : 1;
    totalWeight += weight;
    
    if (medicareWords.includes(word)) {
      matchWeight += weight;
    }
  }
  
  return totalWeight > 0 ? matchWeight / totalWeight : 0;
}

export {
  matchServiceToMedicare,
  lookupMedicareRate
}; 