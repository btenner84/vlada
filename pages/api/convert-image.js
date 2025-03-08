import fetch from 'node-fetch';
import sharp from 'sharp';

export default async function handler(req, res) {
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
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST', 'OPTIONS']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing required parameter: imageUrl' });
    }
    
    console.log('Converting image from URL:', imageUrl);
    
    // Fetch the image
    const response = await fetch(imageUrl, {
      headers: {
        'Accept': 'image/*',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      return res.status(500).json({ error: `Failed to fetch image: ${response.status} ${response.statusText}` });
    }
    
    // Get the image buffer
    const imageBuffer = await response.buffer();
    console.log('Image fetched, size:', imageBuffer.length);
    
    // Convert to PNG format
    const pngBuffer = await sharp(imageBuffer)
      .toFormat('png')
      .toBuffer();
    console.log('Image converted to PNG, size:', pngBuffer.length);
    
    // Return the image as base64
    const base64Image = pngBuffer.toString('base64');
    
    // Return success response
    res.status(200).json({
      success: true,
      imageData: base64Image
    });
    
  } catch (error) {
    console.error('Error converting image:', error);
    res.status(500).json({ error: error.message || 'Error converting image' });
  }
} 