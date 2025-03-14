#!/bin/bash

# Check if environment variables are set
if [ -z "$FIREBASE_PROJECT_ID" ] || [ -z "$FIREBASE_CLIENT_EMAIL" ] || [ -z "$FIREBASE_PRIVATE_KEY" ]; then
  echo "Error: Required Firebase environment variables are not set"
  exit 1
fi

# Run the import script
echo "Starting CLFS code import..."
node import-clfs-codes.js

# Check the exit status
if [ $? -eq 0 ]; then
  echo "CLFS code import completed successfully"
else
  echo "Error: CLFS code import failed"
  exit 1
fi 