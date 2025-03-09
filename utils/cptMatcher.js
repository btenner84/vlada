import { adminDb } from '../firebase/admin';
import { OpenAI } from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Use the existing Firebase Admin instance
const db = adminDb;

/**
 * Match a service description to a CPT code
 * @param {string} serviceDescription - The service description from the bill
 * @param {object} additionalContext - Additional context about the service
 * @param {string} extractedCode - CPT code directly extracted from the bill (if available)
 * @returns {Promise<object|null>} - The matched CPT code information or null
 */
export async function matchServiceToCPT(serviceDescription, additionalContext = {}, extractedCode = null) {
  try {
    console.log(`[CPT_MATCHER] Starting CPT code matching for: "${serviceDescription}"`);
    console.log(`[CPT_MATCHER] Additional context:`, JSON.stringify(additionalContext));
    
    if (extractedCode) {
      console.log(`[CPT_MATCHER] Extracted CPT code provided: ${extractedCode}`);
      
      // Validate the extracted code format
      const isValidCode = /^\d{5}$/.test(extractedCode) || /^[A-Z]\d{4}$/.test(extractedCode);
      
      if (isValidCode) {
        // Look up the extracted code in the database
        console.log(`[CPT_MATCHER] Looking up extracted code in database: ${extractedCode}`);
        const codeMatch = await lookupCPTCode(extractedCode);
        
        if (codeMatch) {
          console.log(`[CPT_MATCHER] Found extracted code in database: ${extractedCode}`);
          return {
            ...codeMatch,
            matchMethod: 'extracted_code'
          };
        } else {
          console.log(`[CPT_MATCHER] Extracted code not found in database: ${extractedCode}`);
        }
      } else {
        console.log(`[CPT_MATCHER] Extracted code has invalid format: ${extractedCode}`);
      }
    }
    
    if (!serviceDescription) {
      console.warn('[CPT_MATCHER] Empty service description provided to matchServiceToCPT');
      return null;
    }
    
    // Step 1: Try exact match first (case insensitive)
    console.log('[CPT_MATCHER] Attempting exact match first');
    const exactMatch = await findExactMatch(serviceDescription);
    if (exactMatch) {
      console.log(`[CPT_MATCHER] Found exact match: ${exactMatch.cptCode}`);
      return {
        ...exactMatch,
        matchMethod: 'exact_match'
      };
    }
    
    // Step 2: Try database matching with keywords
    let dbMatch = null;
    if (db) {
      console.log('[CPT_MATCHER] Database available, attempting database matching');
      dbMatch = await findMatchInDatabase(serviceDescription);
      
      // If we have a high confidence match, return it
      if (dbMatch && dbMatch.confidence >= 0.7) {
        console.log(`[CPT_MATCHER] Found high confidence database match: ${dbMatch.cptCode} (${dbMatch.confidence.toFixed(2)})`);
        return {
          ...dbMatch,
          matchMethod: 'database'
        };
      }
    } else {
      console.log('[CPT_MATCHER] Database not available, skipping database matching');
    }
    
    // Step 3: Use OpenAI for semantic matching
    console.log(`[CPT_MATCHER] No high confidence database match found. Using OpenAI.`);
    const aiMatch = await findMatchWithOpenAI(serviceDescription, dbMatch, additionalContext);
    
    if (aiMatch) {
      console.log(`[CPT_MATCHER] Found OpenAI match: ${aiMatch.cptCode}`);
      
      // Step 4: Verify the AI match against the database if possible
      if (db) {
        const verifiedMatch = await verifyAIMatchWithDatabase(aiMatch.cptCode, serviceDescription);
        if (verifiedMatch) {
          console.log(`[CPT_MATCHER] Verified AI match with database: ${verifiedMatch.cptCode}`);
          return {
            ...verifiedMatch,
            reasoning: aiMatch.reasoning,
            matchMethod: 'openai_verified'
          };
        }
      }
      
      return {
        ...aiMatch,
        matchMethod: 'openai'
      };
    }
    
    // Step 5: If still no match, return the database match if it exists (even with low confidence)
    if (dbMatch) {
      console.log(`[CPT_MATCHER] Using low confidence database match as fallback: ${dbMatch.cptCode} (${dbMatch.confidence.toFixed(2)})`);
      return {
        ...dbMatch,
        matchMethod: 'database_low_confidence'
      };
    }
    
    console.log(`[CPT_MATCHER] No match found for service: "${serviceDescription}"`);
    return null;
  } catch (error) {
    console.error('[CPT_MATCHER] Error matching service to CPT:', error);
    return null;
  }
}

/**
 * Look up a CPT code in the database
 * @param {string} cptCode - The CPT code to look up
 * @returns {Promise<object|null>} - The CPT code information or null
 */
async function lookupCPTCode(cptCode) {
  try {
    console.log(`[CPT_MATCHER_LOOKUP] Looking up CPT code: ${cptCode}`);
    
    // Query the database for the CPT code
    const querySnapshot = await db.collection('cptCodeMappings')
      .where('code', '==', cptCode)
      .limit(1)
      .get();
    
    if (querySnapshot.empty) {
      console.log(`[CPT_MATCHER_LOOKUP] CPT code ${cptCode} not found in database`);
      return null;
    }
    
    const data = querySnapshot.docs[0].data();
    console.log(`[CPT_MATCHER_LOOKUP] Found CPT code in database: ${data.code} - "${data.description}"`);
    
    return {
      cptCode: data.code,
      description: data.description,
      confidence: 1.0, // High confidence since it's a direct code lookup
      nonFacilityRate: data.nonFacilityRate || null,
      facilityRate: data.facilityRate || null
    };
  } catch (error) {
    console.error('[CPT_MATCHER_LOOKUP] Error looking up CPT code:', error);
    return null;
  }
}

/**
 * Find an exact match in the CPT code database
 * @param {string} serviceDescription - The service description from the bill
 * @returns {Promise<object|null>} - The matched CPT code information or null
 */
async function findExactMatch(serviceDescription) {
  try {
    console.log(`[CPT_MATCHER_EXACT] Attempting exact match for: "${serviceDescription}"`);
    
    // Normalize the description
    const normalizedDesc = serviceDescription.toLowerCase().trim();
    
    // Query the database for exact matches
    const querySnapshot = await db.collection('cptCodeMappings')
      .where('description', '==', normalizedDesc)
      .limit(1)
      .get();
    
    if (querySnapshot.empty) {
      // Try with a more flexible approach - check if the service description is contained in any CPT description
      const allCodesSnapshot = await db.collection('cptCodeMappings')
        .limit(1000) // Limit to prevent excessive processing
        .get();
      
      const exactMatches = [];
      
      allCodesSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.description.includes(normalizedDesc) || normalizedDesc.includes(data.description)) {
          exactMatches.push({
            cptCode: data.code,
            description: data.description,
            confidence: calculateExactMatchConfidence(normalizedDesc, data.description),
            nonFacilityRate: data.nonFacilityRate || null,
            facilityRate: data.facilityRate || null
          });
        }
      });
      
      if (exactMatches.length > 0) {
        // Sort by confidence and return the best match
        exactMatches.sort((a, b) => b.confidence - a.confidence);
        console.log(`[CPT_MATCHER_EXACT] Found partial exact match: ${exactMatches[0].cptCode} (${exactMatches[0].confidence.toFixed(2)})`);
        return exactMatches[0];
      }
      
      console.log('[CPT_MATCHER_EXACT] No exact match found');
      return null;
    }
    
    const data = querySnapshot.docs[0].data();
    console.log(`[CPT_MATCHER_EXACT] Found exact match: ${data.code}`);
    
    return {
      cptCode: data.code,
      description: data.description,
      confidence: 1.0,
      nonFacilityRate: data.nonFacilityRate || null,
      facilityRate: data.facilityRate || null
    };
  } catch (error) {
    console.error('[CPT_MATCHER_EXACT] Error finding exact match:', error);
    return null;
  }
}

/**
 * Calculate confidence for exact match based on string similarity
 * @param {string} serviceDesc - The service description from the bill
 * @param {string} cptDesc - The CPT code description from the database
 * @returns {number} - Confidence score between 0 and 1
 */
function calculateExactMatchConfidence(serviceDesc, cptDesc) {
  // If one string contains the other completely, high confidence
  if (serviceDesc.includes(cptDesc)) {
    return 0.9;
  }
  if (cptDesc.includes(serviceDesc)) {
    return 0.85;
  }
  
  // Calculate Jaccard similarity for partial matches
  const serviceWords = new Set(serviceDesc.split(' '));
  const cptWords = new Set(cptDesc.split(' '));
  
  const intersection = new Set([...serviceWords].filter(word => cptWords.has(word)));
  const union = new Set([...serviceWords, ...cptWords]);
  
  return intersection.size / union.size;
}

/**
 * Find a match in the CPT code database using keyword matching
 * @param {string} serviceDescription - The service description from the bill
 * @returns {Promise<object|null>} - The matched CPT code information or null
 */
async function findMatchInDatabase(serviceDescription) {
  try {
    console.log(`[CPT_MATCHER_DB] Starting database matching for: "${serviceDescription}"`);
    
    // Normalize the description
    const normalizedDesc = serviceDescription.toLowerCase().trim();
    
    // Extract keywords
    const keywords = extractKeywords(normalizedDesc);
    
    if (keywords.length === 0) {
      console.log('[CPT_MATCHER_DB] No keywords extracted from service description');
      return null;
    }
    
    console.log(`[CPT_MATCHER_DB] Extracted keywords: ${keywords.join(', ')}`);
    
    // Query the database for potential matches
    console.log('[CPT_MATCHER_DB] Querying Firestore collection: cptCodeMappings');
    const querySnapshot = await db.collection('cptCodeMappings')
      .where('keywords', 'array-contains-any', keywords)
      .limit(20) // Increased from 10 to get more potential matches
      .get();
    
    if (querySnapshot.empty) {
      console.log('[CPT_MATCHER_DB] No matches found in database');
      return null;
    }
    
    console.log(`[CPT_MATCHER_DB] Found ${querySnapshot.size} potential matches in database`);
    
    // Score each potential match
    const scoredMatches = querySnapshot.docs.map(doc => {
      const data = doc.data();
      const score = calculateMatchScore(normalizedDesc, data.description, keywords);
      
      console.log(`[CPT_MATCHER_DB] Potential match: ${data.code} - "${data.description}" - Score: ${score.toFixed(2)}`);
      
      return {
        cptCode: data.code,
        description: data.description,
        confidence: score,
        nonFacilityRate: data.nonFacilityRate || null,
        facilityRate: data.facilityRate || null
      };
    });
    
    // Sort by score and return the best match
    scoredMatches.sort((a, b) => b.confidence - a.confidence);
    
    if (scoredMatches.length > 0) {
      console.log(`[CPT_MATCHER_DB] Best database match: ${scoredMatches[0].cptCode} (${scoredMatches[0].confidence.toFixed(2)})`);
      console.log(`[CPT_MATCHER_DB] Match description: ${scoredMatches[0].description}`);
    }
    
    return scoredMatches[0];
  } catch (error) {
    console.error('[CPT_MATCHER_DB] Error finding match in database:', error);
    return null;
  }
}

/**
 * Verify an AI-generated match against the database
 * @param {string} cptCode - The CPT code from AI
 * @param {string} serviceDescription - The original service description
 * @returns {Promise<object|null>} - The verified match or null
 */
async function verifyAIMatchWithDatabase(cptCode, serviceDescription) {
  try {
    console.log(`[CPT_MATCHER_VERIFY] Verifying AI match: ${cptCode} for "${serviceDescription}"`);
    
    // Look up the CPT code in the database
    const querySnapshot = await db.collection('cptCodeMappings')
      .where('code', '==', cptCode)
      .limit(1)
      .get();
    
    if (querySnapshot.empty) {
      console.log(`[CPT_MATCHER_VERIFY] CPT code ${cptCode} not found in database`);
      return null;
    }
    
    const data = querySnapshot.docs[0].data();
    console.log(`[CPT_MATCHER_VERIFY] Found CPT code in database: ${data.code} - "${data.description}"`);
    
    // Calculate match score between service description and CPT description
    const normalizedDesc = serviceDescription.toLowerCase().trim();
    const keywords = extractKeywords(normalizedDesc);
    const score = calculateMatchScore(normalizedDesc, data.description, keywords);
    
    console.log(`[CPT_MATCHER_VERIFY] Verification score: ${score.toFixed(2)}`);
    
    return {
      cptCode: data.code,
      description: data.description,
      confidence: Math.max(score, 0.7), // Minimum confidence of 0.7 since it was AI-matched
      nonFacilityRate: data.nonFacilityRate || null,
      facilityRate: data.facilityRate || null
    };
  } catch (error) {
    console.error('[CPT_MATCHER_VERIFY] Error verifying AI match:', error);
    return null;
  }
}

/**
 * Find a match using OpenAI
 * @param {string} serviceDescription - The service description from the bill
 * @param {object|null} dbMatch - The best database match (if any)
 * @param {object} additionalContext - Additional context about the service
 * @returns {Promise<object|null>} - The matched CPT code information or null
 */
async function findMatchWithOpenAI(serviceDescription, dbMatch = null, additionalContext = {}) {
  try {
    console.log(`[CPT_MATCHER_AI] Starting OpenAI matching for: "${serviceDescription}"`);
    
    // Prepare context for the prompt
    const { patientAge, serviceDate, providerSpecialty, facilityType } = additionalContext;
    
    // Create a prompt that includes any database match as context
    let prompt = `I need to find the correct CPT/HCPCS code for this medical service description:
    
"${serviceDescription}"

Additional context:
${patientAge ? `- Patient Age: ${patientAge}` : ''}
${serviceDate ? `- Service Date: ${serviceDate}` : ''}
${providerSpecialty ? `- Provider Specialty: ${providerSpecialty}` : ''}
${facilityType ? `- Facility Type: ${facilityType}` : ''}
`;

    // If we have a database match but low confidence, include it as a suggestion
    if (dbMatch) {
      prompt += `\nA possible match from our database is CPT code ${dbMatch.cptCode} (${dbMatch.description}) with ${Math.round(dbMatch.confidence * 100)}% confidence.`;
    }
    
    // Add specific instructions for common medical services
    prompt += `\nPlease note:
- For ear and throat examinations, consider codes like 92502 (otolaryngologic examination)
- For full check-ups, consider preventive medicine codes (99381-99397) based on patient age
- For specific body part examinations, consider the appropriate E/M or specialized examination code
`;
    
    prompt += `\nPlease provide the most appropriate CPT/HCPCS code for this service. Respond in JSON format with the following structure:
{
  "cptCode": "12345",
  "description": "Standard description of the CPT code",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this code is appropriate"
}`;

    console.log('[CPT_MATCHER_AI] Calling OpenAI API for CPT code matching');
    console.log('[CPT_MATCHER_AI] Prompt:', prompt);
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are a medical coding expert specializing in CPT/HCPCS codes. Your task is to match service descriptions to the most appropriate code. Be precise and consider the exact wording of the service description. For example, "Ear and throat examination" should match to 92502 (otolaryngologic examination).' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });
    
    // Parse the response
    const result = JSON.parse(response.choices[0].message.content);
    console.log('[CPT_MATCHER_AI] OpenAI response:', JSON.stringify(result, null, 2));
    
    // Validate the CPT code format (5 digits for CPT, alphanumeric for HCPCS)
    const isValidCode = /^\d{5}$/.test(result.cptCode) || /^[A-Z]\d{4}$/.test(result.cptCode);
    
    if (!isValidCode) {
      console.warn('[CPT_MATCHER_AI] OpenAI returned invalid code format:', result.cptCode);
      return null;
    }
    
    return {
      cptCode: result.cptCode,
      description: result.description || serviceDescription,
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning || 'Matched using AI'
    };
  } catch (error) {
    console.error('[CPT_MATCHER_AI] Error finding match with OpenAI:', error);
    return null;
  }
}

/**
 * Extract keywords from a service description
 * @param {string} description - The service description
 * @returns {string[]} - Array of keywords
 */
function extractKeywords(description) {
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
 * Calculate a match score between service description and CPT description
 * @param {string} serviceDesc - The service description from the bill
 * @param {string} cptDesc - The CPT code description from the database
 * @param {string[]} serviceKeywords - Keywords from the service description
 * @returns {number} - Match score between 0 and 1
 */
function calculateMatchScore(serviceDesc, cptDesc, serviceKeywords) {
  // Enhanced implementation with more sophisticated scoring
  
  // 1. Count matching keywords
  const cptKeywords = extractKeywords(cptDesc);
  const matchingKeywords = serviceKeywords.filter(keyword => 
    cptDesc.includes(keyword) || cptKeywords.includes(keyword)
  );
  
  // 2. Calculate keyword match ratio
  const keywordScore = matchingKeywords.length / Math.max(serviceKeywords.length, 1);
  
  // 3. Calculate word overlap
  const serviceWords = new Set(serviceDesc.split(' '));
  const cptWords = new Set(cptDesc.split(' '));
  const overlapCount = [...serviceWords].filter(word => cptWords.has(word)).length;
  const overlapScore = overlapCount / Math.max(serviceWords.size, 1);
  
  // 4. Check for exact phrase matches
  let phraseScore = 0;
  if (cptDesc.includes(serviceDesc)) {
    phraseScore = 0.9; // High score if CPT description contains the entire service description
  } else if (serviceDesc.includes(cptDesc)) {
    phraseScore = 0.8; // Good score if service description contains the entire CPT description
  } else {
    // Check for partial phrase matches
    const serviceTokens = serviceDesc.split(' ');
    for (let i = 0; i < serviceTokens.length - 1; i++) {
      const phrase = serviceTokens.slice(i, i + 2).join(' ');
      if (cptDesc.includes(phrase)) {
        phraseScore = Math.max(phraseScore, 0.6); // Moderate score for matching a 2-word phrase
      }
    }
  }
  
  // 5. Calculate final score (weighted average)
  return (keywordScore * 0.4) + (overlapScore * 0.3) + (phraseScore * 0.3);
} 