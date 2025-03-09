# CPT Code Mapping Implementation

This implementation adds automatic CPT/HCPCS code mapping to medical bill analysis in the Vlada Health platform.

## Features

- Automatically maps service descriptions to CPT/HCPCS codes
- Uses a database of Medicare CPT codes for accurate matching
- Falls back to AI for services that don't have direct matches
- Displays CPT codes alongside services in the bill analysis UI
- Shows confidence scores and match methods for transparency

## Implementation Details

1. **Data Source**: Uses the MedicareCPT Excel file with CPT codes in column A and descriptions in column E.

2. **Database**: Stores CPT codes in a Firestore collection called `cptCodeMappings`.

3. **Matching Process**:
   - First tries to match using keywords from the service description
   - If no good match is found, uses OpenAI to find the best match
   - Includes confidence scores and reasoning for each match

4. **Integration Points**:
   - Enhances the document processing pipeline without changing its structure
   - Updates the BillAnalysis component to display CPT codes
   - Maintains backward compatibility with existing documents

## Files Added/Modified

1. **New Files**:
   - `import-cpt-codes.js`: Script to import CPT codes from Excel
   - `check-cpt-database.js`: Script to check if CPT codes were imported correctly
   - `utils/cptMatcher.js`: Utility to match service descriptions to CPT codes

2. **Modified Files**:
   - `utils/documentProcessing.js`: Enhanced to include CPT code mapping
   - `pages/analysis/[billId].js`: Updated to display CPT code information

## Setup Instructions

1. **Install Dependencies**:
   ```bash
   npm install xlsx --save
   ```

2. **Import CPT Codes**:
   ```bash
   node import-cpt-codes.js
   ```

3. **Verify Import**:
   ```bash
   node check-cpt-database.js
   ```

## How It Works

1. **Data Import**:
   - The Excel file is read and processed
   - CPT codes and descriptions are extracted
   - Keywords are generated for better matching
   - Data is stored in Firestore

2. **Service Matching**:
   - When a bill is analyzed, each service description is matched to a CPT code
   - First, a database lookup is performed using keywords
   - If no good match is found, OpenAI is used to find the best match
   - The matched CPT code is added to the service object

3. **UI Display**:
   - CPT codes are displayed alongside service descriptions
   - Match confidence and method are shown for transparency
   - Code descriptions and reasoning are displayed when available

## Troubleshooting

If CPT codes are not appearing:

1. Check that the `cptCodeMappings` collection exists in Firestore
2. Verify that the OpenAI API key is correctly set in environment variables
3. Check the server logs for any errors during the matching process
4. Make sure the Excel file was imported correctly

## Future Improvements

1. **Enhanced Matching**:
   - Implement more sophisticated NLP for better matching
   - Add support for more code types (ICD-10, DRG, etc.)
   - Improve confidence scoring

2. **Performance Optimization**:
   - Add caching for frequently accessed codes
   - Optimize database queries for large datasets

3. **UI Enhancements**:
   - Add ability to manually correct CPT codes
   - Show reference rates for each CPT code
   - Provide more detailed explanations of codes 