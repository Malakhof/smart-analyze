#!/bin/bash
# Install/update cron entry for GetCourse delta sync (every 4 hours).
# Run on server as root.
#
# Usage:
#   bash /root/smart-analyze/scripts/install-getcourse-cron.sh
#
# What it does:
#   - Reads CRON_SECRET from /root/smart-analyze/.env
#   - Adds crontab entry that POSTs to localhost:3000/api/cron/getcourse-sync
#     every 4 hours, logging output to /root/smart-analyze/logs/cron-gc-sync.log
#   - Idempotent: replaces existing line if present.

set -e

ENV_FILE="/root/smart-analyze/.env"
LOG_DIR="/root/smart-analyze/logs"
APP_URL="http://smart-analyze-app:3000/api/cron/getcourse-sync"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

# Read CRON_SECRET (if absent — generate and append)
SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [ -z "$SECRET" ]; then
  SECRET=$(openssl rand -hex 32)
  echo "CRON_SECRET=$SECRET" >> "$ENV_FILE"
  echo "Generated new CRON_SECRET (32-byte hex) and appended to .env"
  echo "After install, restart smart-analyze-app to pick up the new secret."
fi

mkdir -p "$LOG_DIR"

# Cron line: every 4 hours at :07 minutes (avoid clashing with other system crons on :00)
# Use docker network so we hit the container directly without port exposure.
CRON_CMD="7 */4 * * * docker run --rm --network smart-analyze_default curlimages/curl:latest -sS --max-time 660 -X POST -H \"x-cron-secret: $SECRET\" $APP_URL >> $LOG_DIR/cron-gc-sync.log 2>&1"

# Idempotent install: remove existing line, then add fresh
TMP=$(mktemp)
crontab -l 2>/dev/null | grep -v "/api/cron/getcourse-sync" > "$TMP" || true
echo "$CRON_CMD" >> "$TMP"
crontab "$TMP"
rm "$TMP"

echo "Cron installed. Current entries:"
crontab -l | grep -E "getcourse-sync|^#" | head -10

echo
echo "Manual test command:"
echo "  docker run --rm --network smart-analyze_default curlimages/curl:latest \\"
echo "    -sS -X POST -H \"x-cron-secret: \$CRON_SECRET\" $APP_URL | head -50"
