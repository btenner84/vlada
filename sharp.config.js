// sharp.config.js
// This file ensures Sharp is properly installed for all platforms

module.exports = {
  // This function will be called during the build process
  async afterInstall() {
    const { exec } = require('child_process');
    
    return new Promise((resolve, reject) => {
      // Install Sharp specifically for linux-x64 environment
      const command = 'npm install --platform=linux --arch=x64 sharp';
      
      console.log('Installing Sharp for Linux x64 platform...');
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('Error installing Sharp for Linux:', error);
          return reject(error);
        }
        
        console.log('Successfully installed Sharp for Linux x64 platform');
        console.log(stdout);
        
        if (stderr) {
          console.warn('Warning during Sharp installation:', stderr);
        }
        
        resolve();
      });
    });
  }
}; 