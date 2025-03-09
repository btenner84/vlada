const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
require('dotenv').config(); // Load environment variables from .env file

// Path to your Excel file - using the exact path you provided
const filePath = '/Users/bentenner/medicareCPT.xlsx';
console.log(`Will read Excel file from: ${filePath}`);

// Check if file exists
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// Import Firebase Admin modules
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Improved private key formatting function (copied from your firebase/admin.js)
const formatPrivateKey = (key) => {
  if (!key) {
    console.error('FIREBASE_PRIVATE_KEY is missing or empty');
    return '';
  }
  
  try {
    // First, handle JSON escaped strings
    let formattedKey = key;
    if (formattedKey.startsWith('"') && formattedKey.endsWith('"')) {
      try {
        formattedKey = JSON.parse(formattedKey);
      } catch (e) {
        console.warn('Failed to parse private key as JSON string');
      }
    }
    
    // Then, replace literal \n with actual newlines
    if (formattedKey.includes('\\n')) {
      formattedKey = formattedKey.replace(/\\n/g, '\n');
    }
    
    return formattedKey;
  } catch (error) {
    console.error('Error formatting private key:', error);
    return key; // Return original key as fallback
  }
};

// Initialize Firebase Admin
let db;
try {
  console.log('Initializing Firebase Admin...');
  
  // Log environment variable presence (without logging actual values)
  console.log(`Environment check - Project ID exists: ${!!process.env.FIREBASE_PROJECT_ID}`);
  console.log(`Environment check - Client Email exists: ${!!process.env.FIREBASE_CLIENT_EMAIL}`);
  console.log(`Environment check - Private Key exists: ${!!process.env.FIREBASE_PRIVATE_KEY}`);
  
  // Format the private key
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  
  // Initialize the app
  const app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'vladahealth-b2a00.appspot.com'
  });
  
  db = getFirestore(app);
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Firebase Admin initialization error:', error);
  console.error('Make sure your .env file contains the following variables:');
  console.error('FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_STORAGE_BUCKET');
  process.exit(1);
}

const cptCollection = db.collection('cptCodeMappings');

async function importCPTCodesFromExcel() {
  try {
    console.log(`Reading Excel file from: ${filePath}`);
    
    // Read the Excel file
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const rawData = xlsx.utils.sheet_to_json(worksheet);
    console.log(`Found ${rawData.length} rows in Excel file`);
    
    // Display the first row to understand the structure
    if (rawData.length > 0) {
      console.log('First row structure:', Object.keys(rawData[0]));
      console.log('First row data:', rawData[0]);
      
      // Log all column names to identify the reimbursement rate columns
      const keys = Object.keys(rawData[0]);
      console.log('All column names:');
      keys.forEach((key, index) => {
        console.log(`Column ${index} (${String.fromCharCode(65 + index)}): ${key}`);
      });
    }
    
    // Process each row - handle the specific structure of this Excel file
    const cptData = rawData.map(row => {
      // Based on the error logs, we can see the actual column names
      // The CPT code is in 'Addendum B – Relative Value Units and Related Information Used in CY 2025 Final Rule'
      // The description is in '__EMPTY_3'
      const codeColumnName = 'Addendum B – Relative Value Units and Related Information Used in CY 2025 Final Rule';
      const descColumnName = '__EMPTY_3';
      
      let cptCode = row[codeColumnName];
      let description = row[descColumnName];
      
      // Get reimbursement rates from columns L and M
      let nonFacilityRate = null;
      let facilityRate = null;
      
      // Use the correct column names from the Excel file
      if (row['__EMPTY_11'] !== undefined) { // Column L - Total Non Facility Reimbursement Rate
        nonFacilityRate = row['__EMPTY_11'];
      }
      if (row['__EMPTY_12'] !== undefined) { // Column M - Total Facility Reimbursement Rate
        facilityRate = row['__EMPTY_12'];
      }
      
      // Skip if code or description is not found
      if (!cptCode || !description) {
        // Try alternative column names if the main ones don't work
        const keys = Object.keys(row);
        
        // If we have at least one column, try using the first column for code
        if (keys.length > 0 && !cptCode) {
          cptCode = row[keys[0]];
        }
        
        // If we have at least 4 columns, try using the fourth column for description
        if (keys.length >= 4 && !description) {
          description = row[keys[3]]; // __EMPTY_3 is likely the 4th column
        }
        
        // If still not found, log and skip
        if (!cptCode || !description) {
          return null;
        }
      }
      
      // Convert to string and trim
      cptCode = cptCode.toString().trim();
      description = description.toString().trim();
      
      // Skip if code or description is empty after trimming
      if (!cptCode || !description) {
        return null;
      }
      
      // Skip if the code is actually a footnote or header
      if (cptCode.length > 20 || cptCode.startsWith('Addendum')) {
        return null;
      }
      
      // Convert reimbursement rates to numbers if they exist
      if (nonFacilityRate !== null && nonFacilityRate !== undefined) {
        nonFacilityRate = parseFloat(nonFacilityRate.toString().replace(/[^\d.-]/g, ''));
        if (isNaN(nonFacilityRate)) nonFacilityRate = null;
      }
      
      if (facilityRate !== null && facilityRate !== undefined) {
        facilityRate = parseFloat(facilityRate.toString().replace(/[^\d.-]/g, ''));
        if (isNaN(facilityRate)) facilityRate = null;
      }
      
      // Generate keywords for better matching
      const keywords = generateKeywords(description);
      
      return {
        code: cptCode,
        description: description.toLowerCase(),
        keywords,
        nonFacilityRate: nonFacilityRate,
        facilityRate: facilityRate,
        lastUpdated: new Date()
      };
    }).filter(Boolean); // Remove null entries
    
    console.log(`Processed ${cptData.length} valid CPT codes`);
    
    // Upload to Firestore in batches
    await uploadToFirestore(cptData);
    
    console.log('CPT code import completed successfully!');
  } catch (error) {
    console.error('Error importing CPT codes:', error);
    process.exit(1);
  }
}

// Generate keywords from description for better matching
function generateKeywords(description) {
  if (!description) return [];
  
  // Convert to string, lowercase, and remove special characters
  const text = description.toString().toLowerCase().replace(/[^\w\s]/g, '');
  
  // Common medical terms and stopwords to filter out
  const stopwords = ['the', 'and', 'for', 'with', 'of', 'to', 'in', 'on', 'at', 'by', 'or',
                    'each', 'per', 'any', 'all', 'other', 'others', 'patient', 'service'];
  
  // Split into words, filter, and take unique values
  return [...new Set(
    text.split(' ')
      .filter(word => word.length > 2 && !stopwords.includes(word))
      .map(word => word.trim())
  )];
}

// Upload data to Firestore in batches
async function uploadToFirestore(data) {
  const batchSize = 500; // Firestore limit
  let batchCount = 0;
  let totalUploaded = 0;
  let skippedCodes = 0;
  
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = db.batch();
    const chunk = data.slice(i, i + batchSize);
    let chunkUploaded = 0;
    
    chunk.forEach(item => {
      // Sanitize the code for use as a Firestore document ID
      // Replace slashes with dashes and remove any other invalid characters
      const sanitizedCode = item.code.replace(/\//g, '-').replace(/[.#$[\]]/g, '_');
      
      if (sanitizedCode !== item.code) {
        console.log(`Sanitized code: ${item.code} -> ${sanitizedCode}`);
      }
      
      try {
        const docRef = cptCollection.doc(sanitizedCode);
        
        // Store the original code in the document
        const docData = {
          ...item,
          originalCode: item.code,
          code: sanitizedCode
        };
        
        batch.set(docRef, docData);
        chunkUploaded++;
      } catch (error) {
        console.error(`Error adding document for code ${item.code}:`, error);
        skippedCodes++;
      }
    });
    
    try {
      await batch.commit();
      batchCount++;
      totalUploaded += chunkUploaded;
      console.log(`Uploaded batch ${batchCount} (${totalUploaded}/${data.length} CPT codes)`);
    } catch (error) {
      console.error(`Error committing batch ${batchCount}:`, error);
      console.error('This batch will be skipped. Some codes may not be imported.');
    }
  }
  
  if (skippedCodes > 0) {
    console.log(`Skipped ${skippedCodes} codes due to errors`);
  }
}

// Run the import
importCPTCodesFromExcel()
  .then(() => {
    console.log('Import completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Import failed:', error);
    process.exit(1);
  }); 