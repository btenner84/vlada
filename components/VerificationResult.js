import React from 'react';
import { Box, Card, CardContent, Typography, Chip, Alert, AlertTitle } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpIcon from '@mui/icons-material/Help';

/**
 * Component to display the verification result for a document
 * @param {Object} props - Component props
 * @param {Object} props.verification - The verification result object
 * @param {boolean} props.loading - Whether the verification is still loading
 */
const VerificationResult = ({ verification, loading = false }) => {
  if (loading) {
    return (
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Document Verification
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Verifying document type...
          </Typography>
        </CardContent>
      </Card>
    );
  }

  if (!verification) {
    return (
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Document Verification
          </Typography>
          <Alert severity="info">
            <AlertTitle>No Verification Data</AlertTitle>
            Document has not been verified yet.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const { isMedicalBill, confidence, reason } = verification;

  // Determine confidence level display
  let confidenceDisplay;
  let confidenceColor;
  
  if (typeof confidence === 'number') {
    // Handle numeric confidence (0.0-1.0)
    if (confidence >= 0.8) {
      confidenceDisplay = 'High';
      confidenceColor = 'success';
    } else if (confidence >= 0.5) {
      confidenceDisplay = 'Medium';
      confidenceColor = 'warning';
    } else {
      confidenceDisplay = 'Low';
      confidenceColor = 'error';
    }
  } else {
    // Handle string confidence (for backward compatibility)
    confidenceDisplay = confidence || 'Unknown';
    confidenceColor = 
      confidence === 'high' ? 'success' :
      confidence === 'medium' ? 'warning' :
      confidence === 'low' ? 'error' : 'default';
  }

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Document Verification
        </Typography>
        
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          {isMedicalBill ? (
            <CheckCircleIcon color="success" sx={{ mr: 1 }} />
          ) : (
            <CancelIcon color="error" sx={{ mr: 1 }} />
          )}
          <Typography variant="body1" fontWeight="bold">
            {isMedicalBill ? 'Medical Bill Detected' : 'Not a Medical Bill'}
          </Typography>
          <Chip 
            label={`Confidence: ${confidenceDisplay}`}
            color={confidenceColor}
            size="small"
            icon={<HelpIcon />}
            sx={{ ml: 2 }}
          />
        </Box>
        
        <Alert severity={isMedicalBill ? "success" : "warning"}>
          <AlertTitle>{isMedicalBill ? 'Verification Successful' : 'Verification Failed'}</AlertTitle>
          {reason || 'No reason provided'}
        </Alert>
      </CardContent>
    </Card>
  );
};

export default VerificationResult; 