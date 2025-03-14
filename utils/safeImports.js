// utils/safeImports.js
// Safe import utilities for problematic modules in serverless environments

// For Sharp image processing
export async function getSafeSharp() {
  try {
    // Try to dynamically import Sharp
    const sharpModule = await import('sharp');
    console.log('Successfully imported Sharp module');
    return sharpModule.default;
  } catch (error) {
    console.error('Failed to import Sharp module:', error.message);
    
    // Return a fallback object that mimics the Sharp API but does nothing
    // This allows code to continue running without Sharp
    return {
      // Basic Sharp-like API
      async(buffer) {
        console.log('Using Sharp fallback with buffer size:', buffer?.length);
        return {
          toFormat: () => ({ toBuffer: async () => buffer }),
          grayscale: () => ({ normalize: () => ({ sharpen: () => ({ toBuffer: async () => buffer }) }) }),
          resize: () => ({ toBuffer: async () => buffer }),
          metadata: async () => ({ width: 0, height: 0, format: 'unknown' })
        };
      }
    };
  }
}

// Usage example:
// import { getSafeSharp } from './safeImports.js';
// 
// async function processImage(buffer) {
//   const sharp = await getSafeSharp();
//   return sharp(buffer).toFormat('png').toBuffer();
// } 