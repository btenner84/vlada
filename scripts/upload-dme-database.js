import xlsx from 'xlsx';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import admin from 'firebase-admin';
import dotenv from 'dotenv';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Initialize Firebase Admin
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
};

if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
  console.error('Missing required Firebase credentials in environment variables');
  process.exit(1);
}

// Initialize Firebase
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.projectId}.firebaseio.com`,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });
}

const db = admin.firestore();

// Path to the DME Excel file
const dmeFilePath = '/Users/bentenner/vlada/Databases/DME.xlsx';

// Function to generate keywords from description
function generateKeywords(description) {
  if (!description) return [];
  
  // Common DME stopwords to filter out
  const stopwords = ['the', 'and', 'for', 'with', 'of', 'to', 'in', 'on', 'at', 'by', 'or',
                    'each', 'per', 'unit', 'item', 'equipment', 'supply', 'device'];
  
  // Split, filter and return unique keywords
  return [...new Set(
    description
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(' ')
      .filter(word => word.length > 2 && !stopwords.includes(word))
      .map(word => word.trim())
  )];
}

// Common DME categories and keywords for category determination
const dmeCategories = {
  'Oxygen Equipment': ['oxygen', 'concentrator', 'tank', 'portable oxygen', 'o2'],
  'Mobility Devices': ['wheelchair', 'walker', 'cane', 'crutches', 'scooter'],
  'Hospital Beds': ['hospital bed', 'bed', 'mattress', 'rails', 'trapeze'],
  'CPAP/BiPAP': ['cpap', 'bipap', 'sleep apnea', 'mask', 'ventilator'],
  'Diabetic Supplies': ['glucose', 'test strips', 'lancets', 'insulin pump'],
  'Orthotic Devices': ['brace', 'orthotic', 'splint', 'support', 'compression'],
  'Prosthetic Devices': ['prosthetic', 'artificial limb', 'prosthesis']
};

// Function to determine DME category based on code and description
function determineDMECategory(code, description) {
  const normalizedDesc = description.toLowerCase();
  
  // Check code prefix first
  if (code.startsWith('E')) {
    if (/E0[4-6]/.test(code)) return 'Mobility Devices';
    if (/E0[1-3]/.test(code)) return 'Hospital Beds';
    if (/E0[7-9]/.test(code)) return 'Oxygen Equipment';
    if (/E1[3-4]/.test(code)) return 'CPAP/BiPAP';
  } else if (code.startsWith('L')) {
    if (normalizedDesc.includes('orthotic') || normalizedDesc.includes('brace')) return 'Orthotic Devices';
    if (normalizedDesc.includes('prosthetic') || normalizedDesc.includes('artificial')) return 'Prosthetic Devices';
  } else if (code.startsWith('K')) {
    if (normalizedDesc.includes('glucose') || normalizedDesc.includes('diabetic')) return 'Diabetic Supplies';
  }
  
  // Check description keywords if code pattern didn't match
  for (const [category, keywords] of Object.entries(dmeCategories)) {
    if (keywords.some(keyword => normalizedDesc.includes(keyword))) {
      return category;
    }
  }
  
  return 'Other DME';
}

async function uploadDMEDatabase() {
  try {
    console.log('Reading DME Excel file...');
    const workbook = xlsx.readFile(dmeFilePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(worksheet);
    
    console.log(`Found ${data.length} DME codes to process`);
    
    // Create a batch for Firestore operations
    let batch = db.batch();
    let operationCount = 0;
    const batchLimit = 500; // Firestore batch limit
    
    for (const item of data) {
      if (!item.code || !item.description) {
        console.warn('Skipping invalid DME entry:', item);
        continue;
      }
      
      // Generate keywords for searching
      const keywords = generateKeywords(item.description);
      
      // Determine DME category
      const category = determineDMECategory(item.code, item.description);
      
      // Create the document data
      const dmeData = {
        code: item.code,
        description: item.description,
        price: item.price || null,
        category: category,
        keywords: keywords,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      };
      
      // Add to batch
      const docRef = db.collection('dmeCodes').doc(item.code);
      batch.set(docRef, dmeData);
      operationCount++;
      
      // If we've reached the batch limit, commit and start a new batch
      if (operationCount >= batchLimit) {
        console.log(`Committing batch of ${operationCount} operations...`);
        await batch.commit();
        batch = db.batch();
        operationCount = 0;
      }
    }
    
    // Commit any remaining operations
    if (operationCount > 0) {
      console.log(`Committing final batch of ${operationCount} operations...`);
      await batch.commit();
    }
    
    console.log('DME database upload completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error uploading DME database:', error);
    process.exit(1);
  }
}

// Run the upload
uploadDMEDatabase(); 