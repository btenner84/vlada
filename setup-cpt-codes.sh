#!/bin/bash

# Make sure we're in the project root
cd "$(dirname "$0")"

# Install required packages
echo "Installing required packages..."
npm install xlsx dotenv --save

# Check if .env file exists
if [ ! -f .env ]; then
  echo "Creating .env file from .env.local..."
  cp .env.local .env
fi

# Run the import script
echo "Starting CPT code import..."
node import-cpt-codes.js

# Check if the import was successful
if [ $? -eq 0 ]; then
  echo "Verifying CPT code import..."
  node check-cpt-database.js
else
  echo "CPT code import failed. Check the error messages above."
  exit 1
fi

echo "Setup complete!" 