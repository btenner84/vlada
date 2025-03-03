import { adminDb, adminStorage } from '../../firebase/admin';

export default async function handler(req, res) {
  try {
    console.log('Testing Firebase Admin initialization...');
    
    // Test if adminDb and adminStorage are initialized
    const dbInitialized = !!adminDb;
    const storageInitialized = !!adminStorage;
    
    // Only proceed with further tests if basic initialization worked
    let bucketTest = { attempted: false, success: false, error: null };
    
    if (storageInitialized) {
      try {
        bucketTest.attempted = true;
        // Try a simple storage operation
        const bucket = adminStorage.bucket();
        await bucket.exists();
        bucketTest.success = true;
      } catch (error) {
        bucketTest.success = false;
        bucketTest.error = error.message;
      }
    }
    
    // Return comprehensive diagnostic info
    res.status(200).json({
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
      initialization: {
        dbInitialized,
        storageInitialized
      },
      bucketTest,
      environmentVariables: {
        projectIdExists: !!process.env.FIREBASE_PROJECT_ID,
        clientEmailExists: !!process.env.FIREBASE_CLIENT_EMAIL
      }
    });
  } catch (error) {
    console.error('Failed to initialize Firebase Admin services:', error.message);
    // Don't throw here - let individual API routes handle the error
    res.status(500).json({ error: error.message });
  }
} 