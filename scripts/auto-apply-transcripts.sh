#!/usr/bin/env bash
# Auto-poll Whisper RunPod result files, pull deltas, apply to DB transcripts.
# Run on Timeweb host with both SSH keys configured.
#
# Usage: bash auto-apply-transcripts.sh [interval_seconds]
# Default interval: 300s (5 min)
set -euo pipefail

INTERVAL="${1:-300}"
RUNPODS=("216.249.100.66:14629:results_prod.jsonl" "194.26.196.156:16720:results_half2.jsonl")
LOCAL_DIR="/root/smart-analyze/whisper-runs"
mkdir -p "$LOCAL_DIR"

echo "[$(date -Is)] auto-apply started, interval=${INTERVAL}s"

while true; do
  for entry in "${RUNPODS[@]}"; do
    IFS=':' read -r HOST PORT FNAME <<<"$entry"
    LOCAL="$LOCAL_DIR/$FNAME"
    REMOTE="root@${HOST}:/workspace/${FNAME}"
    echo "[$(date -Is)] pulling $FNAME from $HOST:$PORT"
    if scp -o StrictHostKeyChecking=no -P "$PORT" "$REMOTE" "$LOCAL.tmp" 2>/dev/null; then
      mv "$LOCAL.tmp" "$LOCAL"
      LINES=$(wc -l <"$LOCAL")
      echo "[$(date -Is)]   $FNAME has $LINES lines"
      docker run --rm --network smart-analyze_default \
        -v /root/smart-analyze:/app -w /app node:22-slim \
        sh -c "set -a && . /app/.env && set +a && \
               ./node_modules/.bin/tsx scripts/apply-transcripts.ts /app/whisper-runs/$FNAME" \
        2>&1 | tail -3 || echo "  apply failed, will retry next cycle"
    else
      echo "[$(date -Is)]   pull failed (maybe file not ready), skipping"
    fi
  done
  echo "[$(date -Is)] sleep ${INTERVAL}s..."
  sleep "$INTERVAL"
done
