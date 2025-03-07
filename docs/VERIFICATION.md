# Medical Bill Verification and Extraction

This document outlines the implementation of the combined verification and extraction functionality for medical bills.

## Overview

The system now supports a combined approach to verify if a document is a medical bill and extract relevant information in a single API call. This approach offers several benefits:

1. **Efficiency**: Reduces the number of API calls to OpenAI
2. **Consistency**: Ensures that verification and extraction use the same context and criteria
3. **Improved UX**: Provides immediate feedback to users about document validity

## Implementation Details

### Core Components

1. **OpenAI Service**
   - `combinedVerifyExtract()`: Main function that handles both verification and extraction
   - Uses a comprehensive system prompt to guide the AI in both tasks

2. **API Endpoints**
   - `/api/verify-extract`: Dedicated endpoint for the combined approach
   - Handles error cases and returns structured responses

3. **UI Components**
   - `VerificationResult`: Displays verification status with confidence level
   - Integrated into the bill analysis flow

### Data Structure

The combined approach returns a structured response with two main sections:

```json
{
  "verification": {
    "isMedicalBill": boolean,
    "confidence": number (0.0-1.0),
    "reason": string
  },
  "extraction": {
    "patientInfo": { ... },
    "providerInfo": { ... },
    "serviceDates": { ... },
    "billingInfo": { ... },
    "insuranceInfo": { ... },
    "lineItems": [ ... ]
  }
}
```

If the document is not a medical bill, the `extraction` field will be `null`.

## Usage

### Client-Side

```javascript
import { callVerifyExtractAPI } from '../utils/apiHelpers';

// Example usage
const result = await callVerifyExtractAPI(documentText, {
  model: 'gpt-4-turbo'
});

// Check verification result
if (result.verification.isMedicalBill) {
  // Process extraction data
  const extractedData = result.extraction;
  // ...
} else {
  // Handle non-medical document
  console.log('Not a medical bill:', result.verification.reason);
}
```

### Server-Side

```javascript
const { combinedVerifyExtract } = require('../services/openaiService');

// Example usage
const result = await combinedVerifyExtract(documentText, {
  model: 'gpt-4-turbo',
  temperature: 0.2
});

// Process result as needed
```

## Testing

A test script is available at `scripts/test-verify-extract.js` to verify the functionality with sample documents.

Run the test with:

```bash
node scripts/test-verify-extract.js
```

## Verification Criteria

The AI determines if a document is a medical bill by checking for these indicators:

- Patient information (name, DOB, ID)
- Medical services, procedures, or items with CPT/HCPCS codes
- Charges, payments, adjustments, or balance due
- Provider/facility information
- Dates of service
- Billing-related terms (invoice, statement, bill, claim)

The confidence score (0.0-1.0) indicates how certain the AI is about its determination.

## Future Improvements

- Add support for more document types
- Implement a feedback loop to improve verification accuracy
- Enhance extraction capabilities for complex medical bills
- Add support for multi-page documents 