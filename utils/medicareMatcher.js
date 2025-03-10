import { adminDb } from '../firebase/admin';

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
 * Look up a Medicare rate by CPT code
 * @param {string} cptCode - The CPT code to look up
 * @returns {Promise<Object|null>} - The Medicare rate information or null if not found
 */
async function lookupMedicareRate(cptCode) {
  try {
    console.log(`[MEDICARE_MATCHER] Looking up Medicare rate for CPT code: ${cptCode}`);
    
    // Check common Medicare rates first
    if (commonMedicareRates[cptCode]) {
      const data = commonMedicareRates[cptCode];
      console.log(`[MEDICARE_MATCHER] Found common Medicare rate: ${cptCode}`, data);
      return {
        code: data.code,
        description: data.description,
        nonFacilityRate: data.nonFacilityRate,
        facilityRate: data.facilityRate,
        reasoning: 'Direct match from common Medicare rates'
      };
    }
    
    // Check if adminDb is properly initialized
    if (!adminDb) {
      console.error('[MEDICARE_MATCHER] Firebase admin DB is not initialized');
      return null;
    }
    
    // Try to find in Medicare codes collection
    let docRef = await adminDb.collection('medicareCodes').doc(cptCode).get();
    
    if (!docRef.exists) {
      console.log(`[MEDICARE_MATCHER] No Medicare rate found in medicareCodes collection for: ${cptCode}`);
      
      // If not found in Medicare collection, try CPT code mappings for office visits, procedures, etc.
      docRef = await adminDb.collection('cptCodeMappings').doc(cptCode).get();
      
      if (!docRef.exists) {
        console.log(`[MEDICARE_MATCHER] No Medicare rate found in cptCodeMappings for: ${cptCode}`);
        return null;
      }
      
      const cptData = docRef.data();
      console.log('[MEDICARE_MATCHER] Found CPT code data:', cptData);
      
      // Check if we have reimbursement rates
      if (!cptData.nonFacilityRate && !cptData.facilityRate) {
        console.log(`[MEDICARE_MATCHER] CPT code ${cptCode} found but has no reimbursement rates`);
        return null;
      }
      
      return {
        code: cptData.code,
        description: cptData.description,
        nonFacilityRate: cptData.nonFacilityRate || null,
        facilityRate: cptData.facilityRate || null,
        reasoning: 'Match from CPT code database'
      };
    }
    
    const data = docRef.data();
    console.log('[MEDICARE_MATCHER] Found Medicare rate data:', data);
    
    return {
      code: data.code,
      description: data.description,
      nonFacilityRate: data.nonFacilityRate,
      facilityRate: data.facilityRate,
      reasoning: 'Direct match from Medicare Fee Schedule'
    };
  } catch (error) {
    console.error('[MEDICARE_MATCHER] Error looking up Medicare rate:', error);
    return null;
  }
}

/**
 * Match a service to a Medicare rate
 * @param {Object} service - The service to match
 * @param {Object} context - Additional context about the service
 * @returns {Promise<Object|null>} - The matched Medicare rate information
 */
async function matchServiceToMedicare(service, context = {}) {
  try {
    console.log('[MEDICARE_MATCHER] Starting Medicare rate matching for:', service.description);
    
    // If we have a CPT code, try to look it up directly
    if (service.code && service.code !== 'Not found') {
      const rateInfo = await lookupMedicareRate(service.code);
      if (rateInfo) {
        return {
          ...rateInfo,
          matchMethod: 'direct_code',
          confidence: 0.95
        };
      }
    }
    
    // If no direct match by code, try to find a match based on description
    const normalizedDesc = service.description.toLowerCase().trim();
    const category = context.category || '';
    
    // Step 1: Try direct service description mapping first (most reliable)
    const directMatch = findDirectDescriptionMatch(normalizedDesc);
    if (directMatch) {
      console.log(`[MEDICARE_MATCHER] Found direct description match: ${directMatch.code}`);
      const rateInfo = await lookupMedicareRate(directMatch.code);
      if (rateInfo) {
        return {
          ...rateInfo,
          matchMethod: 'direct_description_match',
          confidence: 0.95,
          reasoning: `Directly matched "${normalizedDesc}" to predefined service: ${directMatch.code}`
        };
      }
    }
    
    // Step 2: Try database description matching
    const descriptionMatch = await findMatchByDescription(normalizedDesc, category);
    if (descriptionMatch) {
      console.log(`[MEDICARE_MATCHER] Found match by description: ${descriptionMatch.code}`);
      return {
        ...descriptionMatch,
        matchMethod: 'description_match',
        confidence: descriptionMatch.confidence
      };
    }
    
    // Step 3: Use specialized logic for specific service categories
    if (category === 'Office visits and Consultations') {
      return await matchOfficeVisit(normalizedDesc, service, context);
    } else if (category === 'Procedures and Surgeries') {
      return await matchProcedure(normalizedDesc, service, context);
    } else if (category === 'Hospital stays and emergency care visits') {
      return await matchEmergencyCare(normalizedDesc, service, context);
    }
    
    // If service category is specified but no match found yet, try generic category-based matching
    if (category) {
      console.log(`[MEDICARE_MATCHER] Trying generic category matching for: ${category}`);
      
      let defaultCode;
      switch (category) {
        case 'Office visits and Consultations':
          defaultCode = '99213'; // Established patient, level 3
          break;
        case 'Procedures and Surgeries':
          defaultCode = '36415'; // Routine venipuncture
          break;
        case 'Hospital stays and emergency care visits':
          defaultCode = '99283'; // ER visit, moderate severity
          break;
        default:
          defaultCode = null;
      }
      
      if (defaultCode) {
        console.log(`[MEDICARE_MATCHER] Using default code for category: ${defaultCode}`);
        const rateInfo = await lookupMedicareRate(defaultCode);
        if (rateInfo) {
          return {
            ...rateInfo,
            matchMethod: 'category_default',
            confidence: 0.7,
            reasoning: `Used default code ${defaultCode} based on service category ${category}`
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('[MEDICARE_MATCHER] Error matching service to Medicare rate:', error);
    return null;
  }
}

/**
 * Find a direct match in the service description mappings
 * @param {string} normalizedDesc - The normalized service description
 * @returns {Object|null} - The matched service mapping or null if not found
 */
function findDirectDescriptionMatch(normalizedDesc) {
  // First try exact match
  if (serviceDescriptionMappings[normalizedDesc]) {
    return {
      ...serviceDescriptionMappings[normalizedDesc],
      confidence: 1.0
    };
  }
  
  // Try partial matches
  for (const [key, mapping] of Object.entries(serviceDescriptionMappings)) {
    if (normalizedDesc.includes(key)) {
      return {
        ...mapping,
        confidence: 0.9
      };
    }
  }
  
  // Check for word-by-word matches with high-value terms
  const words = normalizedDesc.split(/\s+/);
  const highValueMatches = [];
  
  for (const [key, mapping] of Object.entries(serviceDescriptionMappings)) {
    const keyWords = key.split(/\s+/);
    let matchCount = 0;
    
    for (const word of words) {
      if (word.length <= 2) continue; // Skip very short words
      if (keyWords.includes(word)) {
        matchCount++;
      }
    }
    
    // If more than half of words match, consider it a potential match
    if (matchCount > 0 && matchCount >= Math.ceil(keyWords.length / 2)) {
      highValueMatches.push({
        ...mapping,
        matchKey: key,
        confidence: 0.7 + (0.2 * (matchCount / keyWords.length))
      });
    }
  }
  
  // If we have high-value matches, return the one with highest confidence
  if (highValueMatches.length > 0) {
    highValueMatches.sort((a, b) => b.confidence - a.confidence);
    return highValueMatches[0];
  }
  
  return null;
}

/**
 * Match office visit with appropriate E&M code
 * @param {string} normalizedDesc - The normalized service description
 * @param {Object} service - The original service object
 * @param {Object} context - Additional context
 * @returns {Promise<Object|null>} - The matched Medicare rate information
 */
async function matchOfficeVisit(normalizedDesc, service, context) {
  console.log('[MEDICARE_MATCHER] Matching office visit or consultation');
  
  // Determine if this is a preventive visit
  const isPreventive = 
    normalizedDesc.includes('preventive') || 
    normalizedDesc.includes('annual') || 
    normalizedDesc.includes('physical') ||
    normalizedDesc.includes('wellness') ||
    normalizedDesc.includes('check up') ||
    normalizedDesc.includes('checkup');
  
  // Check for new or established patient keywords
  const isNewPatient = normalizedDesc.includes('new patient') || 
                       normalizedDesc.includes('new visit') || 
                       normalizedDesc.includes('initial visit');
  
  // Determine complexity/level based on description
  let level = 3; // Default to level 3 (moderate)
  
  if (normalizedDesc.includes('comprehensive') || 
      normalizedDesc.includes('complex') || 
      normalizedDesc.includes('detailed') ||
      normalizedDesc.includes('high') ||
      normalizedDesc.includes('level 4') ||
      normalizedDesc.includes('level 5') ||
      normalizedDesc.includes('full')) {
    level = normalizedDesc.includes('highest') ? 5 : 4;
  } else if (normalizedDesc.includes('basic') || 
             normalizedDesc.includes('brief') || 
             normalizedDesc.includes('level 1') ||
             normalizedDesc.includes('level 2')) {
    level = normalizedDesc.includes('minimal') ? 1 : 2;
  }
  
  // Determine the appropriate code based on the criteria
  let officeVisitCode;
  
  if (isPreventive) {
    // Use preventive visit codes
    if (isNewPatient) {
      officeVisitCode = level >= 4 ? '99386' : '99385'; // New patient preventive
    } else {
      officeVisitCode = level >= 4 ? '99396' : '99395'; // Established patient preventive
    }
  } else {
    // Use regular E&M codes
    if (isNewPatient) {
      // New patient codes: 99201-99205
      officeVisitCode = `9920${level}`;
    } else {
      // Established patient codes: 99211-99215
      officeVisitCode = `9921${level}`;
    }
  }
  
  console.log(`[MEDICARE_MATCHER] Using office visit code: ${officeVisitCode} (level: ${level}, new patient: ${isNewPatient}, preventive: ${isPreventive})`);
  
  const rateInfo = await lookupMedicareRate(officeVisitCode);
  if (rateInfo) {
    return {
      ...rateInfo,
      matchMethod: 'office_visit_pattern',
      confidence: 0.85
    };
  }
  
  return null;
}

/**
 * Match emergency care service
 * @param {string} normalizedDesc - The normalized service description
 * @param {Object} service - The original service object
 * @param {Object} context - Additional context
 * @returns {Promise<Object|null>} - The matched Medicare rate information
 */
async function matchEmergencyCare(normalizedDesc, service, context) {
  console.log('[MEDICARE_MATCHER] Matching emergency care service');
  
  // Determine severity level for emergency visit
  let severityCode;
  if (normalizedDesc.includes('highest') || 
      normalizedDesc.includes('critical') || 
      normalizedDesc.includes('severe')) {
    severityCode = '99285';
  } else if (normalizedDesc.includes('high')) {
    severityCode = '99284';
  } else {
    severityCode = '99283';
  }
  
  const rateInfo = await lookupMedicareRate(severityCode);
  if (rateInfo) {
    return {
      ...rateInfo,
      matchMethod: 'emergency_visit_pattern',
      confidence: 0.9
    };
  }
  
  return null;
}

/**
 * Match procedure or surgery
 * @param {string} normalizedDesc - The normalized service description
 * @param {Object} service - The original service object
 * @param {Object} context - Additional context
 * @returns {Promise<Object|null>} - The matched Medicare rate information
 */
async function matchProcedure(normalizedDesc, service, context) {
  console.log('[MEDICARE_MATCHER] Matching procedure or surgery');
  
  // Try to find a database match for the procedure
  const dbMatch = await findMatchByDescription(normalizedDesc, 'Procedures and Surgeries');
  if (dbMatch) {
    return {
      ...dbMatch,
      matchMethod: 'procedure_description_match',
      confidence: dbMatch.confidence
    };
  }
  
  // IV services
  if (normalizedDesc.includes('iv push') || normalizedDesc.includes('intravenous push')) {
    const isInitial = normalizedDesc.includes('initial') || !normalizedDesc.includes('additional');
    const code = isInitial ? '96374' : '96375';
    
    const rateInfo = await lookupMedicareRate(code);
    if (rateInfo) {
      return {
        ...rateInfo,
        matchMethod: 'iv_procedure_pattern',
        confidence: 0.9
      };
    }
  }
  
  // Use a default procedure code if no specific match
  const defaultCode = '36415'; // Routine venipuncture as default
  const rateInfo = await lookupMedicareRate(defaultCode);
  
  if (rateInfo) {
    return {
      ...rateInfo,
      matchMethod: 'procedure_default',
      confidence: 0.6,
      reasoning: 'Using default procedure code'
    };
  }
  
  return null;
}

/**
 * Calculate string similarity score between two strings
 * With focus on medical terminology and key words in CPT descriptions
 * @param {string} str1 - First string (service description)
 * @param {string} str2 - Second string (CPT code description)
 * @returns {number} - Similarity score between 0 and 1
 */
function calculateStringSimilarity(str1, str2) {
  // Convert both strings to lowercase and trim whitespace
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  // Check for exact match
  if (s1 === s2) return 1.0;
  
  // Check if one contains the other completely
  if (s1.includes(s2)) return 0.95;
  if (s2.includes(s1)) return 0.9;
  
  // Split into words and normalize
  const words1 = s1.split(/\s+/).filter(w => w.length > 2);
  const words2 = s2.split(/\s+/).filter(w => w.length > 2);
  
  // Common medical stopwords to ignore
  const stopWords = ['and', 'with', 'without', 'the', 'for', 'or', 'by', 'to', 'in', 'of'];
  
  // Important medical terms that should have higher weight if matched
  const importantTerms = [
    'evaluation', 'management', 'consultation', 'emergency', 'critical', 'comprehensive',
    'detailed', 'expanded', 'problem', 'focused', 'office', 'outpatient', 'inpatient', 
    'hospital', 'initial', 'subsequent', 'follow', 'established', 'new', 'patient',
    'visit', 'procedure', 'therapy', 'injection', 'infusion', 'diagnostic', 'test',
    'lab', 'laboratory', 'imaging', 'scan', 'mri', 'ct', 'x-ray', 'ultrasound',
    'check', 'checkup', 'physical', 'annual', 'complete', 'ear', 'throat', 'full'
  ];
  
  // Filter out stopwords
  const filteredWords1 = words1.filter(w => !stopWords.includes(w));
  const filteredWords2 = words2.filter(w => !stopWords.includes(w));
  
  if (filteredWords1.length === 0 || filteredWords2.length === 0) {
    return 0.1; // Not enough significant words to compare
  }
  
  // Count matching words with weighted importance
  let totalWeight = 0;
  let matchWeight = 0;
  
  for (const word1 of filteredWords1) {
    // Determine word weight - important terms are weighted higher
    const wordWeight = importantTerms.includes(word1) ? 2.0 : 1.0;
    totalWeight += wordWeight;
    
    let bestWordMatch = 0;
    
    for (const word2 of filteredWords2) {
      // Exact match
      if (word1 === word2) {
        bestWordMatch = 1.0;
        break;
      }
      
      // One word contains the other (e.g., "cardio" in "cardiovascular")
      if (word1.length > 4 && word2.includes(word1)) {
        bestWordMatch = Math.max(bestWordMatch, 0.9);
        continue;
      }
      
      if (word2.length > 4 && word1.includes(word2)) {
        bestWordMatch = Math.max(bestWordMatch, 0.8);
        continue;
      }
      
      // Check for partial match (prefix/suffix)
      if (word1.length > 4 && word2.length > 4) {
        // Check if they share a significant prefix
        const prefixLength = Math.min(word1.length, word2.length) - 2;
        if (word1.substring(0, prefixLength) === word2.substring(0, prefixLength)) {
          bestWordMatch = Math.max(bestWordMatch, 0.7);
          continue;
        }
        
        // Check for common medical word stems
        const medicalStems = ['cardi', 'neuro', 'gastro', 'arthro', 'endo', 'hyper', 'hypo', 'check', 'phys', 'exam'];
        for (const stem of medicalStems) {
          if (word1.includes(stem) && word2.includes(stem)) {
            bestWordMatch = Math.max(bestWordMatch, 0.6);
            break;
          }
        }
      }
    }
    
    matchWeight += wordWeight * bestWordMatch;
  }
  
  // Calculate weighted similarity score
  if (totalWeight === 0) return 0;
  const similarityScore = matchWeight / totalWeight;
  
  // For short descriptions, boost the score if many words match
  if (filteredWords1.length <= 3 && similarityScore > 0.7) {
    return Math.min(1.0, similarityScore + 0.1);
  }
  
  return similarityScore;
}

/**
 * Find match by description in the CPT database
 * @param {string} serviceDescription - The normalized service description
 * @param {string} category - The service category
 * @returns {Promise<Object|null>} - The matched Medicare rate information or null
 */
async function findMatchByDescription(serviceDescription, category) {
  try {
    console.log(`[MEDICARE_MATCHER] Finding match by description for: "${serviceDescription}"`);
    
    // Check if adminDb is properly initialized
    if (!adminDb) {
      console.error('[MEDICARE_MATCHER] Firebase admin DB is not initialized');
      return null;
    }
    
    // First try direct search in medicareCodes collection
    let descMatches = [];
    
    // Get code pattern for the category if available
    let codeRange = null;
    if (category) {
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
        case 'Lab and Diagnostic Tests':
          codeRange = { start: '70000', end: '89999' };
          break;  
        default:
          codeRange = null;
      }
    }
    
    // Extract key words from service description for search
    const words = serviceDescription.split(/\s+/)
      .filter(word => word.length > 3)  // Only use words with more than 3 characters
      .filter(word => !['with', 'without', 'and', 'the', 'for', 'not'].includes(word.toLowerCase()))
      .slice(0, 3);  // Use at most 3 key words
    
    console.log(`[MEDICARE_MATCHER] Using key words for description search:`, words);
    
    if (words.length === 0) {
      console.log('[MEDICARE_MATCHER] No significant words found in description for search');
      words.push(...serviceDescription.split(/\s+/).filter(w => w.length > 2).slice(0, 2));
      
      if (words.length === 0) {
        return null;
      }
    }
    
    try {
      // Try to get a snapshot from medicareCodes first with basic query
      const medicareSnapshot = await adminDb.collection('medicareCodes')
        .limit(10)
        .get();
        
      if (!medicareSnapshot.empty) {
        medicareSnapshot.forEach(doc => {
          const data = doc.data();
          
          if (!data.description) return;
          
          const similarity = calculateStringSimilarity(serviceDescription, data.description);
          
          if (similarity >= 0.6) {
            descMatches.push({
              code: data.code,
              description: data.description,
              confidence: similarity,
              nonFacilityRate: data.nonFacilityRate || null,
              facilityRate: data.facilityRate || null,
            });
          }
        });
      }
    } catch (error) {
      console.log('[MEDICARE_MATCHER] Error querying medicareCodes collection:', error);
    }
    
    // If no matches in medicareCodes, try cptCodeMappings
    if (descMatches.length === 0) {
      try {
        // Build a query for cptCodeMappings
        let cptQuery = adminDb.collection('cptCodeMappings');
        
        // If we have a code range, add it to the query
        if (codeRange) {
          cptQuery = cptQuery.where('code', '>=', codeRange.start)
                             .where('code', '<=', codeRange.end);
        }
        
        const cptSnapshot = await cptQuery.limit(20).get();
        
        if (!cptSnapshot.empty) {
          cptSnapshot.forEach(doc => {
            const data = doc.data();
            
            if (!data.description) return;
            
            const similarity = calculateStringSimilarity(serviceDescription, data.description);
            
            if (similarity >= 0.6) {
              descMatches.push({
                code: data.code,
                description: data.description,
                confidence: similarity,
                nonFacilityRate: data.nonFacilityRate || null,
                facilityRate: data.facilityRate || null,
              });
            }
          });
        }
      } catch (error) {
        console.log('[MEDICARE_MATCHER] Error querying cptCodeMappings collection:', error);
      }
    }
    
    // Sort matches by confidence and return the best match
    if (descMatches.length > 0) {
      descMatches.sort((a, b) => b.confidence - a.confidence);
      console.log(`[MEDICARE_MATCHER] Found ${descMatches.length} description matches, best match:`, descMatches[0]);
      return {
        ...descMatches[0],
        reasoning: `Matched "${serviceDescription}" to "${descMatches[0].description}" with ${(descMatches[0].confidence * 100).toFixed(0)}% confidence`
      };
    }
    
    console.log('[MEDICARE_MATCHER] No matches found by description.');
    return null;
  } catch (error) {
    console.error('[MEDICARE_MATCHER] Error finding match by description:', error);
    return null;
  }
}

export {
  lookupMedicareRate,
  matchServiceToMedicare
}; 