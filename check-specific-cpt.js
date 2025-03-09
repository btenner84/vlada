require('dotenv').config(); // Load environment variables from .env file

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
  process.exit(1);
}

// Check a specific CPT code
async function checkSpecificCPT() {
  try {
    const cptCodes = ['99385', '71045', '92502', '80053']; // Common CPT codes
    
    for (const code of cptCodes) {
      console.log(`Checking CPT code: ${code}`);
      const docRef = db.collection('cptCodeMappings').doc(code);
      const doc = await docRef.get();
      
      if (doc.exists) {
        const data = doc.data();
        console.log('CPT Code:', code);
        console.log('Description:', data.description);
        console.log('Keywords:', data.keywords);
        console.log('Raw data:', JSON.stringify(data, null, 2));
        console.log('-------------------');
      } else {
        console.log(`CPT code ${code} not found in database`);
        console.log('-------------------');
      }
    }
  } catch (error) {
    console.error('Error checking specific CPT code:', error);
  } finally {
    process.exit(0);
  }
}

checkSpecificCPT(); 