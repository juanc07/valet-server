#!/bin/bash

# Variables
PM2_PROCESS_NAME="valet-server"
APP_DIR="/var/www/valet-server/valet-server"          # Working directory
ENTRY_FILE="$APP_DIR/dist/index.js"                   # Path to built index.js
LOG_FILE="/var/log/valet-server-deploy.log"           # Optional: log script output

# Redirect output to log file (optional, remove if not needed)
exec > >(tee -a "$LOG_FILE") 2>&1
echo "Deploy script started at $(date)"

# Ensure we're in the right directory
cd "$APP_DIR" || { echo "Failed to cd into $APP_DIR"; exit 1; }

# Check if PM2 process exists, start if not running
echo "Checking PM2 process: $PM2_PROCESS_NAME"
if pm2 list | grep -q "$PM2_PROCESS_NAME"; then
  echo "Process $PM2_PROCESS_NAME found"
else
  echo "Process $PM2_PROCESS_NAME not found, starting it..."
  pm2 start "$ENTRY_FILE" --name "$PM2_PROCESS_NAME" --watch --max-restarts 10 --restart-delay 5000 || { echo "PM2 start failed"; exit 1; }
fi

# Enable auto-restart on crash
echo "Configuring auto-restart for $PM2_PROCESS_NAME..."
pm2 modify "$PM2_PROCESS_NAME" --restart-delay 5000 --max-restarts 10  # 5s delay, max 10 restarts

# Pull latest changes
echo "Pulling latest changes..."
git status
git fetch && git pull || { echo "Git pull failed"; exit 1; }

# Install dependencies
echo "Installing dependencies..."
pnpm install || { echo "pnpm install failed"; exit 1; }

# Build the app
echo "Building application..."
pnpm build || { echo "Build failed"; exit 1; }

# Restart PM2 with updated code
echo "Restarting PM2 process with new code..."
pm2 restart "$PM2_PROCESS_NAME" --update-env || { echo "Restart failed"; exit 1; }

# Save PM2 config to persist across reboots
echo "Saving PM2 configuration..."
pm2 save || { echo "PM2 save failed"; exit 1; }

# Check logs to verify
echo "Verifying server..."
pm2 logs "$PM2_PROCESS_NAME" --lines 10

echo "Deploy script completed at $(date)"
