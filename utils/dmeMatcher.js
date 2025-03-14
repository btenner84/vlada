import xlsx from 'xlsx';
import path from 'path';
import { OpenAI } from 'openai';
import { adminDb } from '../firebase/admin.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Use the existing Firebase Admin instance
const db = adminDb;

// Initialize DME pricing data
const dmePricingMap = new Map();
const dmeNameMap = new Map();

// Common DME categories and keywords
const dmeCategories = {
  'Oxygen Equipment': ['oxygen', 'concentrator', 'tank', 'portable oxygen', 'o2'],
  'Mobility Devices': ['wheelchair', 'walker', 'cane', 'crutches', 'scooter'],
  'Hospital Beds': ['hospital bed', 'bed', 'mattress', 'rails', 'trapeze'],
  'CPAP/BiPAP': ['cpap', 'bipap', 'sleep apnea', 'mask', 'ventilator'],
  'Diabetic Supplies': ['glucose', 'test strips', 'lancets', 'insulin pump'],
  'Orthotic Devices': ['brace', 'orthotic', 'splint', 'support', 'compression'],
  'Prosthetic Devices': ['prosthetic', 'artificial limb', 'prosthesis']
};

// Load DME pricing data from Excel file
function loadDMEPricingData() {
  try {
    const dmeFilePath = '/Users/bentenner/vlada/Databases/DME.xlsx';
    const workbook = xlsx.readFile(dmeFilePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(worksheet);

    data.forEach(item => {
      if (item.code && item.description) {
        const dmeInfo = {
          code: item.code,
          description: item.description,
          price: item.price || null,
          category: item.category || null,
          keywords: generateKeywords(item.description)
        };
        
        dmePricingMap.set(item.code, dmeInfo);
        dmeNameMap.set(item.description.toLowerCase(), dmeInfo);
      }
    });

    console.log(`[DME_MATCHER] Loaded ${dmePricingMap.size} DME codes from database`);
  } catch (error) {
    console.error('[DME_MATCHER] Error loading DME pricing data:', error);
  }
}

// Initialize data on module load
loadDMEPricingData();

/**
 * Match a service to a DME code
 * @param {Object} service - The service to match
 * @param {Object} additionalContext - Additional context about the service
 * @returns {Promise<Object>} - The matched DME information
 */
async function matchServiceToDME(service, additionalContext = {}) {
  try {
    console.log('[DME_MATCHER] Starting DME matching for:', service.description);
    
    if (!service.description) {
      console.log('[DME_MATCHER] No service description provided');
      return {
        matched: false,
        reasoning: 'No service description provided'
      };
    }

    // Extract the code if available (we'll use this for confirmation later)
    const extractedCode = service.code || extractCodeFromDescription(service.description);
    if (extractedCode) {
      console.log(`[DME_MATCHER] Extracted code from service: ${extractedCode}`);
    }

    // STEP 1: Use OpenAI as the first line of defense
    console.log(`[DME_MATCHER] Using OpenAI as primary matcher for: "${service.description}"`);
    const aiMatch = await findMatchWithOpenAI(service, additionalContext);
    
    if (aiMatch) {
      console.log(`[DME_MATCHER] OpenAI suggested code: ${aiMatch.code} with confidence: ${aiMatch.confidence.toFixed(2)}`);
      
      // STEP 2: If AI confidence is high (≥70%), use it directly
      if (aiMatch.confidence >= 0.7) {
        console.log(`[DME_MATCHER] High confidence AI match (${aiMatch.confidence.toFixed(2)}), using directly`);
        
        // Verify the AI match against the database
        const dmeInfo = await lookupDMECode(aiMatch.code);
        
        if (dmeInfo) {
          console.log(`[DME_MATCHER] Verified AI match in database: ${dmeInfo.code}`);
          
          // If we have an extracted code, check if it matches the AI suggestion
          if (extractedCode && extractedCode === aiMatch.code) {
            console.log(`[DME_MATCHER] AI match confirmed by extracted code: ${extractedCode}`);
            return {
              matched: true,
              ...dmeInfo,
              confidence: Math.max(aiMatch.confidence, 0.95), // Boost confidence due to code confirmation
              reasoning: aiMatch.reasoning + " (Confirmed by extracted code)",
              matchMethod: 'ai_match_code_confirmed'
            };
          }
          
          return {
            matched: true,
            ...dmeInfo,
            confidence: aiMatch.confidence,
            reasoning: aiMatch.reasoning,
            matchMethod: 'ai_match_primary'
          };
        } else {
          console.log(`[DME_MATCHER] AI match ${aiMatch.code} not found in database, returning AI result only`);
          return {
            matched: true,
            code: aiMatch.code,
            description: aiMatch.suggestedDescription || service.description,
            confidence: aiMatch.confidence * 0.9, // Slightly reduce confidence for unverified matches
            reasoning: aiMatch.reasoning + " (Note: No price data available for this DME code)",
            matchMethod: 'ai_match_unverified',
            price: null
          };
        }
      } else {
        console.log(`[DME_MATCHER] Low confidence AI match (${aiMatch.confidence.toFixed(2)}), checking alternatives`);
      }
    } else {
      console.log(`[DME_MATCHER] OpenAI failed to provide a match, falling back to code lookup`);
    }
    
    // STEP 3: If AI confidence is low or AI failed, try using the extracted code
    if (extractedCode) {
      console.log(`[DME_MATCHER] Trying direct code lookup with extracted code: ${extractedCode}`);
      const dmeInfo = await lookupDMECode(extractedCode);
      
      if (dmeInfo) {
        console.log(`[DME_MATCHER] Found direct match in DME database: ${extractedCode}`);
        return {
          matched: true,
          ...dmeInfo,
          confidence: 0.95, // High confidence for direct code match
          reasoning: `Direct match by code ${extractedCode}`,
          matchMethod: 'direct_code_match'
        };
      } else {
        console.log(`[DME_MATCHER] Extracted code ${extractedCode} not found in database`);
      }
    }
    
    // STEP 4: If we have a low-confidence AI match but nothing else worked, use it as fallback
    if (aiMatch) {
      console.log(`[DME_MATCHER] Using low confidence AI match as fallback: ${aiMatch.code} (${aiMatch.confidence.toFixed(2)})`);
      
      // Try to verify it against the database one more time
      const dmeInfo = await lookupDMECode(aiMatch.code);
      
      if (dmeInfo) {
        return {
          matched: true,
          ...dmeInfo,
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
        reasoning: aiMatch.reasoning + " (Note: No price data available for this DME code)",
        matchMethod: 'ai_match_fallback_unverified',
        price: null
      };
    }
    
    // STEP 5: Last resort - try category-based matching
    console.log(`[DME_MATCHER] All primary methods failed, attempting category-based matching`);
    const categoryMatch = findMatchByCategory(service.description);
    
    if (categoryMatch) {
      console.log(`[DME_MATCHER] Found category-based match: ${categoryMatch.code} (${categoryMatch.confidence.toFixed(2)})`);
      return {
        matched: true,
        ...categoryMatch,
        matchMethod: 'category_match_last_resort'
      };
    }
    
    console.log(`[DME_MATCHER] No match found for service: "${service.description}"`);
    return {
      matched: false,
      confidence: 0,
      reasoning: 'No matching DME code found in database'
    };
  } catch (error) {
    console.error('[DME_MATCHER] Error matching DME:', error);
    return {
      matched: false,
      confidence: 0,
      reasoning: `Error matching DME: ${error.message}`
    };
  }
}

/**
 * Look up a DME code in the database
 * @param {string} code - The DME code to look up
 * @returns {Promise<Object|null>} - The DME information or null
 */
async function lookupDMECode(code) {
  try {
    console.log(`[DME_MATCHER] Looking up DME code: ${code}`);
    
    // Check pricing map first
    if (dmePricingMap.has(code)) {
      const data = dmePricingMap.get(code);
      console.log(`[DME_MATCHER] Found DME code in pricing map: ${code}`);
      return data;
    }
    
    // Try to find in Firestore if available
    try {
      if (db) {
        const docRef = db.collection('dmeCodes').doc(code);
        const doc = await docRef.get();
        
        if (doc.exists) {
          const data = doc.data();
          console.log(`[DME_MATCHER] Found DME code in Firestore: ${code}`);
          return data;
        }
      }
    } catch (firestoreError) {
      console.error('[DME_MATCHER] Firestore error:', firestoreError.message);
    }
    
    console.log(`[DME_MATCHER] No DME code found for: ${code}`);
    return null;
  } catch (error) {
    console.error('[DME_MATCHER] Error looking up DME code:', error);
    return null;
  }
}

/**
 * Extract a DME code from a service description
 * @param {string} description - The service description
 * @returns {string|null} - The extracted code or null
 */
function extractCodeFromDescription(description) {
  if (!description) return null;
  
  // Look for patterns like "HCPCS: E1234" or "DME K1234" or just "E1234"
  const codePatterns = [
    /HCPCS:?\s*([EKL][0-9]{4})/i,
    /DME:?\s*([EKL][0-9]{4})/i,
    /Code:?\s*([EKL][0-9]{4})/i,
    /([EKL][0-9]{4})/i
  ];
  
  for (const pattern of codePatterns) {
    const match = description.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }
  
  return null;
}

/**
 * Find a match using OpenAI's semantic understanding
 * @param {object} service - The service object with description
 * @param {object} additionalContext - Additional context about the service
 * @returns {Promise<object|null>} - The matched DME information or null
 */
async function findMatchWithOpenAI(service, additionalContext = {}) {
  try {
    console.log(`[DME_MATCHER] Finding match with OpenAI for: "${service.description}"`);
    
    // Create a more robust prompt for OpenAI
    let prompt = `I need to find the most appropriate DME (Durable Medical Equipment) code for this medical service:

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
    
    prompt += `\n\nThis is for DME (Durable Medical Equipment) coding. Please provide the most appropriate HCPCS code that would be used for billing this equipment or supply.

For DME services, consider the following:
1. E-codes (E0100-E9999) for medical equipment
2. K-codes (K0001-K9999) for specialized equipment and supplies
3. L-codes (L0000-L9999) for orthotic and prosthetic devices
4. Consider both rental and purchase scenarios
5. Pay attention to any specifications or features mentioned

Your task is to determine the most specific and accurate code that represents this DME item.

Respond in JSON format with the following structure:
{
  "code": "E1234",
  "suggestedDescription": "Standard description of the DME item",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this code is appropriate"
}

The confidence should reflect your certainty in the match, with values:
- 0.9-1.0: Very high confidence (exact match)
- 0.8-0.89: High confidence (strong match)
- 0.7-0.79: Good confidence (likely match)
- 0.5-0.69: Moderate confidence (possible match)
- <0.5: Low confidence (uncertain match)`;

    console.log('[DME_MATCHER] Calling OpenAI API for DME code matching');
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are a DME coding expert specializing in HCPCS codes for medical equipment and supplies. Your task is to match service descriptions to the most appropriate DME codes. Be precise and consider equipment specifications, features, and intended use. Provide detailed reasoning for your code selection.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });
    
    // Parse the response
    const result = JSON.parse(response.choices[0].message.content);
    console.log('[DME_MATCHER] OpenAI response:', JSON.stringify(result, null, 2));
    
    // Validate the code format (E, K, or L codes)
    const isValidCode = /^[EKL]\d{4}$/i.test(result.code);
    
    if (!isValidCode) {
      console.warn('[DME_MATCHER] OpenAI returned invalid code format:', result.code);
      return null;
    }
    
    return {
      code: result.code.toUpperCase(),
      suggestedDescription: result.suggestedDescription,
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning || 'Matched using AI'
    };
  } catch (error) {
    console.error('[DME_MATCHER] Error finding match with OpenAI:', error);
    return null;
  }
}

/**
 * Find a match by DME category and keywords
 * @param {string} description - The service description
 * @returns {Object|null} - The matched DME information or null
 */
function findMatchByCategory(description) {
  try {
    if (!description) return null;
    
    console.log(`[DME_MATCHER] Finding match by category for: "${description}"`);
    
    const normalizedDesc = description.toLowerCase();
    
    // First check for exact matches in the DME name map
    if (dmeNameMap.has(normalizedDesc)) {
      const match = dmeNameMap.get(normalizedDesc);
      console.log(`[DME_MATCHER] Found exact name match: ${match.code}`);
      return {
        ...match,
        confidence: 0.95
      };
    }
    
    // Check each DME category
    for (const [category, keywords] of Object.entries(dmeCategories)) {
      for (const keyword of keywords) {
        if (normalizedDesc.includes(keyword)) {
          // Find the best matching DME code for this category
          let bestMatch = null;
          let bestScore = 0;
          
          for (const dme of dmePricingMap.values()) {
            if (dme.category === category) {
              const score = calculateMatchScore(normalizedDesc, dme.description.toLowerCase());
              if (score > 0.6 && score > bestScore) {
                bestScore = score;
                bestMatch = { ...dme, confidence: score };
              }
            }
          }
          
          if (bestMatch) {
            console.log(`[DME_MATCHER] Found category match through keyword "${keyword}": ${bestMatch.code}`);
            return bestMatch;
          }
        }
      }
    }
    
    console.log('[DME_MATCHER] No category-based match found');
    return null;
  } catch (error) {
    console.error('[DME_MATCHER] Error finding match by category:', error);
    return null;
  }
}

/**
 * Calculate match score between service description and DME descriptions
 * @param {string} serviceDesc - The service description
 * @param {string} dmeDesc - The DME description
 * @returns {number} - Match score between 0 and 1
 */
function calculateMatchScore(serviceDesc, dmeDesc) {
  // Important DME terms that should have higher weight
  const importantTerms = [
    'wheelchair', 'oxygen', 'cpap', 'bipap', 'hospital bed',
    'walker', 'crutches', 'prosthetic', 'orthotic', 'brace',
    'pump', 'monitor', 'ventilator', 'lift', 'scooter'
  ];
  
  const serviceWords = serviceDesc.split(/\s+/).filter(w => w.length > 2);
  const dmeWords = dmeDesc.split(/\s+/).filter(w => w.length > 2);
  
  let totalWeight = 0;
  let matchWeight = 0;
  
  for (const word of serviceWords) {
    const weight = importantTerms.some(term => term.includes(word)) ? 2 : 1;
    totalWeight += weight;
    
    if (dmeWords.includes(word)) {
      matchWeight += weight;
    }
  }
  
  return totalWeight > 0 ? matchWeight / totalWeight : 0;
}

/**
 * Generate keywords from a description
 * @param {string} description - The description to generate keywords from
 * @returns {string[]} - Array of keywords
 */
function generateKeywords(description) {
  if (!description) return [];
  
  // Common DME stopwords to filter out
  const stopwords = ['the', 'and', 'for', 'with', 'of', 'to', 'in', 'on', 'at', 'by', 'or',
                    'each', 'per', 'unit', 'item', 'equipment', 'supply', 'device'];
  
  // Split, filter and return unique keywords
  return [...new Set(
    description
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(' ')
      .filter(word => word.length > 2 && !stopwords.includes(word))
      .map(word => word.trim())
  )];
}

export {
  matchServiceToDME,
  lookupDMECode
}; 