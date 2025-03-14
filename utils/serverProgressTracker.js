import { adminDb } from '../firebase/admin.js';

/**
 * Update the progress of a bill analysis in Firestore (server-side only)
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
    console.log(`SERVER: Updating progress for ${billId}: ${stage} - ${progressPercent}%`);
    
    const progressData = {
      status: progressPercent < 100 ? 'processing' : 'complete',
      progress: progressPercent / 100, // Store as decimal for consistency with existing code
      stage,
      message,
      timestamp: new Date()
    };
    
    if (!adminDb) {
      console.error('SERVER: Admin DB not initialized, cannot update progress');
      return;
    }
    
    await adminDb.collection('analysis_progress').doc(billId).set(progressData);
    console.log(`SERVER: Progress updated successfully for ${billId}`);
  } catch (error) {
    console.error('SERVER: Error updating analysis progress:', error);
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
    if (!adminDb) {
      console.error('SERVER: Admin DB not initialized, cannot clear progress');
      return;
    }
    
    await adminDb.collection('analysis_progress').doc(billId).delete();
    console.log(`SERVER: Cleared progress tracking for bill ${billId}`);
  } catch (error) {
    console.error('SERVER: Error clearing analysis progress:', error);
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