#!/bin/bash

# Variables
PM2_PROCESS_NAME="valet-server"

# Check PM2 process
echo "Checking PM2 process: $PM2_PROCESS_NAME"
pm2 list | grep $PM2_PROCESS_NAME || { echo "Process $PM2_PROCESS_NAME not found"; exit 1; }

# Pull changes
echo "Pulling latest changes..."
git status
git fetch && git pull || { echo "Git pull failed"; exit 1; }

# Install dependencies if needed
echo "Installing dependencies..."
pnpm install

# Build the app
echo "Building application..."
pnpm build || { echo "Build failed"; exit 1; }

# Restart PM2
echo "Restarting PM2 process..."
pm2 restart $PM2_PROCESS_NAME || { echo "Restart failed"; exit 1; }

# Check logs
echo "Verifying server..."
pm2 logs $PM2_PROCESS_NAME --lines 10