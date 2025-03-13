export default function handler(req, res) {
  // Log request details
  console.log('API Route: /api/analyze-test - Request received');
  console.log('Request Method:', req.method);
  console.log('Request Headers:', req.headers);
  console.log('Request Body:', req.body);
  console.log('Request Query:', req.query);
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request for CORS preflight');
    res.status(200).end();
    return;
  }
  
  // Return diagnostic information for any method
  return res.status(200).json({
    status: 'success',
    message: 'Diagnostic endpoint is working',
    requestMethod: req.method,
    requestHeaders: req.headers,
    requestBody: req.body,
    requestQuery: req.query,
    timestamp: new Date().toISOString()
  });
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}; 