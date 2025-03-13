import 'dotenv/config';
import { extractBillingCodes, determineServiceSetting, categorizeWithAdvancedSystem } from '../utils/advancedClassifier.js';

// Test services
const testServices = [
  {
    description: "EMERGENCY ROOM-GENERAL",
    code: "0450",
    amount: "$2,579.90"
  },
  {
    description: "COMPREHENSIVE METABOLIC PANEL (LAB)",
    code: "80053",
    amount: "$400.20"
  },
  {
    description: "ONDANSETRON HCL 4 MG INJECTION",
    code: "J2405",
    amount: "$45.00"
  },
  {
    description: "INPATIENT ROOM & BOARD SEMI-PRIVATE",
    code: "0110",
    amount: "$1,200.00"
  },
  {
    description: "OFFICE VISIT ESTABLISHED PATIENT LEVEL 3",
    code: "99213",
    amount: "$120.00"
  },
  {
    description: "KNEE REPLACEMENT SURGERY",
    code: "27447",
    amount: "$15,000.00"
  }
];

// Sample text with billing codes
const sampleText = `
PATIENT: John Doe
ACCOUNT: 12345678
DATE OF SERVICE: 01/15/2023

DRG: 470 - MAJOR JOINT REPLACEMENT
REVENUE CODE: 0110 - ROOM & BOARD
REVENUE CODE: 0450 - EMERGENCY ROOM
NDC: 12345-6789-01 - MEDICATION
ICD-10: J12.82 - PNEUMONIA DUE TO COVID-19

SERVICES:
1. INPATIENT ROOM & BOARD SEMI-PRIVATE - $1,200.00
2. EMERGENCY ROOM-GENERAL - $2,579.90
3. COMPREHENSIVE METABOLIC PANEL (LAB) - $400.20
4. ONDANSETRON HCL 4 MG INJECTION - $45.00
5. KNEE REPLACEMENT SURGERY - $15,000.00

TOTAL CHARGES: $19,225.10
`;

// Sample bill context
const sampleBillContext = {
  facilityName: "Memorial Hospital",
  providerName: "Dr. Jane Smith",
  billType: "111", // Inpatient bill type
  placeOfService: "21", // Inpatient hospital
  patientType: "Inpatient",
  serviceDate: "01/15/2023"
};

async function runTests() {
  console.log('=== Testing Advanced Classification System ===\n');
  
  // Test 1: Extract billing codes
  console.log('Test 1: Extract Billing Codes');
  const extractedCodes = extractBillingCodes(sampleText);
  console.log('Extracted Codes:', JSON.stringify(extractedCodes, null, 2));
  console.log('\n');
  
  // Test 2: Determine service settings
  console.log('Test 2: Determine Service Settings');
  for (const service of testServices) {
    try {
      const setting = await determineServiceSetting(service, extractedCodes, sampleBillContext);
      console.log(`Service: "${service.description}" -> Setting: ${setting}`);
    } catch (error) {
      console.error(`Error determining setting for "${service.description}":`, error);
    }
  }
  console.log('\n');
  
  // Test 3: Categorize services
  console.log('Test 3: Categorize Services');
  for (const service of testServices) {
    try {
      const setting = await determineServiceSetting(service, extractedCodes, sampleBillContext);
      const categoryResult = await categorizeWithAdvancedSystem(
        { ...service, setting },
        extractedCodes,
        sampleBillContext
      );
      
      console.log(`Service: "${service.description}"`);
      console.log(`  Setting: ${setting}`);
      console.log(`  Category: ${categoryResult.category}`);
      console.log(`  Pricing Model: ${categoryResult.pricingModel}`);
      console.log(`  Confidence: ${categoryResult.confidence || 'Not specified'}`);
      console.log(`  Reasoning: ${categoryResult.reasoning}`);
      console.log('');
    } catch (error) {
      console.error(`Error categorizing service "${service.description}":`, error);
    }
  }
  
  console.log('=== Tests Complete ===');
}

runTests().catch(console.error); 