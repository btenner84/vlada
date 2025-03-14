// scripts/install-sharp.js
// A dedicated script to install Sharp for the current platform

// For ES modules compatibility
import { execSync } from 'child_process';
import os from 'os';

// Get the current platform
const platform = os.platform();
const arch = os.arch();

console.log(`Installing Sharp for platform: ${platform}, architecture: ${arch}`);

// Check if we're running in a Vercel environment
const isVercel = process.env.VERCEL === '1' || process.env.NOW_REGION || process.env.VERCEL_REGION;

if (isVercel) {
  console.log('Detected Vercel environment, using special installation flags');
}

try {
  // For linux-x64 environments (common in production/serverless)
  if (platform === 'linux' && arch === 'x64') {
    console.log('Detected Linux x64 environment, installing platform-specific Sharp');
    
    // For Vercel, we need special flags
    if (isVercel) {
      execSync('npm install --ignore-scripts=false --platform=linux --arch=x64 sharp', { stdio: 'inherit' });
    } else {
      execSync('npm install --platform=linux --arch=x64 sharp', { stdio: 'inherit' });
    }
  } 
  // For macOS environments (common in development)
  else if (platform === 'darwin') {
    console.log('Detected macOS environment, installing platform-specific Sharp');
    execSync('npm install --platform=darwin --arch=x64 sharp', { stdio: 'inherit' });
  }
  // For other environments, use regular install
  else {
    console.log(`Installing Sharp for ${platform}-${arch}`);
    execSync(`npm install --platform=${platform} --arch=${arch} sharp`, { stdio: 'inherit' });
  }
  
  console.log('Sharp installation complete');
} catch (error) {
  console.error('Error installing Sharp:', error.message);
  console.log('Falling back to regular Sharp installation');
  
  try {
    // Use ignore-scripts=false for Vercel
    if (isVercel) {
      execSync('npm install --ignore-scripts=false sharp', { stdio: 'inherit' });
    } else {
      execSync('npm install sharp', { stdio: 'inherit' });
    }
    console.log('Fallback Sharp installation complete');
  } catch (fallbackError) {
    console.error('Fallback installation also failed:', fallbackError.message);
    console.log('Will rely on safe import fallbacks during runtime');
  }
} 