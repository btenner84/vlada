import { adminDb } from '../firebase/admin';
import { OpenAI } from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Use the existing Firebase Admin instance
const db = adminDb;

/**
 * Match a service description to a CLFS code
 * @param {string} serviceDescription - The service description from the bill
 * @param {object} additionalContext - Additional context about the service
 * @param {string} extractedCode - Lab code directly extracted from the bill (if available)
 * @returns {Promise<object|null>} - The matched lab code information or null
 */
export async function matchServiceToLab(serviceDescription, additionalContext = {}, extractedCode = null) {
  try {
    console.log(`[LAB_MATCHER] Starting lab code matching for: "${serviceDescription}"`);
    
    if (!serviceDescription) {
      console.log('[LAB_MATCHER] No service description provided');
      return {
        matched: false,
        reasoning: 'No service description provided'
      };
    }
    
    // Extract the code if available (we'll use this for confirmation later)
    const extractedCodeFromDesc = extractedCode || extractCodeFromDescription(serviceDescription);
    if (extractedCodeFromDesc) {
      console.log(`[LAB_MATCHER] Extracted code from service: ${extractedCodeFromDesc}`);
    }
    
    // STEP 1: Use OpenAI as the first line of defense
    console.log(`[LAB_MATCHER] Using OpenAI as primary matcher for: "${serviceDescription}"`);
    const aiMatch = await findLabMatchWithOpenAI(serviceDescription, additionalContext);
    
    if (aiMatch) {
      console.log(`[LAB_MATCHER] OpenAI suggested code: ${aiMatch.labCode} with confidence: ${aiMatch.confidence.toFixed(2)}`);
      
      // STEP 2: If AI confidence is high (≥70%), use it directly
      if (aiMatch.confidence >= 0.7) {
        console.log(`[LAB_MATCHER] High confidence AI match (${aiMatch.confidence.toFixed(2)}), using directly`);
        
        // Verify the AI match against the database
        const labInfo = await lookupLabCode(aiMatch.labCode);
        
        if (labInfo) {
          console.log(`[LAB_MATCHER] Verified AI match in database: ${labInfo.labCode}`);
          
          // If we have an extracted code, check if it matches the AI suggestion
          if (extractedCodeFromDesc && extractedCodeFromDesc === aiMatch.labCode) {
            console.log(`[LAB_MATCHER] AI match confirmed by extracted code: ${extractedCodeFromDesc}`);
            return {
              matched: true,
              ...labInfo,
              confidence: Math.max(aiMatch.confidence, 0.95), // Boost confidence due to code confirmation
              reasoning: aiMatch.reasoning + " (Confirmed by extracted code)",
              matchMethod: 'ai_match_code_confirmed'
            };
          }
          
          return {
            matched: true,
            ...labInfo,
            confidence: aiMatch.confidence,
            reasoning: aiMatch.reasoning,
            matchMethod: 'ai_match_primary'
          };
        } else {
          console.log(`[LAB_MATCHER] AI match ${aiMatch.labCode} not found in database, returning AI result only`);
          return {
            matched: true,
            labCode: aiMatch.labCode,
            description: aiMatch.description,
            confidence: aiMatch.confidence * 0.9, // Slightly reduce confidence for unverified matches
            reasoning: aiMatch.reasoning + " (Note: No rate data available for this lab code)",
            matchMethod: 'ai_match_unverified',
            rate: null
          };
        }
      } else {
        console.log(`[LAB_MATCHER] Low confidence AI match (${aiMatch.confidence.toFixed(2)}), checking alternatives`);
      }
    } else {
      console.log(`[LAB_MATCHER] OpenAI failed to provide a match, falling back to code lookup`);
    }
    
    // STEP 3: If AI confidence is low or AI failed, try using the extracted code
    if (extractedCodeFromDesc) {
      console.log(`[LAB_MATCHER] Trying direct code lookup with extracted code: ${extractedCodeFromDesc}`);
      const labInfo = await lookupLabCode(extractedCodeFromDesc);
      
      if (labInfo) {
        console.log(`[LAB_MATCHER] Found direct match in lab database: ${extractedCodeFromDesc}`);
        return {
          matched: true,
          ...labInfo,
          confidence: 0.95, // High confidence for direct code match
          matchMethod: 'direct_code_match'
        };
      } else {
        console.log(`[LAB_MATCHER] Extracted code ${extractedCodeFromDesc} not found in database`);
      }
    }
    
    // STEP 4: If we have a low-confidence AI match but nothing else worked, use it as fallback
    if (aiMatch) {
      console.log(`[LAB_MATCHER] Using low confidence AI match as fallback: ${aiMatch.labCode} (${aiMatch.confidence.toFixed(2)})`);
      
      // Try to verify it against the database one more time
      const labInfo = await lookupLabCode(aiMatch.labCode);
      
      if (labInfo) {
        return {
          matched: true,
          ...labInfo,
          confidence: aiMatch.confidence,
          reasoning: aiMatch.reasoning,
          matchMethod: 'ai_match_fallback'
        };
      }
      
      return {
        matched: true,
        labCode: aiMatch.labCode,
        description: aiMatch.description,
        confidence: aiMatch.confidence * 0.8, // Reduce confidence for unverified fallback
        reasoning: aiMatch.reasoning + " (Note: No rate data available for this lab code)",
        matchMethod: 'ai_match_fallback_unverified',
        rate: null
      };
    }
    
    // STEP 5: Last resort - try database matching
    console.log(`[LAB_MATCHER] All primary methods failed, attempting database matching`);
    
    // Try exact match in database
    const exactMatch = await findExactLabMatch(serviceDescription);
    if (exactMatch) {
      console.log(`[LAB_MATCHER] Found exact match in database: ${exactMatch.labCode}`);
      return {
        matched: true,
        ...exactMatch,
        matchMethod: 'exact_match_last_resort'
      };
    }
    
    // Try keyword matching in database
    const keywordMatch = await findLabMatchInDatabase(serviceDescription);
    if (keywordMatch && keywordMatch.confidence > 0.6) {
      console.log(`[LAB_MATCHER] Found keyword match in database: ${keywordMatch.labCode} (${keywordMatch.confidence.toFixed(2)})`);
      return {
        matched: true,
        ...keywordMatch,
        matchMethod: 'keyword_match_last_resort'
      };
    }
    
    console.log(`[LAB_MATCHER] No match found for service: "${serviceDescription}"`);
    return {
      matched: false,
      confidence: 0,
      reasoning: 'No matching lab test found in database'
    };
    
  } catch (error) {
    console.error('[LAB_MATCHER] Error in lab matching:', error);
    return {
      matched: false,
      confidence: 0,
      reasoning: `Error matching lab test: ${error.message}`
    };
  }
}

/**
 * Extract a lab code from a service description
 * @param {string} description - The service description
 * @returns {string|null} - The extracted code or null
 */
function extractCodeFromDescription(description) {
  if (!description) return null;
  
  // Look for patterns like "(LAB) 80053" or just "80053"
  const codePatterns = [
    /\(LAB\)\s*(\d{5})/i,
    /\(LAB\)\s*(\d{3,4})/i,
    /LAB CODE:?\s*(\d{3,5})/i,
    /CODE:?\s*(\d{5})/i,
    /\s(\d{5})\s/,
    /^(\d{5})$/,
    /\s(\d{5})$/
  ];
  
  for (const pattern of codePatterns) {
    const match = description.match(pattern);
    if (match && match[1]) {
      // Normalize to 5 digits
      return match[1].padStart(5, '0');
    }
  }
  
  return null;
}

/**
 * Look up a lab code in the database
 * @param {string} labCode - The lab code to look up
 * @returns {Promise<Object|null>} - The lab information or null if not found
 */
async function lookupLabCode(labCode) {
  try {
    console.log(`[LAB_MATCHER] Looking up lab code: ${labCode}`);
    
    // Handle common lab codes directly
    const commonLabCodes = {
      '80053': { code: '80053', description: 'Comprehensive Metabolic Panel', rate: 10.56 },
      '85025': { code: '85025', description: 'Complete CBC w/Auto Diff WBC', rate: 8.63 },
      '81003': { code: '81003', description: 'Urinalysis, automated, w/o microscopy', rate: 2.25 },
      '81025': { code: '81025', description: 'Urine pregnancy test, visual color comparison', rate: 8.61 }
    };
    
    // Check if it's a common lab code
    if (commonLabCodes[labCode]) {
      const data = commonLabCodes[labCode];
      console.log(`[LAB_MATCHER] Found common lab code: ${labCode}`, data);
      return {
        labCode: data.code,
        description: data.description,
        detailedDescription: data.description,
        rate: data.rate,
        reasoning: 'Direct match from common lab codes'
      };
    }
    
    // Normalize the code to 5 digits
    const normalizedCode = labCode.padStart(5, '0');
    console.log(`[LAB_MATCHER] Normalized code: ${normalizedCode}`);
    
    // First try exact match
    let docRef = await db.collection('labCodes').doc(normalizedCode).get();
    
    // If no exact match, try without leading zeros
    if (!docRef.exists) {
      const trimmedCode = normalizedCode.replace(/^0+/, '');
      console.log(`[LAB_MATCHER] No exact match found, trying without leading zeros: ${trimmedCode}`);
      docRef = await db.collection('labCodes').doc(trimmedCode).get();
    }
    
    if (!docRef.exists) {
      console.log(`[LAB_MATCHER] No lab code found for: ${labCode}`);
      return null;
    }
    
    const data = docRef.data();
    console.log('[LAB_MATCHER] Found lab code data:', data);
    
    // Ensure rate is a number
    const rate = typeof data.rate === 'string' ? parseFloat(data.rate) : data.rate;
    
    return {
      labCode: data.code,
      description: data.description,
      detailedDescription: data.detailedDescription || data.description,
      rate: rate || null,
      reasoning: 'Direct code match from Clinical Laboratory Fee Schedule'
    };
  } catch (error) {
    console.error('[LAB_MATCHER] Error looking up lab code:', error);
    return null;
  }
}

/**
 * Find a match using OpenAI's semantic understanding
 * @param {object} serviceDescription - The service description
 * @param {object} additionalContext - Additional context about the service
 * @returns {Promise<object|null>} - The matched lab information or null
 */
async function findLabMatchWithOpenAI(serviceDescription, additionalContext = {}) {
  try {
    console.log(`[LAB_MATCHER] Finding match with OpenAI for: "${serviceDescription}"`);
    
    // Create a more robust prompt for OpenAI
    let prompt = `I need to find the most appropriate laboratory test code (CLFS) for this medical service:

Service Description: "${serviceDescription}"`;

    // Add service code if available
    if (additionalContext.extractedCode) {
      prompt += `\nExtracted Code: ${additionalContext.extractedCode}`;
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
    
    prompt += `\n\nThis is for laboratory test identification and pricing. Please provide the most appropriate code that would be used for billing this laboratory test.

For laboratory services, consider the following:
1. Laboratory test codes are in the 80000-89999 range
2. Consider common lab test names and abbreviations (e.g., CBC, CMP, BMP)
3. Pay attention to specific test components and methodologies
4. Consider the purpose of the test (diagnostic, screening, monitoring)
5. Consider common variations in test names and descriptions

Your task is to determine the most specific and accurate code that represents this laboratory test.

Respond in JSON format with the following structure:
{
  "labCode": "80053",
  "description": "Standard description of the laboratory test",
  "confidence": 0.95,
  "reasoning": "Detailed explanation of why this code is appropriate for this laboratory test"
}

The confidence should reflect your certainty in the match, with values:
- 0.9-1.0: Very high confidence (exact match)
- 0.8-0.89: High confidence (strong match)
- 0.7-0.79: Good confidence (likely match)
- 0.5-0.69: Moderate confidence (possible match)
- <0.5: Low confidence (uncertain match)`;

    console.log('[LAB_MATCHER] Calling OpenAI API for lab code matching with enhanced prompt');
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are a medical coding expert specializing in laboratory test codes (CLFS). Your task is to match service descriptions to the most appropriate lab code. Be precise and consider common lab test names, abbreviations, and methodologies. Provide detailed reasoning for your code selection.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });
    
    // Parse the response
    const result = JSON.parse(response.choices[0].message.content);
    console.log('[LAB_MATCHER] OpenAI response:', JSON.stringify(result, null, 2));
    
    // Validate the lab code format (5 digits in the correct range)
    const code = parseInt(result.labCode);
    if (isNaN(code) || code < 80000 || code > 89999) {
      console.warn('[LAB_MATCHER] OpenAI returned invalid lab code:', result.labCode);
      return null;
    }
    
    return {
      labCode: result.labCode,
      description: result.description,
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning || 'Matched using AI'
    };
  } catch (error) {
    console.error('[LAB_MATCHER] Error finding match with OpenAI:', error);
    return null;
  }
}

/**
 * Find an exact match in the lab code database
 * @param {string} serviceDescription - The service description
 * @returns {Promise<Object|null>} - The matched lab information or null
 */
async function findExactLabMatch(serviceDescription) {
  try {
    const normalizedDesc = serviceDescription.toLowerCase().trim();
    
    const querySnapshot = await db.collection('labCodes')
      .where('description', '==', normalizedDesc)
      .limit(1)
      .get();
    
    if (querySnapshot.empty) {
      // Try matching against detailed description
      const detailedSnapshot = await db.collection('labCodes')
        .where('detailedDescription', '==', normalizedDesc)
        .limit(1)
        .get();
        
      if (detailedSnapshot.empty) return null;
      
      const data = detailedSnapshot.docs[0].data();
      return {
        labCode: data.code,
        description: data.description,
        detailedDescription: data.detailedDescription,
        rate: data.rate,
        confidence: 0.95, // Slightly lower confidence for detailed description match
        reasoning: 'Exact match by detailed description'
      };
    }
    
    const data = querySnapshot.docs[0].data();
    return {
      labCode: data.code,
      description: data.description,
      detailedDescription: data.detailedDescription,
      rate: data.rate,
      confidence: 1.0,
      reasoning: 'Exact match by description'
    };
  } catch (error) {
    console.error('[LAB_MATCHER] Error finding exact match:', error);
    return null;
  }
}

/**
 * Find a match in the lab code database using keyword matching
 * @param {string} serviceDescription - The service description
 * @returns {Promise<Object|null>} - The matched lab information or null
 */
async function findLabMatchInDatabase(serviceDescription) {
  try {
    const keywords = generateKeywords(serviceDescription);
    
    const querySnapshot = await db.collection('labCodes')
      .where('keywords', 'array-contains-any', keywords)
      .limit(20)
      .get();
    
    if (querySnapshot.empty) return null;
    
    // Score matches based on description similarity
    const matches = querySnapshot.docs.map(doc => {
      const data = doc.data();
      const score = calculateMatchScore(
        serviceDescription,
        data.description,
        data.detailedDescription
      );
      
      return {
        labCode: data.code,
        description: data.description,
        detailedDescription: data.detailedDescription,
        rate: data.rate,
        confidence: score,
        reasoning: 'Matched by keyword similarity'
      };
    });
    
    // Return the highest scoring match
    matches.sort((a, b) => b.confidence - a.confidence);
    return matches[0];
  } catch (error) {
    console.error('[LAB_MATCHER] Error finding database match:', error);
    return null;
  }
}

/**
 * Calculate match score between service description and lab code descriptions
 * @param {string} serviceDesc - The service description
 * @param {string} labDesc - The lab code description
 * @param {string} detailedDesc - The detailed description
 * @returns {number} - Match score between 0 and 1
 */
function calculateMatchScore(serviceDesc, labDesc, detailedDesc) {
  const normalizedService = serviceDesc.toLowerCase();
  const normalizedLab = labDesc.toLowerCase();
  const normalizedDetailed = detailedDesc?.toLowerCase() || '';
  
  // Check for exact matches
  if (normalizedLab === normalizedService) return 1.0;
  if (normalizedDetailed === normalizedService) return 0.95;
  
  // Calculate word overlap scores
  const serviceWords = new Set(normalizedService.split(' '));
  const labWords = new Set(normalizedLab.split(' '));
  const detailedWords = new Set(normalizedDetailed.split(' '));
  
  const labOverlap = [...serviceWords].filter(word => labWords.has(word)).length / serviceWords.size;
  const detailedOverlap = [...serviceWords].filter(word => detailedWords.has(word)).length / serviceWords.size;
  
  // Use the higher of the two overlap scores
  return Math.max(labOverlap, detailedOverlap);
}

/**
 * Generate keywords for database searching
 * @param {string} description - The service description
 * @returns {string[]} - Array of keywords
 */
function generateKeywords(description) {
  if (!description) return [];
  
  const cleanText = description.toLowerCase().replace(/[^\w\s]/g, ' ');
  const words = [...new Set(cleanText.split(/\s+/).filter(word => word.length > 2))];
  
  const combinations = [];
  for (let i = 0; i < words.length; i++) {
    combinations.push(words[i]);
    if (i < words.length - 1) {
      combinations.push(`${words[i]} ${words[i + 1]}`);
    }
    if (i < words.length - 2) {
      combinations.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }
  
  return combinations;
} 