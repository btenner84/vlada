#!/bin/bash
# Start the Web Monitoring & File Extraction Tool with Docker Compose

# Create data directory if it doesn't exist
mkdir -p data/downloads

# Build and start the containers
docker compose up -d

# Show logs
docker compose logs -f 