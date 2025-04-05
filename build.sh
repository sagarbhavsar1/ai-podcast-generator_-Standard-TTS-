#!/bin/bash
set -e  # Exit immediately if a command fails

# Print commands before execution
set -x

# Install system dependencies
apt-get update && apt-get install -y tesseract-ocr libleptonica-dev poppler-utils ffmpeg

# Install backend dependencies
npm install

# Build and install frontend
echo "Building frontend..."
if [ -d "frontend" ]; then
  cd frontend
  npm install
  CI=false npm run build
  cd ..
  echo "Frontend build completed"
else
  echo "Frontend directory not found!"
  ls -la  # List directories to debug
fi

# Verify frontend build exists
if [ -d "frontend/build" ]; then
  echo "Frontend build directory exists!"
  ls -la frontend/build
else
  echo "Frontend build directory not found!"
fi
