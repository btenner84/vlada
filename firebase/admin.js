import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const firebaseAdminConfig = {
  credential: cert({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
};

// Initialize Firebase Admin
function initAdmin() {
  if (getApps().length === 0) {
    const app = initializeApp(firebaseAdminConfig);
    console.log('Initialized Firebase Admin');
    return app;
  }
  return getApps()[0];
}

const app = initAdmin();
const adminDb = getFirestore(app);
const adminStorage = getStorage(app);

export { adminDb, adminStorage }; 