import { updateAnalysisProgress } from '../../utils/progressTracker';

export default async function handler(req, res) {
  try {
    const testBillId = req.query.billId || `test-bill-${Date.now()}`;
    const stage = req.query.stage || 'Testing';
    const progress = parseInt(req.query.progress || '50');
    const message = req.query.message || 'Test progress update';

    console.log(`API: Updating progress for ${testBillId}: ${stage} - ${progress}%`);
    
    await updateAnalysisProgress(testBillId, stage, progress, message);
    
    res.status(200).json({ 
      success: true, 
      message: `Progress updated for bill ${testBillId}`,
      details: {
        billId: testBillId,
        stage,
        progress,
        message
      }
    });
  } catch (error) {
    console.error('Error in test-progress API:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
} 