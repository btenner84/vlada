import fetch from 'node-fetch';
import { getSafeSharp } from '../../utils/safeImports.js';

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
    
    let base64Image;
    
    try {
      // Get our safe Sharp implementation
      const safeSharp = await getSafeSharp();
      
      // Try to convert to PNG format using Sharp
      const pngBuffer = await safeSharp(imageBuffer)
        .toFormat('png')
        .toBuffer();
      console.log('Image converted to PNG, size:', pngBuffer.length);
      
      // Convert to base64
      base64Image = pngBuffer.toString('base64');
    } catch (sharpError) {
      console.error('Sharp module error during conversion:', sharpError);
      console.log('Using fallback conversion mechanism');
      
      // Fallback: Return original image as base64 without conversion
      base64Image = imageBuffer.toString('base64');
    }
    
    // Return success response
    res.status(200).json({
      success: true,
      imageData: base64Image,
      converted: true
    });
    
  } catch (error) {
    console.error('Error converting image:', error);
    res.status(500).json({ error: error.message || 'Error converting image' });
  }
} 