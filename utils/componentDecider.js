import { OpenAI } from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Decide whether a service should use professional component (Medicare PFS) or 
 * facility component (OPPS) pricing
 * 
 * @param {object} service - The service object
 * @param {object} billContext - Context about the entire bill
 * @returns {Promise<object>} - Decision with component type and confidence
 */
async function decideServiceComponent(service, billContext = {}) {
  try {
    console.log(`[COMPONENT_DECIDER] Deciding component type for service: "${service.description}"`);
    
    // First, check if we have explicit indicators in the service description
    const explicitDecision = checkExplicitIndicators(service.description);
    
    if (explicitDecision) {
      console.log(`[COMPONENT_DECIDER] Found explicit indicator: ${explicitDecision.componentType} (${explicitDecision.confidence.toFixed(2)})`);
      return explicitDecision;
    }
    
    // Check bill context for facility type
    if (billContext.facilityType) {
      const contextDecision = decideBaedOnFacilityType(billContext.facilityType);
      
      if (contextDecision) {
        console.log(`[COMPONENT_DECIDER] Decision based on facility type (${billContext.facilityType}): ${contextDecision.componentType} (${contextDecision.confidence.toFixed(2)})`);
        return contextDecision;
      }
    }
    
    // If no explicit indicators or clear context, use AI to analyze
    console.log(`[COMPONENT_DECIDER] No explicit indicators found, using AI to analyze`);
    return analyzeWithAI(service, billContext);
  } catch (error) {
    console.error('[COMPONENT_DECIDER] Error deciding service component:', error);
    
    // Default to professional component if there's an error
    return {
      componentType: 'professional',
      database: 'PFS',
      confidence: 0.5,
      reasoning: 'Default to professional component due to error in decision process'
    };
  }
}

/**
 * Check for explicit indicators in the service description
 * @param {string} description - The service description
 * @returns {object|null} - Component decision or null
 */
function checkExplicitIndicators(description) {
  if (!description) return null;
  
  const normalizedDesc = description.toLowerCase();
  
  // Check for professional component indicators
  const professionalIndicators = [
    /\bprof(essional)?\s+comp(onent)?\b/i,
    /\bphysician\s+service\b/i,
    /\bprof\s+fee\b/i,
    /\bprofessional\s+fee\b/i,
    /\bphysician\s+fee\b/i,
    /\bdoctor\s+fee\b/i,
    /\bsurgeon\s+fee\b/i,
    /\banesthesiologist\s+fee\b/i,
    /\bradiologist\s+fee\b/i,
    /\binterpretation\s+only\b/i,
    /\binterpretation\s+and\s+report\b/i,
    /\bprof\b/i
  ];
  
  // Check for facility component indicators
  const facilityIndicators = [
    /\bfacility\s+comp(onent)?\b/i,
    /\btechnical\s+comp(onent)?\b/i,
    /\bhospital\s+fee\b/i,
    /\bfacility\s+fee\b/i,
    /\btechnical\s+fee\b/i,
    /\bequipment\s+fee\b/i,
    /\broom\s+fee\b/i,
    /\bfacility\b/i,
    /\bhospital\s+charge\b/i,
    /\boperating\s+room\b/i,
    /\brecovery\s+room\b/i,
    /\bemergency\s+room\b/i,
    /\bprocedure\s+room\b/i,
    /\btech\b/i
  ];
  
  // Check for professional indicators
  for (const pattern of professionalIndicators) {
    if (pattern.test(normalizedDesc)) {
      return {
        componentType: 'professional',
        database: 'PFS',
        confidence: 0.9,
        reasoning: `Service description contains explicit professional component indicator: ${pattern}`
      };
    }
  }
  
  // Check for facility indicators
  for (const pattern of facilityIndicators) {
    if (pattern.test(normalizedDesc)) {
      return {
        componentType: 'facility',
        database: 'OPPS',
        confidence: 0.9,
        reasoning: `Service description contains explicit facility component indicator: ${pattern}`
      };
    }
  }
  
  // Check for global service indicators (both professional and technical)
  if (/\bglobal\b/i.test(normalizedDesc) || /\bcomplete\s+procedure\b/i.test(normalizedDesc)) {
    return {
      componentType: 'global',
      database: 'PFS', // Use PFS for global services, but we'll need to handle this specially
      confidence: 0.85,
      reasoning: 'Service description indicates a global service (both professional and technical components)'
    };
  }
  
  return null;
}

/**
 * Decide based on facility type
 * @param {string} facilityType - The type of facility
 * @returns {object|null} - Component decision or null
 */
function decideBaedOnFacilityType(facilityType) {
  if (!facilityType) return null;
  
  const normalizedType = facilityType.toLowerCase();
  
  // Facility types that typically use OPPS
  if (
    normalizedType.includes('hospital') || 
    normalizedType.includes('outpatient') ||
    normalizedType.includes('emergency') ||
    normalizedType.includes('asc') ||
    normalizedType.includes('ambulatory surgical center')
  ) {
    return {
      componentType: 'facility',
      database: 'OPPS',
      confidence: 0.8,
      reasoning: `Facility type (${facilityType}) typically uses OPPS for billing`
    };
  }
  
  // Facility types that typically use PFS
  if (
    normalizedType.includes('office') ||
    normalizedType.includes('clinic') ||
    normalizedType.includes('physician') ||
    normalizedType.includes('private practice')
  ) {
    return {
      componentType: 'professional',
      database: 'PFS',
      confidence: 0.8,
      reasoning: `Facility type (${facilityType}) typically uses PFS for billing`
    };
  }
  
  return null;
}

/**
 * Analyze the service with AI to determine component type
 * @param {object} service - The service object
 * @param {object} billContext - Context about the entire bill
 * @returns {Promise<object>} - Component decision
 */
async function analyzeWithAI(service, billContext = {}) {
  try {
    console.log(`[COMPONENT_DECIDER] Analyzing with AI: "${service.description}"`);
    
    // Create a prompt for OpenAI
    let prompt = `I need to determine whether this outpatient procedure service should be billed using the professional component (Medicare Physician Fee Schedule) or the facility component (Outpatient Prospective Payment System).

Service Description: "${service.description}"`;

    // Add service code if available
    if (service.code) {
      prompt += `\nService Code: ${service.code}`;
    }
    
    // Add service category if available
    if (service.category) {
      prompt += `\nService Category: ${service.category}`;
    }
    
    // Add bill context
    prompt += `\n\nBill Context:`;
    
    if (billContext.facilityType) {
      prompt += `\nFacility Type: ${billContext.facilityType}`;
    }
    
    if (billContext.facilityName) {
      prompt += `\nFacility Name: ${billContext.facilityName}`;
    }
    
    if (billContext.billType) {
      prompt += `\nBill Type: ${billContext.billType}`;
    }
    
    if (billContext.placeOfService) {
      prompt += `\nPlace of Service: ${billContext.placeOfService}`;
    }
    
    // Add other services from the bill for context
    if (billContext.otherServices && billContext.otherServices.length > 0) {
      prompt += `\n\nOther Services on the Bill:`;
      billContext.otherServices.slice(0, 5).forEach(otherService => {
        prompt += `\n- ${otherService.description}`;
      });
    }
    
    prompt += `\n\nPlease determine whether this service should be billed using:
1. Professional Component (Medicare PFS) - typically used for physician services, interpretations, and professional work
2. Facility Component (OPPS) - typically used for hospital outpatient department technical services, equipment, supplies
3. Global Service (both components) - typically used when a single provider performs both the professional and technical components

Respond in JSON format with the following structure:
{
  "componentType": "professional", // or "facility" or "global"
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this component type is appropriate"
}`;

    console.log('[COMPONENT_DECIDER] Calling OpenAI API for component decision');
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are a medical billing expert specializing in outpatient procedure billing. Your task is to determine whether a service should be billed using the professional component (Medicare PFS) or the facility component (OPPS).' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });
    
    // Parse the response
    const result = JSON.parse(response.choices[0].message.content);
    console.log('[COMPONENT_DECIDER] OpenAI response:', JSON.stringify(result, null, 2));
    
    // Map component type to database
    let database = 'PFS'; // Default to PFS
    
    if (result.componentType === 'facility') {
      database = 'OPPS';
    } else if (result.componentType === 'global') {
      // For global services, we'll use PFS but may need special handling
      database = 'PFS';
    }
    
    return {
      componentType: result.componentType,
      database: database,
      confidence: result.confidence || 0.7,
      reasoning: result.reasoning || 'Determined using AI analysis'
    };
  } catch (error) {
    console.error('[COMPONENT_DECIDER] Error analyzing with AI:', error);
    
    // Default to professional component if there's an error
    return {
      componentType: 'professional',
      database: 'PFS',
      confidence: 0.5,
      reasoning: 'Default to professional component due to error in AI analysis'
    };
  }
}

export { decideServiceComponent }; 