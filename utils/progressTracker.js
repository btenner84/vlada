import { db as clientDb } from '../firebase.js';
import { doc as clientDoc, setDoc as clientSetDoc, serverTimestamp as clientServerTimestamp, deleteDoc as clientDeleteDoc } from 'firebase/firestore';

// Try to import admin SDK (will only work on server-side)
let adminDb;
let isServer = false;

// Check if we're running on the server
if (typeof window === 'undefined') {
  isServer = true;
  // We'll use dynamic import for the admin SDK
  import('../firebase/admin.js')
    .then(module => {
      adminDb = module.adminDb;
      console.log('progressTracker: Running in server environment, using Firebase Admin SDK');
    })
    .catch(error => {
      console.error('progressTracker: Error importing admin SDK:', error);
    });
}

/**
 * Update the progress of a bill analysis in Firestore
 * @param {string} billId - The ID of the bill being analyzed
 * @param {string} stage - The current stage of analysis (e.g., "OCR", "AI Analysis")
 * @param {number} progressPercent - The progress percentage (0-100)
 * @param {string} message - Optional detailed message about the current step
 * @returns {Promise<void>}
 */
export const updateAnalysisProgress = async (billId, stage, progressPercent, message = '') => {
  if (!billId) {
    console.error('Bill ID is required for progress tracking');
    return;
  }

  try {
    console.log(`Updating progress for ${billId}: ${stage} - ${progressPercent}%`);
    
    const progressData = {
      status: progressPercent < 100 ? 'processing' : 'complete',
      progress: progressPercent / 100, // Store as decimal for consistency with existing code
      stage,
      message,
      timestamp: isServer ? new Date() : clientServerTimestamp()
    };
    
    if (isServer && adminDb) {
      // Using Admin SDK on the server
      console.log(`progressTracker: Using Admin SDK to update progress for ${billId}`);
      await adminDb.collection('analysis_progress').doc(billId).set(progressData);
    } else {
      // Using client SDK in the browser
      console.log(`progressTracker: Using Client SDK to update progress for ${billId}`);
      await clientSetDoc(clientDoc(clientDb, 'analysis_progress', billId), progressData);
    }
  } catch (error) {
    console.error('Error updating analysis progress:', error);
  }
};

/**
 * Clear the progress tracking document when analysis is complete or fails
 * @param {string} billId - The ID of the bill
 * @returns {Promise<void>}
 */
export const clearAnalysisProgress = async (billId) => {
  if (!billId) return;
  
  try {
    if (isServer && adminDb) {
      // Using Admin SDK on the server
      await adminDb.collection('analysis_progress').doc(billId).delete();
    } else {
      // Using client SDK in the browser
      await clientDeleteDoc(clientDoc(clientDb, 'analysis_progress', billId));
    }
    console.log(`Cleared progress tracking for bill ${billId}`);
  } catch (error) {
    console.error('Error clearing analysis progress:', error);
  }
};

/**
 * Initialize the progress tracking for a new analysis
 * @param {string} billId - The ID of the bill
 * @returns {Promise<void>}
 */
export const initializeAnalysisProgress = async (billId) => {
  return updateAnalysisProgress(billId, 'Initializing', 5, 'Starting bill analysis process');
}; 