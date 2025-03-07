import React from 'react';

/**
 * Component to display the verification result for a document
 * @param {Object} props - Component props
 * @param {Object} props.verification - The verification result object
 * @param {boolean} props.loading - Whether the verification is still loading
 */
const VerificationResult = ({ verification, loading = false }) => {
  if (loading) {
    return (
      <div className="p-4 mb-4 border rounded shadow-sm">
        <h3 className="text-lg font-semibold mb-2">Document Verification</h3>
        <p className="text-gray-600">Verifying document type...</p>
      </div>
    );
  }

  if (!verification) {
    return (
      <div className="p-4 mb-4 border rounded shadow-sm">
        <h3 className="text-lg font-semibold mb-2">Document Verification</h3>
        <div className="p-4 bg-blue-50 text-blue-800 rounded">
          <p className="font-bold">No Verification Data</p>
          <p>Document has not been verified yet.</p>
        </div>
      </div>
    );
  }

  const { isMedicalBill, confidence, reason } = verification;

  // Determine confidence level display
  let confidenceDisplay;
  let confidenceColorClass;
  
  if (typeof confidence === 'number') {
    // Handle numeric confidence (0.0-1.0)
    if (confidence >= 0.8) {
      confidenceDisplay = 'High';
      confidenceColorClass = 'bg-green-100 text-green-800';
    } else if (confidence >= 0.5) {
      confidenceDisplay = 'Medium';
      confidenceColorClass = 'bg-yellow-100 text-yellow-800';
    } else {
      confidenceDisplay = 'Low';
      confidenceColorClass = 'bg-red-100 text-red-800';
    }
  } else {
    // Handle string confidence (for backward compatibility)
    confidenceDisplay = confidence || 'Unknown';
    confidenceColorClass = 
      confidence === 'high' ? 'bg-green-100 text-green-800' :
      confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
      confidence === 'low' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800';
  }

  return (
    <div className="p-4 mb-4 border rounded shadow-sm">
      <h3 className="text-lg font-semibold mb-2">Document Verification</h3>
      
      <div className="flex items-center mb-3">
        <span className={`mr-2 ${isMedicalBill ? 'text-green-600' : 'text-red-600'}`}>
          {isMedicalBill ? '✓' : '✗'}
        </span>
        <span className="font-semibold">
          {isMedicalBill ? 'Medical Bill Detected' : 'Not a Medical Bill'}
        </span>
        <span className={`ml-2 px-2 py-1 text-xs rounded ${confidenceColorClass}`}>
          Confidence: {confidenceDisplay}
        </span>
      </div>
      
      <div className={`p-3 rounded ${isMedicalBill ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'}`}>
        <p className="font-bold">{isMedicalBill ? 'Verification Successful' : 'Verification Failed'}</p>
        <p>{reason || 'No reason provided'}</p>
      </div>
    </div>
  );
};

export default VerificationResult; 