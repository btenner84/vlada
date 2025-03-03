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
      tessedit_pageseg_mode: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?@#$%&*()-+=:;/"\'$¢£€¥%[]{}()<>\\| ',
      tessedit_write_images: true,
      tessedit_create_pdf: '1',
      tessedit_create_hocr: '1',
      tessedit_enable_doc_dict: '1',
      tessedit_enable_new_segsearch: '1',
      textord_heavy_nr: '1',
      textord_force_make_prop_words: '1',
      tessedit_do_invert: '0'
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