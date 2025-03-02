import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Helper function to properly format the private key
const formatPrivateKey = (key) => {
  // Log the key format for debugging (without revealing the actual key)
  console.log('Private key type:', typeof key);
  console.log('Private key length:', key ? key.length : 0);
  console.log('Private key starts with:', key ? key.substring(0, 20) + '...' : 'undefined');
  
  if (!key) {
    console.error('Private key is undefined or empty');
    return '';
  }
  
  // If the key is already a properly formatted PEM key, return it as is
  if (key.includes('-----BEGIN PRIVATE KEY-----') && key.includes('\n')) {
    console.log('Key appears to be properly formatted already');
    return key;
  }
  
  // If the key is a JSON string with escaped newlines, parse it and replace them
  if (key.includes('\\n')) {
    console.log('Key contains escaped newlines, replacing them');
    return key.replace(/\\n/g, '\n');
  }
  
  // If the key is wrapped in quotes, remove them
  if (key.startsWith('"') && key.endsWith('"')) {
    console.log('Key is wrapped in quotes, removing them');
    key = key.substring(1, key.length - 1);
  }
  
  console.log('Returning formatted key');
  return key;
};

// Get the project ID from environment variables
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

console.log('Firebase Admin Config:', {
  projectId,
  clientEmail: clientEmail ? 'REDACTED' : 'undefined',
  privateKey: privateKey ? 'REDACTED' : 'undefined',
  storageBucket
});

const firebaseAdminConfig = {
  credential: cert({
    projectId,
    clientEmail,
    privateKey,
  }),
  storageBucket
};

// Initialize Firebase Admin
function initAdmin() {
  try {
    if (getApps().length === 0) {
      console.log('Initializing Firebase Admin...');
      const app = initializeApp(firebaseAdminConfig);
      console.log('Firebase Admin initialized successfully');
      return app;
    }
    console.log('Firebase Admin already initialized');
    return getApps()[0];
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

const app = initAdmin();
const adminDb = getFirestore(app);
const adminStorage = getStorage(app);

export { adminDb, adminStorage }; 