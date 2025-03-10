const { OpenAI } = require('openai');
require('dotenv').config({ path: '.env.local' });

// Test service categorization directly with OpenAI
async function testServiceCategorization() {
  console.log('=== Testing Service Categorization with OpenAI ===');
  console.log('API Key (first 5 chars):', process.env.OPENAI_API_KEY?.substring(0, 5) || 'Not found');
  
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // Create test services
    const testServices = [
      { description: "EMERGENCY ROOM-GENERAL", code: "0450", amount: "$2,579.90" },
      { description: "COMPREHENSIVE METABOLIC PANEL (LAB)", code: "80053", amount: "$400.20" },
      { description: "ONDANSETRON HCL 4 MG INJECTION", code: "0636", amount: "$45.00" }
    ];
    
    for (const service of testServices) {
      console.log(`\nTesting categorization for: ${service.description}`);
      
      // Create a prompt for OpenAI
      const prompt = `I need to categorize this medical service into one of six predefined categories:
      
Service Description: "${service.description}"
${service.code ? `CPT/HCPCS Code: ${service.code}` : ''}

The six categories are:
1. Office visits and Consultations - includes preventive visits, check-ups, evaluations, consultations
2. Procedures and Surgeries - includes surgical procedures, biopsies, repairs, implants
3. Lab and Diagnostic Tests - includes laboratory tests, imaging, scans, blood work
4. Drugs and Infusions - includes medications, injections, infusions, vaccines
5. Medical Equipment - includes supplies, devices, prosthetics, orthotics
6. Hospital stays and emergency care visits - includes inpatient care, emergency room visits

Please categorize this service into one of these six categories. Respond in JSON format with the following structure:
{
  "category": "Category Name",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this category is appropriate"
}`;
      
      console.log('Sending request to OpenAI...');
      const startTime = Date.now();
      
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { 
            role: 'system', 
            content: 'You are a medical billing expert specializing in categorizing medical services. Your task is to categorize services into one of six predefined categories. Be precise and consider both the service description and CPT/HCPCS code if provided.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      });
      
      const endTime = Date.now();
      console.log(`Response received in ${(endTime - startTime) / 1000} seconds`);
      
      const result = JSON.parse(response.choices[0].message.content);
      console.log('Categorization result:', result);
    }
    
    console.log('\nService categorization test completed successfully!');
    return true;
  } catch (error) {
    console.error('Error testing service categorization:', error);
    console.log('Error details:', {
      message: error.message,
      type: error.type,
      code: error.code,
      name: error.name,
      status: error.status,
    });
    return false;
  }
}

// Run the test
testServiceCategorization()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  }); 