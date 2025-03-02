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

  // Log request details for debugging
  console.log('Test API Route Handler - Request Method:', req.method);
  console.log('Test API Route Handler - Request Headers:', JSON.stringify(req.headers));

  return res.status(200).json({ 
    success: true, 
    message: 'API test endpoint is working',
    method: req.method,
    timestamp: new Date().toISOString()
  });
} 