/**
 * Test script for the Enhanced AI Analysis
 * 
 * This script tests the enhanced AI integration for medical bill analysis
 * Run with: node scripts/test-enhanced-ai.js
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { analyzeMedicalBillText } = require('../utils/openaiClient');

// Sample medical bill text for testing
const sampleText = `
MEDICAL BILLING INVOICE

PATIENT INFORMATION
Kemba Harris
(555) 595-5999
11 Rosewood Drive, Collingwood, NY 33580

PERSCRIBING PHYSICIAN'S INFORMATION
Dr. Alanah Gomez
(555) 505-5000
102 Trope Street, Newborough, NY 33580

BILL INFORMATION
Date of Service: 03/15/2025
Bill Date: 03/25/2025
Due Date: 04/15/2025

SERVICES
1. Initial Consultation - $150.00
2. Blood Work (Complete Blood Count) - $75.00
3. EKG - $125.00

SUBTOTAL: $350.00
INSURANCE ADJUSTMENT: -$100.00
TOTAL DUE: $250.00

INSURANCE INFORMATION
Provider: BlueCross BlueShield
Policy Number: BCX1234567
Group Number: BC99887

PAYMENT OPTIONS
1. Online: www.concordiahill.com/pay
2. Phone: (555) 505-5000
3. Mail: 102 Trope Street, Newborough, NY 33580

CONCORDIA HILL MEDICAL CENTER
For billing questions or concerns, email us at invoices@concordiahill.com
`;

// Test the OpenAI integration directly
async function testOpenAIIntegration() {
  console.log('Testing OpenAI integration directly...');
  console.log('Sample text length:', sampleText.length);
  
  try {
    console.log('Calling analyzeMedicalBillText...');
    const result = await analyzeMedicalBillText(sampleText);
    
    console.log('\n--- OpenAI Analysis Result ---');
    console.log(JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    console.error('Error testing OpenAI integration:', error);
    throw error;
  }
}

// Test the enhanced analyze endpoint
async function testEnhancedAnalyzeEndpoint() {
  // Create a temporary text file with sample data
  const tempFilePath = path.join(__dirname, 'temp-sample-bill.txt');
  fs.writeFileSync(tempFilePath, sampleText);
  
  console.log('Testing enhanced analyze endpoint...');
  try {
    // For this test, we'd normally upload the file and get a URL
    // Since we can't do that in this script, we'll simulate it
    
    console.log('Note: This test requires a running local server');
    console.log('You should start your Next.js dev server with:');
    console.log('npm run dev');
    
    const apiUrl = 'http://localhost:3000/api/analyze-full';
    
    // In a real scenario, this would be a storage URL
    // For testing, we're using a base64 encoded version of the text
    const fakeFileUrl = `data:text/plain;base64,${Buffer.from(sampleText).toString('base64')}`;
    
    const requestBody = {
      billId: 'test-bill-id',
      fileUrl: fakeFileUrl,
      userId: 'test-user-id'
    };
    
    console.log('Making request to API...');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText}\n${errorText}`);
    }
    
    const result = await response.json();
    console.log('\n--- API Result ---');
    console.log(JSON.stringify(result, null, 2));
    
    // Clean up
    fs.unlinkSync(tempFilePath);
    
    return result;
  } catch (error) {
    console.error('Error testing API endpoint:', error);
    // Clean up even if there's an error
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    throw error;
  }
}

// Run the tests
async function runTests() {
  console.log('=== Starting Enhanced AI Integration Tests ===\n');
  
  try {
    // Test the OpenAI integration directly
    await testOpenAIIntegration();
    
    console.log('\n=== OpenAI Integration Test Passed ===\n');
    
    // Test the API endpoint (uncomment to test)
    // await testEnhancedAnalyzeEndpoint();
    // console.log('\n=== API Endpoint Test Passed ===\n');
    
    console.log('All tests completed successfully!');
  } catch (error) {
    console.error('\n=== Test Failed ===');
    console.error(error);
    process.exit(1);
  }
}

// Run the tests
runTests(); 