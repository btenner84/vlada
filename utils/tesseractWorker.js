import { createWorker } from 'tesseract.js';

let worker = null;

export async function getWorker() {
  if (!worker) {
    console.log('Creating new Tesseract worker...');
    worker = await createWorker({
      logger: m => console.log('OCR Progress:', m),
      errorHandler: err => console.error('OCR Error:', err)
    });
    
    console.log('Initializing worker...');
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({
      tessedit_ocr_engine_mode: 3,
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?@#$%&*()-+=:;/" '
    });
    console.log('Worker initialized successfully');
  }
  return worker;
}

export async function terminateWorker() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
} 