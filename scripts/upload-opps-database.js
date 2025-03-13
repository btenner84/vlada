import fs from 'fs';
import xlsx from 'xlsx';
import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
let serviceAccount;
try {
  // Try to load from environment variables first
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else if (process.env.FIREBASE_PRIVATE_KEY) {
    // Construct from individual environment variables
    serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  } else {
    // Try to load from a local file as fallback
    const serviceAccountPath = path.resolve(__dirname, '../firebase-service-account.json');
    serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  }
} catch (error) {
  console.error('Error loading Firebase credentials:', error);
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

// Path to the OPPS Excel file
const oppsFilePath = '/Users/bentenner/vlada/Databases/OPPS.xlsx';

async function uploadOPPSDatabase() {
  console.log('Starting OPPS database upload...');
  
  try {
    // Read the Excel file
    console.log(`Reading Excel file from: ${oppsFilePath}`);
    const workbook = xlsx.readFile(oppsFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = xlsx.utils.sheet_to_json(worksheet);
    console.log(`Parsed ${data.length} rows from Excel file`);
    
    // Create a batch for Firestore operations
    let batch = db.batch();
    let batchCount = 0;
    let totalUploaded = 0;
    
    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      // Create a document ID from the HCPCS/CPT code
      const code = row.HCPCS_CPT || row.Code || row.code || `unknown_${i}`;
      const docRef = db.collection('oppsDatabase').doc(code.toString());
      
      // Normalize field names and clean data
      const normalizedData = {
        code: code.toString(),
        description: row.Description || row.description || '',
        apcCode: row.APC || row.apc_code || '',
        apcDescription: row.APC_Description || row.apc_description || '',
        paymentRate: parseFloat(row.Payment_Rate || row.payment_rate || 0) || 0,
        minCopay: parseFloat(row.Minimum_Copayment || row.min_copay || 0) || 0,
        status: row.Status_Indicator || row.status || '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'OPPS_DATABASE'
      };
      
      // Add to batch
      batch.set(docRef, normalizedData);
      batchCount++;
      totalUploaded++;
      
      // Commit batch every 500 documents (Firestore limit)
      if (batchCount >= 500 || i === data.length - 1) {
        console.log(`Committing batch of ${batchCount} documents...`);
        await batch.commit();
        console.log(`Batch committed. Total uploaded: ${totalUploaded}`);
        batch = db.batch();
        batchCount = 0;
      }
    }
    
    console.log(`OPPS database upload complete. Total documents: ${totalUploaded}`);
    
    // Create an index for faster queries
    console.log('Creating indexes for OPPS database...');
    await db.collection('oppsDatabase').doc('metadata').set({
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      totalRecords: totalUploaded,
      source: oppsFilePath
    });
    
    console.log('OPPS database upload and indexing complete!');
    
  } catch (error) {
    console.error('Error uploading OPPS database:', error);
    process.exit(1);
  }
}

// Run the upload function
uploadOPPSDatabase().then(() => {
  console.log('Script completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
}); 