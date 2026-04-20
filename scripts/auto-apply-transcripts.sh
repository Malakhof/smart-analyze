#!/usr/bin/env bash
# Auto-poll Whisper RunPod result files, pull deltas, apply to DB transcripts.
# Updated for new pods sg-w-1, sg-w-2.
set -euo pipefail

INTERVAL="${1:-180}"
RUNPODS=("213.192.2.110:40160:results_diva_p1.jsonl" "64.119.209.250:7172:results_diva_p2.jsonl")
LOCAL_DIR="/root/smart-analyze/whisper-runs"
mkdir -p "$LOCAL_DIR"

echo "[$(date -Is)] auto-apply started, interval=${INTERVAL}s"

while true; do
  for entry in "${RUNPODS[@]}"; do
    IFS=":" read -r HOST PORT FNAME <<<"$entry"
    LOCAL="$LOCAL_DIR/$FNAME"
    if scp -o StrictHostKeyChecking=no -P "$PORT" "root@${HOST}:/workspace/${FNAME}" "$LOCAL.tmp" 2>/dev/null; then
      mv "$LOCAL.tmp" "$LOCAL"
      LINES=$(wc -l <"$LOCAL")
      echo "[$(date -Is)] $FNAME has $LINES lines"
      docker run --rm --network smart-analyze_default \
        -v /root/smart-analyze:/app -w /app node:22-slim \
        sh -c "set -a && . /app/.env && set +a && \
               ./node_modules/.bin/tsx scripts/apply-transcripts.ts /app/whisper-runs/$FNAME" \
        2>&1 | tail -2 || true
    fi
  done
  sleep "$INTERVAL"
done
