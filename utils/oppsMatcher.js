import { adminDb } from '../firebase/admin.js';
import { OpenAI } from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Use the existing Firebase Admin instance
const db = adminDb;

/**
 * Match a service to the OPPS database for facility component pricing
 * @param {object} service - The service object with description and code
 * @param {object} additionalContext - Additional context about the service
 * @returns {Promise<object|null>} - The matched OPPS information or null
 */
async function matchServiceToOPPS(service, additionalContext = {}) {
  try {
    console.log(`[OPPS_MATCHER] Starting OPPS matching for: "${service.description}"`);
    
    // Extract the code if available
    const code = service.code || extractCodeFromDescription(service.description);
    
    if (code) {
      console.log(`[OPPS_MATCHER] Using code for lookup: ${code}`);
      
      // Look up the code in the OPPS database
      const oppsMatch = await lookupOPPSCode(code);
      
      if (oppsMatch) {
        console.log(`[OPPS_MATCHER] Found direct match in OPPS database: ${code}`);
        return {
          ...oppsMatch,
          matchMethod: 'direct_code_match'
        };
      } else {
        console.log(`[OPPS_MATCHER] Code ${code} not found in OPPS database`);
      }
    }
    
    // If no code or code not found, try matching by description
    console.log(`[OPPS_MATCHER] Attempting to match by description: "${service.description}"`);
    
    // Try keyword matching first
    const keywordMatch = await findMatchByKeywords(service.description);
    
    if (keywordMatch && keywordMatch.confidence > 0.7) {
      console.log(`[OPPS_MATCHER] Found keyword match: ${keywordMatch.code} (${keywordMatch.confidence.toFixed(2)})`);
      return {
        ...keywordMatch,
        matchMethod: 'keyword_match'
      };
    }
    
    // If no good keyword match, try AI matching
    console.log(`[OPPS_MATCHER] No strong keyword match found, trying AI matching`);
    const aiMatch = await findMatchWithOpenAI(service, additionalContext);
    
    if (aiMatch) {
      console.log(`[OPPS_MATCHER] Found AI match: ${aiMatch.code}`);
      
      // Verify the AI match against the database
      const verifiedMatch = await lookupOPPSCode(aiMatch.code);
      
      if (verifiedMatch) {
        console.log(`[OPPS_MATCHER] Verified AI match in database: ${verifiedMatch.code}`);
        return {
          ...verifiedMatch,
          confidence: aiMatch.confidence,
          reasoning: aiMatch.reasoning,
          matchMethod: 'ai_match'
        };
      } else {
        console.log(`[OPPS_MATCHER] AI match ${aiMatch.code} not found in database`);
      }
    }
    
    // If we have a low-confidence keyword match, return it as a fallback
    if (keywordMatch) {
      console.log(`[OPPS_MATCHER] Using low confidence keyword match as fallback: ${keywordMatch.code} (${keywordMatch.confidence.toFixed(2)})`);
      return {
        ...keywordMatch,
        matchMethod: 'keyword_match_low_confidence'
      };
    }
    
    console.log(`[OPPS_MATCHER] No match found for service: "${service.description}"`);
    return null;
  } catch (error) {
    console.error('[OPPS_MATCHER] Error matching service to OPPS:', error);
    return null;
  }
}

/**
 * Look up a code in the OPPS database
 * @param {string} code - The CPT/HCPCS code to look up
 * @returns {Promise<object|null>} - The OPPS information or null
 */
async function lookupOPPSCode(code) {
  try {
    console.log(`[OPPS_MATCHER] Looking up code in OPPS database: ${code}`);
    
    // Query the database for the code
    const docRef = db.collection('oppsDatabase').doc(code.toString());
    const doc = await docRef.get();
    
    if (!doc.exists) {
      console.log(`[OPPS_MATCHER] Code ${code} not found in OPPS database`);
      return null;
    }
    
    const data = doc.data();
    console.log(`[OPPS_MATCHER] Found code in OPPS database: ${data.code} - "${data.description}"`);
    
    return {
      code: data.code,
      description: data.description,
      apcCode: data.apcCode,
      apcDescription: data.apcDescription,
      paymentRate: data.paymentRate,
      minCopay: data.minCopay,
      status: data.status,
      confidence: 1.0 // High confidence for direct code lookup
    };
  } catch (error) {
    console.error('[OPPS_MATCHER] Error looking up OPPS code:', error);
    return null;
  }
}

/**
 * Extract a CPT/HCPCS code from a service description
 * @param {string} description - The service description
 * @returns {string|null} - The extracted code or null
 */
function extractCodeFromDescription(description) {
  if (!description) return null;
  
  // Look for patterns like "CPT: 12345" or "HCPCS J1234" or just "12345"
  const codePatterns = [
    /CPT:?\s*(\d{5})/i,
    /HCPCS:?\s*([A-Z]\d{4})/i,
    /Code:?\s*(\d{5}|[A-Z]\d{4})/i,
    /(\d{5}|[A-Z]\d{4})/
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
 * Find a match in the OPPS database using keyword matching
 * @param {string} description - The service description
 * @returns {Promise<object|null>} - The matched OPPS information or null
 */
async function findMatchByKeywords(description) {
  try {
    if (!description) return null;
    
    console.log(`[OPPS_MATCHER] Finding match by keywords for: "${description}"`);
    
    // Extract keywords from the description
    const keywords = extractKeywords(description);
    
    if (keywords.length === 0) {
      console.log('[OPPS_MATCHER] No keywords extracted from description');
      return null;
    }
    
    console.log(`[OPPS_MATCHER] Extracted keywords: ${keywords.join(', ')}`);
    
    // Query the database for potential matches
    // Since Firestore doesn't support array-contains-any with more than 10 values,
    // we'll limit to the first 10 keywords
    const limitedKeywords = keywords.slice(0, 10);
    
    // We'll use a simple query approach here - in a real implementation,
    // you might want to use a more sophisticated search mechanism like Algolia
    const querySnapshot = await db.collection('oppsDatabase')
      .limit(20)
      .get();
    
    if (querySnapshot.empty) {
      console.log('[OPPS_MATCHER] No potential matches found in database');
      return null;
    }
    
    // Score each potential match
    const scoredMatches = [];
    
    querySnapshot.forEach(doc => {
      const data = doc.data();
      const score = calculateMatchScore(description, data.description, keywords);
      
      if (score > 0.3) { // Only consider matches with some relevance
        scoredMatches.push({
          code: data.code,
          description: data.description,
          apcCode: data.apcCode,
          apcDescription: data.apcDescription,
          paymentRate: data.paymentRate,
          minCopay: data.minCopay,
          status: data.status,
          confidence: score
        });
      }
    });
    
    // Sort by score and return the best match
    scoredMatches.sort((a, b) => b.confidence - a.confidence);
    
    if (scoredMatches.length > 0) {
      console.log(`[OPPS_MATCHER] Best keyword match: ${scoredMatches[0].code} (${scoredMatches[0].confidence.toFixed(2)})`);
      return scoredMatches[0];
    }
    
    console.log('[OPPS_MATCHER] No keyword matches found');
    return null;
  } catch (error) {
    console.error('[OPPS_MATCHER] Error finding match by keywords:', error);
    return null;
  }
}

/**
 * Find a match using OpenAI's semantic understanding
 * @param {object} service - The service object with description
 * @param {object} additionalContext - Additional context about the service
 * @returns {Promise<object|null>} - The matched OPPS information or null
 */
async function findMatchWithOpenAI(service, additionalContext = {}) {
  try {
    console.log(`[OPPS_MATCHER] Finding match with OpenAI for: "${service.description}"`);
    
    // Create a prompt for OpenAI
    let prompt = `I need to find the most appropriate CPT/HCPCS code for this outpatient facility service:

Service Description: "${service.description}"`;

    // Add service category if available
    if (additionalContext.category) {
      prompt += `\nService Category: ${additionalContext.category}`;
    }

    // Add service setting if available
    if (additionalContext.setting) {
      prompt += `\nService Setting: ${additionalContext.setting}`;
    }
    
    // Add facility type if available
    if (additionalContext.facilityType) {
      prompt += `\nFacility Type: ${additionalContext.facilityType}`;
    }
    
    prompt += `\n\nThis is for the facility component (OPPS) of an outpatient procedure. Please provide the most appropriate CPT/HCPCS code that would be used for hospital outpatient billing.

Respond in JSON format with the following structure:
{
  "code": "12345",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this code is appropriate"
}`;

    console.log('[OPPS_MATCHER] Calling OpenAI API for OPPS code matching');
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are a medical coding expert specializing in hospital outpatient billing and OPPS (Outpatient Prospective Payment System). Your task is to match service descriptions to the most appropriate CPT/HCPCS code for facility billing.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });
    
    // Parse the response
    const result = JSON.parse(response.choices[0].message.content);
    console.log('[OPPS_MATCHER] OpenAI response:', JSON.stringify(result, null, 2));
    
    // Validate the code format (5 digits for CPT, alphanumeric for HCPCS)
    const isValidCode = /^\d{5}$/.test(result.code) || /^[A-Z]\d{4}$/.test(result.code);
    
    if (!isValidCode) {
      console.warn('[OPPS_MATCHER] OpenAI returned invalid code format:', result.code);
      return null;
    }
    
    return {
      code: result.code,
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning || 'Matched using AI'
    };
  } catch (error) {
    console.error('[OPPS_MATCHER] Error finding match with OpenAI:', error);
    return null;
  }
}

/**
 * Extract keywords from a service description
 * @param {string} description - The service description
 * @returns {string[]} - Array of keywords
 */
function extractKeywords(description) {
  if (!description) return [];
  
  // Common medical stopwords to filter out
  const stopwords = ['the', 'and', 'for', 'with', 'of', 'to', 'in', 'on', 'at', 'by', 'or', 
                     'patient', 'service', 'procedure', 'treatment', 'medical', 'care'];
  
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

/**
 * Calculate a match score between service description and OPPS description
 * @param {string} serviceDesc - The service description
 * @param {string} oppsDesc - The OPPS code description
 * @param {string[]} serviceKeywords - Keywords from the service description
 * @returns {number} - Match score between 0 and 1
 */
function calculateMatchScore(serviceDesc, oppsDesc, serviceKeywords) {
  if (!serviceDesc || !oppsDesc) return 0;
  
  // Normalize descriptions
  const normalizedServiceDesc = serviceDesc.toLowerCase();
  const normalizedOPPSDesc = oppsDesc.toLowerCase();
  
  // 1. Count matching keywords
  const oppsKeywords = extractKeywords(normalizedOPPSDesc);
  const matchingKeywords = serviceKeywords.filter(keyword => 
    normalizedOPPSDesc.includes(keyword) || oppsKeywords.includes(keyword)
  );
  
  // 2. Calculate keyword match ratio
  const keywordScore = matchingKeywords.length / Math.max(serviceKeywords.length, 1);
  
  // 3. Calculate word overlap
  const serviceWords = new Set(normalizedServiceDesc.split(' '));
  const oppsWords = new Set(normalizedOPPSDesc.split(' '));
  const overlapCount = [...serviceWords].filter(word => oppsWords.has(word)).length;
  const overlapScore = overlapCount / Math.max(serviceWords.size, 1);
  
  // 4. Check for exact phrase matches
  let phraseScore = 0;
  if (normalizedOPPSDesc.includes(normalizedServiceDesc)) {
    phraseScore = 0.9; // High score if OPPS description contains the entire service description
  } else if (normalizedServiceDesc.includes(normalizedOPPSDesc)) {
    phraseScore = 0.8; // Good score if service description contains the entire OPPS description
  } else {
    // Check for partial phrase matches
    const serviceTokens = normalizedServiceDesc.split(' ');
    for (let i = 0; i < serviceTokens.length - 1; i++) {
      const phrase = serviceTokens.slice(i, i + 2).join(' ');
      if (normalizedOPPSDesc.includes(phrase)) {
        phraseScore = Math.max(phraseScore, 0.6); // Moderate score for matching a 2-word phrase
      }
    }
  }
  
  // 5. Calculate final score (weighted average)
  return (keywordScore * 0.4) + (overlapScore * 0.3) + (phraseScore * 0.3);
}

// Export the main function
export { matchServiceToOPPS, lookupOPPSCode }; 