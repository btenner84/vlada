import { adminStorage } from '../../firebase/admin';

export default async function handler(req, res) {
  try {
    const { path, userId, billId } = req.query;
    
    if (!path) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }
    
    // Check if Firebase Admin SDK is initialized
    if (!adminStorage) {
      console.error('Firebase Admin SDK not initialized when accessing proxy-file');
      return res.status(500).json({ error: 'Firebase Admin SDK not initialized' });
    }
    
    try {
      console.log(`Attempting to access file: ${path}`);
      const bucket = adminStorage.bucket();
      const file = bucket.file(decodeURIComponent(path));
      
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        console.error(`File does not exist: ${path}`);
        return res.status(404).json({ error: 'File not found' });
      }
      
      // Get file metadata for content type
      const [metadata] = await file.getMetadata();
      const contentType = metadata.contentType || 'application/octet-stream';
      
      // Set appropriate headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      // Stream the file directly to the response
      const readStream = file.createReadStream();
      readStream.pipe(res);
      
      // Handle read stream errors
      readStream.on('error', (error) => {
        console.error(`Error streaming file: ${error.message}`);
        // Only send error if headers haven't been sent
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming file' });
        }
      });
      
    } catch (error) {
      console.error(`Error accessing file ${path}:`, error);
      return res.status(500).json({ error: `File access error: ${error.message}` });
    }
    
  } catch (error) {
    console.error('Proxy file handler error:', error);
    return res.status(500).json({ error: error.message });
  }
} 