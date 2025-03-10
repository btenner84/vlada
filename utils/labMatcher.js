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
    
    let match = null;
    
    // If we have an extracted code, try to look it up first
    if (extractedCode) {
      console.log(`[LAB_MATCHER] Attempting to look up extracted code: ${extractedCode}`);
      match = await lookupLabCode(extractedCode);
      
      if (match) {
        console.log('[LAB_MATCHER] Found match for extracted code:', match);
        return {
          ...match,
          matchMethod: 'extracted_code',
          confidence: 0.95
        };
      }
    }
    
    // Check if the service description contains a lab code in parentheses
    const codeMatch = serviceDescription.match(/\(LAB\)\s*(\d+)/i) || 
                      serviceDescription.match(/\s(\d{5})\s/);
    
    if (codeMatch && codeMatch[1]) {
      const codeFromDesc = codeMatch[1];
      console.log(`[LAB_MATCHER] Found code in description: ${codeFromDesc}`);
      match = await lookupLabCode(codeFromDesc);
      
      if (match) {
        console.log('[LAB_MATCHER] Found match for code in description:', match);
        return {
          ...match,
          matchMethod: 'description_code',
          confidence: 0.98
        };
      }
    }
    
    // Try exact match in database
    match = await findExactLabMatch(serviceDescription);
    if (match) {
      console.log('[LAB_MATCHER] Found exact match:', match);
      return {
        ...match,
        matchMethod: 'exact_match',
        confidence: 0.98
      };
    }
    
    // Try database keyword matching
    match = await findLabMatchInDatabase(serviceDescription);
    if (match && match.confidence > 0.8) {
      console.log('[LAB_MATCHER] Found database match:', match);
      return {
        ...match,
        matchMethod: 'keyword_match'
      };
    }
    
    // Use OpenAI as last resort
    match = await findLabMatchWithOpenAI(serviceDescription, match);
    if (match) {
      // Verify the match with a second OpenAI call
      const verified = await verifyLabAIMatch(match.labCode, serviceDescription);
      if (verified) {
        console.log('[LAB_MATCHER] Found and verified AI match:', match);
        return {
          ...match,
          matchMethod: 'ai_match'
        };
      }
    }
    
    console.log('[LAB_MATCHER] No match found');
    return null;
    
  } catch (error) {
    console.error('[LAB_MATCHER] Error in lab matching:', error);
    return null;
  }
}

/**
 * Look up a lab code in the database
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
 * Find an exact match in the lab code database
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
        confidence: 0.95 // Slightly lower confidence for detailed description match
      };
    }
    
    const data = querySnapshot.docs[0].data();
    return {
      labCode: data.code,
      description: data.description,
      detailedDescription: data.detailedDescription,
      rate: data.rate,
      confidence: 1.0
    };
  } catch (error) {
    console.error('[LAB_MATCHER] Error finding exact match:', error);
    return null;
  }
}

/**
 * Find a match in the lab code database using keyword matching
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
        confidence: score
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
 * Find a match using OpenAI's semantic understanding
 */
async function findLabMatchWithOpenAI(serviceDescription, dbMatch = null) {
  try {
    let prompt = `I need to find the most appropriate laboratory test code (CLFS) for this medical service:

Service Description: "${serviceDescription}"

Please focus on laboratory test codes (80000-89999 range).`;

    if (dbMatch) {
      prompt += `\n\nA database search found this potential match:
Lab Code: ${dbMatch.labCode}
Description: "${dbMatch.description}"
Detailed Description: "${dbMatch.detailedDescription}"
Confidence: ${dbMatch.confidence.toFixed(2)}`;
    }

    prompt += `\n\nPlease provide the most appropriate lab code. Respond in JSON format:
{
  "labCode": "80001",
  "description": "Standard description of the lab test",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this code is appropriate"
}`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a medical coding expert specializing in laboratory test codes (CLFS). Your task is to match service descriptions to the most appropriate lab code.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    
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
      reasoning: result.reasoning
    };
  } catch (error) {
    console.error('[LAB_MATCHER] Error finding match with OpenAI:', error);
    return null;
  }
}

/**
 * Calculate match score between service description and lab code descriptions
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

/**
 * Verify an AI-generated match against the database
 */
async function verifyLabAIMatch(labCode, serviceDescription) {
  try {
    const match = await lookupLabCode(labCode);
    if (!match) return null;
    
    const score = calculateMatchScore(
      serviceDescription,
      match.description,
      match.detailedDescription
    );
    
    return {
      ...match,
      confidence: Math.max(score, 0.7) // Minimum confidence of 0.7 for verified matches
    };
  } catch (error) {
    console.error('[LAB_MATCHER] Error verifying AI match:', error);
    return null;
  }
} 