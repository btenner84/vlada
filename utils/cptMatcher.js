import { adminDb } from '../firebase/admin.js';
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
async function matchServiceToCPT(serviceDescription, additionalContext = {}, extractedCode = null) {
  try {
    console.log(`[CPT_MATCHER] Starting CPT code matching for: "${serviceDescription}"`);
    console.log(`[CPT_MATCHER] Additional context:`, JSON.stringify(additionalContext));
    
    // Get the service category if available
    const serviceCategory = additionalContext.category || null;
    console.log(`[CPT_MATCHER] Service category: ${serviceCategory || 'Not provided'}`);
    
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
    const exactMatch = await findExactMatch(serviceDescription, serviceCategory);
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
      dbMatch = await findMatchInDatabase(serviceDescription, serviceCategory);
      
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
        const verifiedMatch = await verifyAIMatchWithDatabase(aiMatch.cptCode, serviceDescription, serviceCategory);
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
 * @param {string|null} serviceCategory - The service category from additionalContext
 * @returns {Promise<object|null>} - The matched CPT code information or null
 */
async function findExactMatch(serviceDescription, serviceCategory) {
  try {
    console.log(`[CPT_MATCHER_EXACT] Attempting exact match for: "${serviceDescription}"`);
    if (serviceCategory) {
      console.log(`[CPT_MATCHER_EXACT] Using service category: ${serviceCategory}`);
    }
    
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
        // Filter matches by category if available
        let filteredMatches = exactMatches;
        
        if (serviceCategory) {
          // Apply category-specific filtering
          filteredMatches = filterMatchesByCategory(exactMatches, serviceCategory);
          console.log(`[CPT_MATCHER_EXACT] Filtered ${exactMatches.length} matches to ${filteredMatches.length} matches based on category`);
        }
        
        if (filteredMatches.length > 0) {
          // Sort by confidence and return the best match
          filteredMatches.sort((a, b) => b.confidence - a.confidence);
          console.log(`[CPT_MATCHER_EXACT] Found partial exact match: ${filteredMatches[0].cptCode} (${filteredMatches[0].confidence.toFixed(2)})`);
          return filteredMatches[0];
        }
      }
      
      console.log('[CPT_MATCHER_EXACT] No exact match found');
      return null;
    }
    
    // We found an exact match
    const data = querySnapshot.docs[0].data();
    console.log(`[CPT_MATCHER_EXACT] Found exact match: ${data.code} - "${data.description}"`);
    
    // Check if the match aligns with the service category
    if (serviceCategory && !isMatchCompatibleWithCategory(data.code, serviceCategory)) {
      console.log(`[CPT_MATCHER_EXACT] Match ${data.code} is not compatible with category ${serviceCategory}`);
      return null;
    }
    
    return {
      cptCode: data.code,
      description: data.description,
      confidence: 1.0, // High confidence for exact match
      nonFacilityRate: data.nonFacilityRate || null,
      facilityRate: data.facilityRate || null
    };
  } catch (error) {
    console.error('[CPT_MATCHER_EXACT] Error finding exact match:', error);
    return null;
  }
}

/**
 * Filter matches based on service category
 * @param {Array} matches - Array of potential matches
 * @param {string} category - Service category
 * @returns {Array} - Filtered matches
 */
function filterMatchesByCategory(matches, category) {
  // Return all matches if no category is provided
  if (!category) return matches;
  
  return matches.filter(match => isMatchCompatibleWithCategory(match.cptCode, category));
}

/**
 * Check if a CPT/HCPCS code is compatible with a service category
 * @param {string} code - The CPT/HCPCS code
 * @param {string} category - The service category
 * @returns {boolean} - Whether the code is compatible with the category
 */
function isMatchCompatibleWithCategory(code, category) {
  // If no code or category, return true (no filtering)
  if (!code || !category) return true;
  
  // Check compatibility based on code patterns and category
  switch (category) {
    case 'Office visits and Consultations':
      // E&M codes (99201-99499)
      return /^99\d{3}$/.test(code);
      
    case 'Procedures and Surgeries':
      // Surgery codes (10000-69999)
      return /^[1-6]\d{4}$/.test(code);
      
    case 'Lab and Diagnostic Tests':
      // Lab codes (80000-89999) and Radiology codes (70000-79999)
      return /^[78]\d{4}$/.test(code);
      
    case 'Drugs and Infusions':
      // J codes for drugs
      return /^J\d{4}$/.test(code);
      
    case 'Medical Equipment':
      // E codes and K codes for equipment
      return /^[EK]\d{4}$/.test(code);
      
    case 'Hospital stays and emergency care visits':
      // Hospital E&M codes (99217-99239) and ER codes (99281-99288)
      return /^99(2[1-3]\d|28[1-8])$/.test(code);
      
    default:
      // For 'Other' or unknown categories, don't filter
      return true;
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
 * @param {string|null} serviceCategory - The service category from additionalContext
 * @returns {Promise<object|null>} - The matched CPT code information or null
 */
async function findMatchInDatabase(serviceDescription, serviceCategory) {
  try {
    console.log(`[CPT_MATCHER_DB] Starting database matching for: "${serviceDescription}"`);
    if (serviceCategory) {
      console.log(`[CPT_MATCHER_DB] Using service category: ${serviceCategory}`);
    }
    
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
    
    // If we have a category, we can optimize the query to focus on relevant code ranges
    let querySnapshot;
    
    if (serviceCategory) {
      // Get code pattern for the category
      const codePattern = getCategoryCodePattern(serviceCategory);
      
      if (codePattern) {
        console.log(`[CPT_MATCHER_DB] Using category-specific code pattern: ${codePattern}`);
        
        // Query with both keywords and code pattern
        querySnapshot = await db.collection('cptCodeMappings')
          .where('keywords', 'array-contains-any', keywords)
          .where('code', '>=', codePattern.start)
          .where('code', '<=', codePattern.end)
          .limit(20)
          .get();
          
        console.log(`[CPT_MATCHER_DB] Found ${querySnapshot.size} matches with category-specific query`);
        
        // If no results, fall back to keyword-only query
        if (querySnapshot.empty) {
          console.log('[CPT_MATCHER_DB] No matches found with category filter, falling back to keyword-only query');
          querySnapshot = await db.collection('cptCodeMappings')
            .where('keywords', 'array-contains-any', keywords)
            .limit(20)
            .get();
        }
      } else {
        // No specific code pattern for this category, use regular query
        querySnapshot = await db.collection('cptCodeMappings')
          .where('keywords', 'array-contains-any', keywords)
          .limit(20)
          .get();
      }
    } else {
      // No category provided, use regular query
      querySnapshot = await db.collection('cptCodeMappings')
        .where('keywords', 'array-contains-any', keywords)
        .limit(20)
        .get();
    }
    
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
    
    // Filter matches by category if available
    let filteredMatches = scoredMatches;
    
    if (serviceCategory) {
      filteredMatches = filterMatchesByCategory(scoredMatches, serviceCategory);
      console.log(`[CPT_MATCHER_DB] Filtered ${scoredMatches.length} matches to ${filteredMatches.length} matches based on category`);
      
      // If filtering removed all matches, revert to original matches
      if (filteredMatches.length === 0) {
        console.log('[CPT_MATCHER_DB] Category filtering removed all matches, reverting to original matches');
        filteredMatches = scoredMatches;
      }
    }
    
    // Sort by score and return the best match
    filteredMatches.sort((a, b) => b.confidence - a.confidence);
    
    if (filteredMatches.length > 0) {
      console.log(`[CPT_MATCHER_DB] Best database match: ${filteredMatches[0].cptCode} (${filteredMatches[0].confidence.toFixed(2)})`);
      console.log(`[CPT_MATCHER_DB] Match description: ${filteredMatches[0].description}`);
    }
    
    return filteredMatches[0];
  } catch (error) {
    console.error('[CPT_MATCHER_DB] Error finding match in database:', error);
    return null;
  }
}

/**
 * Get code pattern for a specific category
 * @param {string} category - The service category
 * @returns {object|null} - Start and end code for the category
 */
function getCategoryCodePattern(category) {
  switch (category) {
    case 'Office visits and Consultations':
      return { start: '99201', end: '99499' };
      
    case 'Procedures and Surgeries':
      return { start: '10000', end: '69999' };
      
    case 'Lab and Diagnostic Tests':
      // This covers both lab (80000-89999) and radiology (70000-79999)
      return { start: '70000', end: '89999' };
      
    case 'Drugs and Infusions':
      return { start: 'J0000', end: 'J9999' };
      
    case 'Medical Equipment':
      // This is a simplification - we'd need multiple queries for E and K codes
      return { start: 'E0000', end: 'E9999' };
      
    case 'Hospital stays and emergency care visits':
      // Hospital E&M codes
      return { start: '99217', end: '99288' };
      
    default:
      return null;
  }
}

/**
 * Verify an AI-generated match against the database
 * @param {string} cptCode - The CPT code from AI
 * @param {string} serviceDescription - The original service description
 * @param {string|null} serviceCategory - The service category from additionalContext
 * @returns {Promise<object|null>} - The verified match or null
 */
async function verifyAIMatchWithDatabase(cptCode, serviceDescription, serviceCategory) {
  try {
    console.log(`[CPT_MATCHER_VERIFY] Verifying AI match: ${cptCode} for "${serviceDescription}"`);
    if (serviceCategory) {
      console.log(`[CPT_MATCHER_VERIFY] Using service category: ${serviceCategory}`);
    }
    
    // Check if the code is compatible with the service category
    if (serviceCategory && !isMatchCompatibleWithCategory(cptCode, serviceCategory)) {
      console.log(`[CPT_MATCHER_VERIFY] AI match ${cptCode} is not compatible with category ${serviceCategory}`);
      // We'll still continue with verification, but with a note
    }
    
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
    
    // Adjust confidence based on category compatibility
    let adjustedConfidence = Math.max(score, 0.7); // Minimum confidence of 0.7 since it was AI-matched
    
    if (serviceCategory && !isMatchCompatibleWithCategory(cptCode, serviceCategory)) {
      // Reduce confidence if the code doesn't match the category
      adjustedConfidence = Math.min(adjustedConfidence, 0.75);
      console.log(`[CPT_MATCHER_VERIFY] Adjusted confidence due to category mismatch: ${adjustedConfidence.toFixed(2)}`);
    }
    
    return {
      cptCode: data.code,
      description: data.description,
      confidence: adjustedConfidence,
      nonFacilityRate: data.nonFacilityRate || null,
      facilityRate: data.facilityRate || null
    };
  } catch (error) {
    console.error('[CPT_MATCHER_VERIFY] Error verifying AI match:', error);
    return null;
  }
}

/**
 * Find a match using OpenAI's semantic understanding
 * @param {string} serviceDescription - The service description from the bill
 * @param {object|null} dbMatch - The best database match (if any)
 * @param {object} additionalContext - Additional context about the service
 * @returns {Promise<object|null>} - The matched CPT code information or null
 */
async function findMatchWithOpenAI(serviceDescription, dbMatch = null, additionalContext = {}) {
  try {
    console.log(`[CPT_MATCHER_AI] Starting OpenAI matching for: "${serviceDescription}"`);
    
    // Extract additional context
    const patientAge = additionalContext.patientAge || null;
    const serviceDate = additionalContext.serviceDate || null;
    const serviceCategory = additionalContext.category || null;
    
    // Create a prompt for OpenAI
    let prompt = `I need to find the most appropriate CPT/HCPCS code for this medical service:

Service Description: "${serviceDescription}"`;

    // Add service category if available
    if (serviceCategory) {
      prompt += `\nService Category: ${serviceCategory}`;
    }

    // Add patient age if available
    if (patientAge) {
      prompt += `\nPatient Age: ${patientAge} years`;
    }
    
    // Add service date if available
    if (serviceDate) {
      prompt += `\nService Date: ${serviceDate}`;
    }
    
    // Add database match if available
    if (dbMatch) {
      prompt += `\n\nA database search found this potential match:
CPT Code: ${dbMatch.cptCode}
Description: "${dbMatch.description}"
Confidence: ${dbMatch.confidence.toFixed(2)}`;
    }
    
    // Add category-specific guidance
    if (serviceCategory) {
      prompt += `\n\nSince this service is categorized as "${serviceCategory}", please focus on the following code ranges:`;
      
      switch (serviceCategory) {
        case 'Office visits and Consultations':
          prompt += `\n- Evaluation and Management codes (99201-99499)`;
          break;
        case 'Procedures and Surgeries':
          prompt += `\n- Surgery codes (10000-69999)`;
          break;
        case 'Lab and Diagnostic Tests':
          prompt += `\n- Laboratory codes (80000-89999)`;
          prompt += `\n- Radiology codes (70000-79999)`;
          break;
        case 'Drugs and Infusions':
          prompt += `\n- HCPCS J-codes for drugs and infusions (J0000-J9999)`;
          break;
        case 'Medical Equipment':
          prompt += `\n- HCPCS E-codes for equipment (E0000-E9999)`;
          prompt += `\n- HCPCS K-codes for supplies (K0000-K9999)`;
          break;
        case 'Hospital stays and emergency care visits':
          prompt += `\n- Hospital E&M codes (99217-99239)`;
          prompt += `\n- Emergency department codes (99281-99288)`;
          break;
      }
    }
    
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
    
    // Check if the code is compatible with the service category
    if (serviceCategory && !isMatchCompatibleWithCategory(result.cptCode, serviceCategory)) {
      console.warn(`[CPT_MATCHER_AI] OpenAI returned code ${result.cptCode} which is not compatible with category ${serviceCategory}`);
      // We'll still return the result, but with a lower confidence
      result.confidence = Math.min(result.confidence, 0.6);
      result.reasoning += ` (Note: This code may not be fully compatible with the service category "${serviceCategory}")`;
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

// Export the main function using ES module exports
export {
  matchServiceToCPT,
  lookupCPTCode
}; 