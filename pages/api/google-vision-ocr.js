import { ImageAnnotatorClient } from '@google-cloud/vision';
import fetch from 'node-fetch';
import { getFirebaseAdmin } from '../../firebase/admin';
import path from 'path';
import fs from 'fs';

// Enhanced logging for debugging
console.log('=============== GOOGLE VISION OCR API ROUTE LOADING ===============');
console.log('Current Working Directory:', process.cwd());
console.log('ENV VAR - GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS || 'Not set');

// Initialize Google Cloud Vision with credentials
let visionClient;

try {
  // First check if credentials are set via environment variable path
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Using Google Vision credentials from GOOGLE_APPLICATION_CREDENTIALS path');
    
    // Check if the path is relative or absolute
    let credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!path.isAbsolute(credentialsPath)) {
      credentialsPath = path.join(process.cwd(), credentialsPath);
    }
    
    // Verify that the file exists
    if (fs.existsSync(credentialsPath)) {
      console.log('Credentials file found at:', credentialsPath);
      console.log('Credentials file size:', fs.statSync(credentialsPath).size, 'bytes');
      
      try {
        // Try reading the first few characters to verify it's valid JSON
        const credentialContent = fs.readFileSync(credentialsPath, 'utf8');
        const firstFewChars = credentialContent.slice(0, 50);
        console.log('First few chars of credentials file:', firstFewChars);
        
        // Parse to verify it's valid JSON
        JSON.parse(credentialContent);
        console.log('Credentials file contains valid JSON');
        
        // If the path exists, we can initialize with the default constructor
        // which will automatically use GOOGLE_APPLICATION_CREDENTIALS
        visionClient = new ImageAnnotatorClient();
        console.log('Vision client initialized with default constructor');
      } catch (error) {
        console.error('Error validating credentials file:', error);
        throw error;
      }
    } else {
      console.error('Credentials file not found at:', credentialsPath);
      throw new Error(`Credentials file not found at: ${credentialsPath}`);
    }
  } 
  // Then check if credentials are provided directly in the env
  else if (process.env.GOOGLE_VISION_CREDENTIALS) {
    console.log('Using Google Vision credentials from GOOGLE_VISION_CREDENTIALS');
    try {
      const credentials = JSON.parse(process.env.GOOGLE_VISION_CREDENTIALS);
      console.log('Credentials parsed successfully from environment variable');
      visionClient = new ImageAnnotatorClient({ credentials });
      console.log('Vision client initialized with credentials from environment variable');
    } catch (error) {
      console.error('Error parsing credentials from environment variable:', error);
      throw error;
    }
  } 
  else {
    // Last resort: try to load from the credentials file directly
    console.log('No environment variables found, trying to load credentials directly');
    try {
      const credentialsPath = path.join(process.cwd(), 'credentials/google-vision-key.json');
      console.log('Looking for credentials at:', credentialsPath);
      
      if (fs.existsSync(credentialsPath)) {
        console.log('Credentials file found at hardcoded path');
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        visionClient = new ImageAnnotatorClient({ credentials });
        console.log('Successfully loaded credentials from file');
      } else {
        console.error('No credentials file found at hardcoded path');
        throw new Error('No credentials file found at hardcoded path');
      }
    } catch (e) {
      console.error('Failed to load credentials from file:', e);
      throw new Error(`Failed to load credentials: ${e.message}`);
    }
  }
} catch (error) {
  console.error('Error initializing Google Cloud Vision:', error);
}

async function downloadImage(url) {
  console.log('Downloading image from URL:', url);
  try {
    // Validate URL format
    if (!url || !url.startsWith('http')) {
      throw new Error(`Only HTTP(S) protocols are supported. Got: ${url.substring(0, 10)}...`);
    }

    console.log('Fetching image content...');
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('Failed to download image:', {
        status: response.status,
        statusText: response.statusText,
        url: url.substring(0, 50) + '...'
      });
      
      // Try to get more error details
      let responseText = '';
      try {
        responseText = await response.text();
        console.error('Error response text:', responseText.substring(0, 200));
      } catch (e) {
        console.error('Error getting response text:', e);
      }
      
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    console.log('Image download successful, reading buffer...');
    const buffer = await response.buffer();
    console.log(`Image downloaded (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    console.error('Error in downloadImage:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

export default async function handler(req, res) {
  console.log('=============== GOOGLE VISION OCR API ROUTE CALLED ===============');
  console.log('Google Vision OCR API route called with method:', req.method);
  console.log('Current timestamp:', new Date().toISOString());
  console.log('Project ID from credentials:', process.env.GOOGLE_PROJECT_ID || 'Using from credentials file');
  
  // Check for POST request
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Request body:', JSON.stringify(req.body).substring(0, 200) + '...');
    
    // Get Firebase Admin
    const { auth } = getFirebaseAdmin();
    console.log('Firebase Auth service retrieved');
    
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('No Authorization header or incorrect format');
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    
    const token = authHeader.split('Bearer ')[1];
    console.log('Token extracted from Authorization header');
    
    try {
      // Verify the token
      const decodedToken = await auth.verifyIdToken(token);
      console.log('Token verified successfully for UID:', decodedToken.uid);
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    const { fileUrl } = req.body;
    if (!fileUrl) {
      console.log('No fileUrl provided in request body');
      return res.status(400).json({ error: 'File URL is required' });
    }
    console.log('File URL format check:', fileUrl.substring(0, 20) + '...');
    
    // Validate URL format
    if (!fileUrl.startsWith('http')) {
      console.error('Invalid URL format. Only HTTP(S) URLs are supported.');
      return res.status(400).json({ 
        error: 'Invalid URL format', 
        message: 'Only HTTP(S) URLs are supported. Got: ' + fileUrl.substring(0, 10) + '...',
        processingMethod: 'google-vision-error'
      });
    }

    if (!visionClient) {
      console.error('Google Cloud Vision client not initialized');
      return res.status(500).json({ 
        error: 'Service unavailable', 
        message: 'Google Cloud Vision client not initialized',
        processingMethod: 'google-vision-error'
      });
    }
    console.log('Vision client is initialized and ready');

    try {
      // Download the image
      console.log('Starting image download');
      const imageBuffer = await downloadImage(fileUrl);
      console.log('Image downloaded successfully, proceeding with OCR');

      // Process with Google Vision - using documentTextDetection for forms/tables
      console.log('Calling Google Vision API with documentTextDetection');
      try {
        const [result] = await visionClient.documentTextDetection({
          image: { content: imageBuffer }
        });
        console.log('Google Vision API call successful');

        // Get full text annotation
        const fullText = result.fullTextAnnotation?.text || '';
        console.log(`Extracted text (first 100 chars): ${fullText.substring(0, 100)}...`);

        // Process table structure - blocks, paragraphs and tables
        const pageBlocks = result.fullTextAnnotation?.pages?.flatMap(page => 
          page.blocks || []
        ) || [];
        console.log(`Extracted ${pageBlocks.length} blocks from the document`);
        
        // Extract tables (this is simplified - actual table detection would be more complex)
        const tableData = extractTablesFromBlocks(pageBlocks);
        console.log(`Detected ${tableData.length} potential tables in the document`);

        // Return the OCR results
        const responseData = {
          extractedText: fullText,
          confidence: calculateConfidence(result),
          tables: tableData,
          processingMethod: 'google-vision',
          blocks: pageBlocks.length,
        };
        console.log('Sending successful response with OCR results');
        return res.status(200).json(responseData);
      } catch (visionApiError) {
        console.error('Google Vision API specific error:', visionApiError);
        
        // Special handling for billing-related errors
        if (visionApiError.message && visionApiError.message.includes('billing')) {
          console.error('BILLING ERROR DETECTED: Google Cloud billing not enabled');
          return res.status(402).json({
            error: 'Billing Required',
            message: 'Google Cloud Vision requires billing to be enabled on your Google Cloud project.',
            details: visionApiError.message,
            code: visionApiError.code || 'BILLING_REQUIRED',
            processingMethod: 'google-vision-billing-error'
          });
        }
        
        // Special handling for quota-related errors
        if (visionApiError.message && visionApiError.message.includes('quota')) {
          console.error('QUOTA ERROR DETECTED: Google Cloud API quota exceeded');
          return res.status(429).json({
            error: 'Quota Exceeded',
            message: 'Google Cloud Vision API quota has been exceeded.',
            details: visionApiError.message,
            code: visionApiError.code || 'QUOTA_EXCEEDED',
            processingMethod: 'google-vision-quota-error'
          });
        }
        
        // Special handling for API not enabled errors
        if (visionApiError.message && visionApiError.message.includes('API has not been used')) {
          console.error('API NOT ENABLED: Google Cloud Vision API not enabled');
          return res.status(400).json({
            error: 'API Not Enabled',
            message: 'Google Cloud Vision API is not enabled for this project.',
            details: visionApiError.message,
            code: visionApiError.code || 'API_NOT_ENABLED',
            processingMethod: 'google-vision-api-error'
          });
        }
        
        throw visionApiError; // re-throw for general error handling
      }
    } catch (visionError) {
      console.error('Error during Google Vision API call:', visionError);
      console.error('Vision API error details:', JSON.stringify(visionError, null, 2));
      return res.status(500).json({ 
        error: 'Vision API call failed', 
        message: visionError.message,
        details: visionError.details || 'No details available',
        code: visionError.code || 'Unknown error code',
        processingMethod: 'google-vision-failed'
      });
    }
  } catch (error) {
    console.error('Error processing with Google Vision OCR:', error);
    console.error('Error stack trace:', error.stack);
    return res.status(500).json({ 
      error: 'OCR processing failed', 
      message: error.message,
      stack: error.stack,
      processingMethod: 'google-vision-failed'
    });
  }
}

function calculateConfidence(result) {
  if (!result.fullTextAnnotation) return 0;
  
  // Average confidence across all pages and blocks
  let totalConfidence = 0;
  let totalElements = 0;
  
  result.fullTextAnnotation.pages?.forEach(page => {
    page.blocks?.forEach(block => {
      // For text blocks, calculate average confidence
      if (block.paragraphs) {
        block.paragraphs.forEach(paragraph => {
          paragraph.words?.forEach(word => {
            word.symbols?.forEach(symbol => {
              totalConfidence += symbol.confidence || 0;
              totalElements++;
            });
          });
        });
      }
    });
  });
  
  return totalElements > 0 ? totalConfidence / totalElements : 0;
}

function extractTablesFromBlocks(blocks) {
  // This is a simplified version - proper table extraction would require 
  // geometric analysis of text positions and bounding boxes
  const tables = [];
  
  // Find potential table structures based on text layout
  const paragraphs = blocks.flatMap(block => 
    block.paragraphs || []
  );
  
  // Look for patterns that could indicate tables (rows with similar formats)
  // This is a simple heuristic and would need refinement
  let currentTable = null;
  
  paragraphs.forEach(paragraph => {
    const text = paragraph.words?.map(word => 
      word.symbols?.map(s => s.text).join('')
    ).join(' ') || '';
    
    // Simple heuristic: Lines with multiple spaces/tabs and numbers could be part of a table
    const hasTabularFormat = text.includes('  ') && /\d+/.test(text);
    
    if (hasTabularFormat) {
      if (!currentTable) {
        currentTable = { rows: [] };
        tables.push(currentTable);
      }
      
      // Basic row parsing - split by multiple spaces
      const cells = text.split(/\s{2,}/).filter(Boolean);
      currentTable.rows.push(cells);
    } else if (currentTable && currentTable.rows.length > 0) {
      // End the current table when we encounter non-tabular text
      currentTable = null;
    }
  });
  
  return tables;
} 