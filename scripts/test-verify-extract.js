/**
 * Test script for the combined verification and extraction functionality
 * 
 * Run with: node scripts/test-verify-extract.js
 */

const { combinedVerifyExtract } = require('../services/openaiService');

// Sample medical bill text (simplified for testing)
const medicalBillText = `
PATIENT STATEMENT
Patient: John Doe
DOB: 01/15/1980
Account #: 12345678
Service Date: 03/15/2023

CHARGES:
Office Visit (99213): $150.00
Lab Work (80053): $75.00
X-Ray (70100): $225.00

TOTAL CHARGES: $450.00
INSURANCE PAYMENT: $360.00
PATIENT RESPONSIBILITY: $90.00

Please remit payment to:
Medical Center
123 Health St.
Anytown, USA 12345
`;

// Sample non-medical document text
const nonMedicalText = `
INVOICE
Invoice #: INV-2023-001
Date: 03/20/2023

BILL TO:
ABC Company
123 Business Rd.
Anytown, USA 12345

ITEMS:
Web Design Services: $1,500.00
Hosting (Annual): $120.00
Domain Registration: $15.00

TOTAL DUE: $1,635.00

Payment due within 30 days.
Thank you for your business!
`;

// Test function
async function runTest() {
  console.log('=== TESTING COMBINED VERIFICATION AND EXTRACTION ===\n');
  
  // Test with medical bill
  console.log('Testing with medical bill text...');
  try {
    const medicalResult = await combinedVerifyExtract(medicalBillText, {
      model: 'gpt-3.5-turbo' // Use a faster model for testing
    });
    
    console.log('\nMEDICAL BILL RESULT:');
    console.log('Verification:', JSON.stringify(medicalResult.verification, null, 2));
    console.log('Is Medical Bill:', medicalResult.verification.isMedicalBill);
    console.log('Confidence:', medicalResult.verification.confidence);
    console.log('Reason:', medicalResult.verification.reason);
    
    if (medicalResult.extraction) {
      console.log('\nExtraction Sample:');
      console.log('Patient Name:', medicalResult.extraction.patientInfo?.name);
      console.log('Total Charges:', medicalResult.extraction.billingInfo?.totalCharges);
      console.log('Service Date Start:', medicalResult.extraction.serviceDates?.startDate);
    }
  } catch (error) {
    console.error('Error testing medical bill:', error);
  }
  
  console.log('\n-----------------------------------\n');
  
  // Test with non-medical document
  console.log('Testing with non-medical document text...');
  try {
    const nonMedicalResult = await combinedVerifyExtract(nonMedicalText, {
      model: 'gpt-3.5-turbo' // Use a faster model for testing
    });
    
    console.log('\nNON-MEDICAL DOCUMENT RESULT:');
    console.log('Verification:', JSON.stringify(nonMedicalResult.verification, null, 2));
    console.log('Is Medical Bill:', nonMedicalResult.verification.isMedicalBill);
    console.log('Confidence:', nonMedicalResult.verification.confidence);
    console.log('Reason:', nonMedicalResult.verification.reason);
    
    if (nonMedicalResult.extraction) {
      console.log('\nExtraction Sample (should be null):');
      console.log(JSON.stringify(nonMedicalResult.extraction, null, 2));
    } else {
      console.log('\nExtraction correctly returned null for non-medical document');
    }
  } catch (error) {
    console.error('Error testing non-medical document:', error);
  }
  
  console.log('\n=== TEST COMPLETED ===');
}

// Run the test
runTest().catch(console.error); 