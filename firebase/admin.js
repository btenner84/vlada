import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';

// Improved private key formatting function for Node.js v22+
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
    
    // Ensure the key has the correct PEM format
    if (!formattedKey.startsWith('-----BEGIN PRIVATE KEY-----')) {
      console.error('Private key does not have the expected PEM format');
    }
    
    return formattedKey;
  } catch (error) {
    console.error('Error formatting private key:', error);
    return key; // Return original key as fallback
  }
};

// Enhanced initialization with better error handling and logging
function initAdmin() {
  try {
    if (!getApps().length) {
      console.log('Initializing Firebase Admin...');
      
      // Log environment variable presence (without logging actual values)
      console.log(`Environment check - Project ID exists: ${!!process.env.FIREBASE_PROJECT_ID}`);
      console.log(`Environment check - Client Email exists: ${!!process.env.FIREBASE_CLIENT_EMAIL}`);
      console.log(`Environment check - Private Key exists: ${!!process.env.FIREBASE_PRIVATE_KEY}`);
      console.log(`Environment check - Storage Bucket exists: ${!!process.env.FIREBASE_STORAGE_BUCKET}`);
      
      // Format the private key
      const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
      console.log(`Formatted private key length: ${privateKey.length}`);
      console.log(`Formatted private key starts with: ${privateKey.substring(0, 10)}...`);
      
      // Initialize the app with proper error handling
      const app = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'vladahealth-b2a00.appspot.com'
      });
      
      console.log('Firebase Admin initialized successfully');
      return app;
    }
    
    console.log('Firebase Admin already initialized');
    return getApps()[0];
  } catch (error) {
    console.error('Firebase Admin initialization error:', error.message);
    console.error('Error stack:', error.stack);
    
    // Provide more context about the error
    if (error.message.includes('private_key')) {
      console.error('This appears to be a private key formatting issue. Check that FIREBASE_PRIVATE_KEY is correctly set and formatted.');
    }
    
    throw error;
  }
}

// Safely initialize admin services with error handling
let adminDb, adminStorage, adminAuth;

try {
  const app = initAdmin();
  adminDb = getFirestore(app);
  adminStorage = getStorage(app);
  adminAuth = getAuth(app);
  console.log('Firebase Admin services initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase Admin services:', error.message);
  // Don't throw here - let individual API routes handle the error
}

// Function to get Firebase Admin services
export function getFirebaseAdmin() {
  // Re-initialize if necessary
  if (!adminDb || !adminStorage || !adminAuth) {
    try {
      const app = initAdmin();
      adminDb = getFirestore(app);
      adminStorage = getStorage(app);
      adminAuth = getAuth(app);
    } catch (error) {
      console.error('Error in getFirebaseAdmin:', error);
      throw new Error('Firebase Admin services could not be initialized');
    }
  }
  
  return {
    db: adminDb,
    storage: adminStorage,
    auth: adminAuth
  };
}

export { adminDb, adminStorage, adminAuth }; 