require('dotenv').config(); // Load environment variables from .env file

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

// Check if the cptCodeMappings collection exists and has data
async function checkCPTDatabase() {
  try {
    console.log('Checking cptCodeMappings collection...');
    const snapshot = await db.collection('cptCodeMappings').limit(5).get();
    
    if (snapshot.empty) {
      console.log('No CPT codes found in the database. The collection may be empty or not exist.');
      
      // Check if the collection exists
      const collections = await db.listCollections();
      const collectionNames = collections.map(col => col.id);
      console.log('Available collections:', collectionNames);
      
      if (!collectionNames.includes('cptCodeMappings')) {
        console.log('The cptCodeMappings collection does not exist. You need to run the import script first.');
      }
      
      return;
    }
    
    console.log(`Found ${snapshot.size} CPT codes in the database. Here are some examples:`);
    snapshot.forEach(doc => {
      console.log('CPT Code:', doc.id);
      console.log('Description:', doc.data().description);
      console.log('Keywords:', doc.data().keywords);
      console.log('-------------------');
    });
    
    // Count total documents
    try {
      const countSnapshot = await db.collection('cptCodeMappings').count().get();
      console.log(`Total CPT codes in database: ${countSnapshot.data().count}`);
    } catch (error) {
      console.log('Could not get exact count. This may be due to Firestore limitations.');
    }
    
  } catch (error) {
    console.error('Error checking CPT database:', error);
  } finally {
    process.exit(0);
  }
}

checkCPTDatabase(); 