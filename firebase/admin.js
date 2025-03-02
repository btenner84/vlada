import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Helper function to properly format the private key
const formatPrivateKey = (key) => {
  if (!key) return '';
  // If the key already contains newlines, it's already formatted correctly
  if (key.includes('\n')) return key;
  // If the key is a JSON string with escaped newlines, parse it and replace them
  if (key.includes('\\n')) return key.replace(/\\n/g, '\n');
  // If the key is a base64 string without newlines, add them
  return key.replace(/-----BEGIN PRIVATE KEY-----/g, '-----BEGIN PRIVATE KEY-----\n')
            .replace(/-----END PRIVATE KEY-----/g, '\n-----END PRIVATE KEY-----\n')
            .replace(/(.{64})/g, '$1\n');
};

const firebaseAdminConfig = {
  credential: cert({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  }),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET
};

// Initialize Firebase Admin
function initAdmin() {
  try {
    if (getApps().length === 0) {
      const app = initializeApp(firebaseAdminConfig);
      console.log('Initialized Firebase Admin');
      return app;
    }
    return getApps()[0];
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
    throw error;
  }
}

const app = initAdmin();
const adminDb = getFirestore(app);
const adminStorage = getStorage(app);

export { adminDb, adminStorage }; 