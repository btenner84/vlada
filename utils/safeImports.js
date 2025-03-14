// utils/safeImports.js
// Safe import utilities for problematic modules in serverless environments

// For Sharp image processing
export async function getSafeSharp() {
  // Check if we're in a serverless environment (Vercel)
  const isServerless = process.env.VERCEL_SERVERLESS === 'true' || 
                       process.env.SKIP_SHARP === 'true' ||
                       process.env.VERCEL === '1' ||
                       process.env.NOW_REGION ||
                       process.env.VERCEL_REGION;
  
  // If we're in a serverless environment, don't even try to load Sharp
  if (isServerless) {
    console.log('Serverless environment detected, using Sharp fallback without attempting import');
    return createSharpFallback();
  }
  
  // For non-serverless environments, try to load Sharp
  try {
    // Try to dynamically import Sharp
    const sharpModule = await import('sharp');
    console.log('Successfully imported Sharp module');
    return sharpModule.default;
  } catch (error) {
    console.error('Failed to import Sharp module:', error.message);
    console.log('Using Sharp fallback');
    return createSharpFallback();
  }
}

// Create a fallback object that mimics the Sharp API
function createSharpFallback() {
  return function(buffer) {
    console.log('Using Sharp fallback with buffer size:', buffer?.length);
    return {
      toFormat: () => ({ toBuffer: async () => buffer }),
      grayscale: () => ({ normalize: () => ({ sharpen: () => ({ toBuffer: async () => buffer }) }) }),
      resize: () => ({ toBuffer: async () => buffer }),
      metadata: async () => ({ width: 0, height: 0, format: 'unknown' })
    };
  };
}

// Usage example:
// import { getSafeSharp } from './safeImports.js';
// 
// async function processImage(buffer) {
//   const sharp = await getSafeSharp();
//   return sharp(buffer).toFormat('png').toBuffer();
// } 