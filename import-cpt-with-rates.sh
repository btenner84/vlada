#!/bin/bash

# This script will import CPT codes with reimbursement rates
echo "Starting CPT code import with reimbursement rates..."

# Run the import script
node import-cpt-codes.js

# Check the database to verify import
node check-cpt-database.js

echo "Import process complete!"
