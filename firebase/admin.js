import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Enhanced private key formatting function
const formatPrivateKey = (key) => {
  if (!key) {
    console.error('FIREBASE_PRIVATE_KEY is missing or empty');
    return '';
  }
  
  // Handle multiple possible formats of the key
  // 1. Key with literal \n characters that need to be replaced
  // 2. Key with actual newlines
  // 3. Key with escaped newlines from JSON stringification
  let formattedKey = key;
  
  // Replace literal \n with actual newlines
  if (formattedKey.includes('\\n')) {
    formattedKey = formattedKey.replace(/\\n/g, '\n');
  }
  
  // Handle JSON escaped newlines
  try {
    // If the key is JSON stringified with escape characters
    if (formattedKey.startsWith('"') && formattedKey.endsWith('"')) {
      formattedKey = JSON.parse(formattedKey);
    }
  } catch (e) {
    // Not a JSON string, continue with current value
    console.warn('Private key is not a JSON string:', e.message);
  }
  
  return formattedKey;
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
let adminDb, adminStorage;

try {
  const app = initAdmin();
  adminDb = getFirestore(app);
  adminStorage = getStorage(app);
  console.log('Firebase Admin services initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase Admin services:', error.message);
  // Don't throw here - let individual API routes handle the error
}

export { adminDb, adminStorage }; 