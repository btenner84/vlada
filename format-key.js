// This script formats the Firebase private key for Vercel
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const privateKey = process.env.FIREBASE_PRIVATE_KEY;
console.log('Original private key:', privateKey);

// Remove quotes and replace literal \n with actual newlines
const formattedKey = privateKey.replace(/"/g, '').replace(/\\n/g, '\n');
console.log('Formatted private key:');
console.log(formattedKey);

// Output the key in a format that can be used with Vercel CLI
console.log('\nUse this command to add the key to Vercel:');
console.log(`npx vercel env add FIREBASE_PRIVATE_KEY_RAW`);
console.log('\nWhen prompted, paste this value (without quotes):');
console.log(formattedKey); 