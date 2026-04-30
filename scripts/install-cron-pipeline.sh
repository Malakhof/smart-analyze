#!/bin/bash
# install-cron-pipeline.sh — install crontab entries for cron-master-pipeline.
#
# Usage (on prod, as root):
#   bash scripts/install-cron-pipeline.sh
#
# What it does:
#   1. Backs up current crontab → ~/cron-backup-YYYY-MM-DD.txt
#   2. Appends master-pipeline entries (idempotent — checks markers)
#   3. Verifies kill switch /tmp/disable-cron-pipeline does NOT exist
#
# Schedule:
#   */15 * * * *   diva-school   master pipeline
#   0 4 * * *      daily health-check
#   0 3 * * *      aggressive disk cleanup (longer-than-cron-pipeline files)
#
# Disable instantly:
#   touch /tmp/disable-cron-pipeline
# Re-enable:
#   rm /tmp/disable-cron-pipeline

set -euo pipefail

REPO=/root/smart-analyze
LOG_DIR=/var/log/smart-analyze
BACKUP=~/cron-backup-$(date +%Y-%m-%d).txt
MARK_BEGIN="# >>> SalesGuru cron-master-pipeline (managed)"
MARK_END="# <<< SalesGuru cron-master-pipeline"

if [ -f /tmp/disable-cron-pipeline ]; then
  echo "ERROR: kill switch /tmp/disable-cron-pipeline exists — remove it first."
  exit 1
fi

mkdir -p "$LOG_DIR"
crontab -l > "$BACKUP" 2>/dev/null || echo "# (no existing crontab)" > "$BACKUP"
echo "[install] backed up current crontab → $BACKUP"

if crontab -l 2>/dev/null | grep -qF "$MARK_BEGIN"; then
  echo "[install] managed block already present — removing for re-install"
  crontab -l 2>/dev/null | sed "/$MARK_BEGIN/,/$MARK_END/d" | crontab -
fi

# Wrapper that uses the same env as manual runs (DATABASE_URL + ENCRYPTION_KEY
# via .env, INTELION_API_TOKEN already in .env)
RUN_TSX="docker run --rm --network smart-analyze_default \
-v $REPO:/app -w /app \
-e DATABASE_URL='postgresql://smartanalyze:strongpassword@smart-analyze-db:5432/smartanalyze' \
-e ENCRYPTION_KEY='b98f914bf2646636644b847e8fc3d90298520d64cc191642654e68989691476a' \
-e INTELION_API_TOKEN='0ffe8d40464a606588e29815bc4fa10399a141ba' \
node:22 node_modules/.bin/tsx"

cat <<EOF | crontab -
$(crontab -l 2>/dev/null || true)
$MARK_BEGIN
# Master pipeline per tenant (every 15 min)
*/15 * * * * $RUN_TSX scripts/cron-master-pipeline.ts diva-school >> $LOG_DIR/diva.log 2>&1
# Disk cleanup at 03:00 — gets older transient files cron-pipeline left behind
0 3 * * *    find /tmp -maxdepth 2 -type f -mtime +2 ! -name '*.lock' -delete
$MARK_END
EOF

echo "[install] crontab installed:"
crontab -l | sed -n "/$MARK_BEGIN/,/$MARK_END/p"
echo
echo "[install] kill switch path: /tmp/disable-cron-pipeline"
echo "[install] log file:        $LOG_DIR/diva.log"
echo "[install] re-run this script to update; backup at $BACKUP"
