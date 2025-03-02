export default function handler(req, res) {
  console.log('Simple API Route: /api/analyze-simple - Request received');
  console.log('Request Method:', req.method);
  console.log('Request Headers:', JSON.stringify(req.headers));
  console.log('Request URL:', req.url);
  console.log('Request Query:', JSON.stringify(req.query));
  console.log('Request Body:', JSON.stringify(req.body));
  
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
    console.log('Handling OPTIONS request for CORS preflight');
    res.status(200).end();
    console.log('OPTIONS request handled successfully');
    return;
  }
  
  // Return a simple success response for all methods
  return res.status(200).json({
    success: true,
    message: 'API endpoint is working',
    method: req.method,
    body: req.body,
    timestamp: new Date().toISOString()
  });
} 