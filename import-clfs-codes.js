const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
require('dotenv').config();

// Path to your Excel file
const filePath = '/Users/bentenner/MedicareCLFS.xlsx';
console.log(`Will read CLFS Excel file from: ${filePath}`);

// Check if file exists
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// Import Firebase Admin modules
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Improved private key formatting function
const formatPrivateKey = (key) => {
  if (!key) {
    console.error('FIREBASE_PRIVATE_KEY is missing or empty');
    return '';
  }
  
  try {
    let formattedKey = key;
    if (formattedKey.startsWith('"') && formattedKey.endsWith('"')) {
      try {
        formattedKey = JSON.parse(formattedKey);
      } catch (e) {
        console.warn('Failed to parse private key as JSON string');
      }
    }
    
    if (formattedKey.includes('\\n')) {
      formattedKey = formattedKey.replace(/\\n/g, '\n');
    }
    
    return formattedKey;
  } catch (error) {
    console.error('Error formatting private key:', error);
    return key;
  }
};

// Initialize Firebase Admin
const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  })
});

const db = getFirestore(app);

async function importCLFSCodesFromExcel() {
  try {
    console.log('Reading CLFS Excel file...');
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    console.log(`Found ${data.length} rows in Excel file`);

    const clfsData = data.map(row => {
      // Assuming column B (index 1) is code, G is rate, H is description, I is detailed description
      return {
        code: row['__EMPTY_1'] || '', // Column B
        rate: parseFloat(row['__EMPTY_6']) || 0, // Column G
        description: row['__EMPTY_7'] || '', // Column H
        detailedDescription: row['__EMPTY_8'] || '', // Column I
        type: 'CLFS',
        keywords: generateKeywords(row['__EMPTY_7'] || ''),
        lastUpdated: new Date().toISOString()
      };
    }).filter(item => item.code && item.description); // Filter out any rows without code or description

    console.log(`Processed ${clfsData.length} valid CLFS codes`);
    await uploadToFirestore(clfsData);

  } catch (error) {
    console.error('Error processing CLFS data:', error);
    process.exit(1);
  }
}

function generateKeywords(description) {
  if (!description) return [];
  
  // Convert to lowercase and remove special characters
  const cleanText = description.toLowerCase().replace(/[^\w\s]/g, ' ');
  
  // Split into words and remove duplicates and empty strings
  const words = [...new Set(cleanText.split(/\s+/).filter(word => word.length > 2))];
  
  // Generate combinations of adjacent words (up to 3 words)
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

async function uploadToFirestore(data) {
  const batchSize = 500;
  const collection = db.collection('labCodes'); // New collection for CLFS codes
  
  try {
    console.log('Starting Firestore upload...');
    
    // Process in batches
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = db.batch();
      const currentBatch = data.slice(i, i + batchSize);
      
      currentBatch.forEach(item => {
        const docRef = collection.doc(item.code);
        batch.set(docRef, item);
      });
      
      await batch.commit();
      console.log(`Uploaded batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(data.length / batchSize)}`);
    }
    
    console.log('Successfully uploaded all CLFS codes to Firestore');
    process.exit(0);
  } catch (error) {
    console.error('Error uploading to Firestore:', error);
    process.exit(1);
  }
}

// Run the import
importCLFSCodesFromExcel(); 