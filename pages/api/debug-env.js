export default function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Check if Firebase Admin environment variables are set
  const envStatus = {
    firebase_project_id: {
      set: Boolean(process.env.FIREBASE_PROJECT_ID),
      value: process.env.FIREBASE_PROJECT_ID === 'vladahealth-b2a00' ? 'Correct' : 'Incorrect',
    },
    firebase_client_email: {
      set: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
      value: process.env.FIREBASE_CLIENT_EMAIL === 'firebase-adminsdk-fbsvc@vladahealth-b2a00.iam.gserviceaccount.com' ? 'Correct' : 'Incorrect',
    },
    firebase_storage_bucket: {
      set: Boolean(process.env.FIREBASE_STORAGE_BUCKET),
      value: process.env.FIREBASE_STORAGE_BUCKET === 'vladahealth-b2a00.firebasestorage.app' ? 'Correct' : 'Incorrect',
    },
    firebase_private_key: {
      set: Boolean(process.env.FIREBASE_PRIVATE_KEY),
      format: process.env.FIREBASE_PRIVATE_KEY ? {
        has_begin: process.env.FIREBASE_PRIVATE_KEY.includes('-----BEGIN PRIVATE KEY-----'),
        has_end: process.env.FIREBASE_PRIVATE_KEY.includes('-----END PRIVATE KEY-----'),
        has_newlines: process.env.FIREBASE_PRIVATE_KEY.includes('\n'),
        length: process.env.FIREBASE_PRIVATE_KEY.length,
      } : 'Not set'
    }
  };

  // Log the status server-side for debugging
  console.log('Environment Variables Status:', JSON.stringify(envStatus, null, 2));

  // Return the status
  res.status(200).json({
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    status: envStatus
  });
} 