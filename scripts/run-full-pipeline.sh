#!/bin/bash
# Full transcription pipeline: Whisper → AI roles → re-merge → DB write → (optionally) voicemail + repair + script-score
#
# Usage:
#   ./scripts/run-full-pipeline.sh <batch.jsonl> <out_dir> [--gpus=1|3]
#
# Modes:
#   --gpus=1 (default, production): single Intelion RTX 3090, sequential
#   --gpus=3 (historical backfill): 3 parallel Intelion RTX 3090 servers, batch split 3-way
#
# Cost: same total ~44₽/h × N servers × hours. 3-GPU just compresses wall clock 3x.
#
# Pre-reqs:
#   - DEEPSEEK_API_KEY in .env
#   - sshpass installed
#   - Prisma migration applied on prod (4 columns)

set -euo pipefail

INPUT="${1:?Usage: $0 <batch.jsonl> <out_dir> [--gpus=N]}"
OUT_DIR="${2:?Usage: $0 <batch.jsonl> <out_dir> [--gpus=N]}"
GPUS=1
for arg in "${@:3}"; do
  case $arg in
    --gpus=*) GPUS="${arg#*=}" ;;
  esac
done

mkdir -p "$OUT_DIR"
cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)

# Server config — server IDs and IPs, indexed 0..GPUS-1
# In production (1 GPU): only [0] used.
# Historical (3 GPU): all 3 used. Server 5596 + 5597 must be created first via dashboard or API.
declare -a SERVER_IDS=(5598 5597 5596)
declare -a SERVER_IPS=("185.182.108.99" "TBD_5597_IP" "TBD_5596_IP")
SERVER_PW='7etwCHjJ7_Qs'  # NOTE: each server has own pw — TODO: pull via API
SSH_OPTS="-o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no"
INTELION_TOKEN="0ffe8d40464a606588e29815bc4fa10399a141ba"

api_call() {
  local method=$1 path=$2 body=${3:-}
  curl -s -c /tmp/intelion-cookie.txt "https://intelion.cloud/" > /dev/null
  local csrf=$(grep csrftoken /tmp/intelion-cookie.txt | awk '{print $7}')
  if [ -n "$body" ]; then
    curl -s -X "$method" "https://intelion.cloud$path" \
      -H "Authorization: Token $INTELION_TOKEN" \
      -H "Cookie: csrftoken=$csrf" -H "X-CSRFToken: $csrf" -H "Referer: https://intelion.cloud/" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl -s "https://intelion.cloud$path" -H "Authorization: Token $INTELION_TOKEN"
  fi
}

start_server() {
  local id=$1
  echo "  Starting server $id..."
  api_call POST "/api/v2/cloud-servers/$id/actions/" '{"status": 2}' > /dev/null
}

stop_server() {
  local id=$1
  echo "  Stopping server $id..."
  api_call POST "/api/v2/cloud-servers/$id/actions/" '{"status": -1}' > /dev/null
}

wait_server_ready() {
  local id=$1
  for i in {1..30}; do
    local s=$(api_call GET "/api/v2/cloud-servers/$id/" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('status','?'))")
    if [ "$s" = "2" ]; then
      echo "  Server $id ready (status=2)"
      return 0
    fi
    sleep 10
  done
  echo "  ❌ Server $id failed to start"; return 1
}

split_batch() {
  local input=$1 chunks=$2 outdir=$3
  python3 -c "
import json, sys
lines = [l for l in open('$input') if l.strip()]
n = len(lines)
chunks = $chunks
per = (n + chunks - 1) // chunks
for i in range(chunks):
    chunk = lines[i*per:(i+1)*per]
    with open(f'$outdir/chunk-{i}.jsonl','w') as f:
        f.writelines(chunk)
    print(f'chunk-{i}: {len(chunk)} calls')
"
}

run_whisper_on_server() {
  local idx=$1
  local ip="${SERVER_IPS[$idx]}"
  local chunk="$OUT_DIR/chunk-$idx.jsonl"
  local result="$OUT_DIR/whisper-$idx.jsonl"
  echo "  [$idx] Whisper → $ip ..."
  sshpass -p "$SERVER_PW" scp $SSH_OPTS "$chunk" root@$ip:/workspace/batch.jsonl
  sshpass -p "$SERVER_PW" scp $SSH_OPTS scripts/intelion-transcribe-v2.py root@$ip:/workspace/scripts/
  # Pass onPBX creds so intelion-transcribe-v2.py can resolve_onpbx_url() per uuid (option-C path).
  # ON_PBX_* values come from caller env (set when launching this script) — fail loud if missing.
  : "${ON_PBX_DOMAIN:?ON_PBX_DOMAIN not set in caller env}"
  : "${ON_PBX_KEY_ID:?ON_PBX_KEY_ID not set in caller env}"
  : "${ON_PBX_KEY:?ON_PBX_KEY not set in caller env}"
  # nohup setsid — full session detachment (canon feedback-ssh-intelion-quirks).
  # Redirection order: > run.log 2>&1 (NOT 2>&1 > run.log).
  # < /dev/null detaches stdin so ssh client returns immediately.
  # Whisper duration filter: MIN_DURATION/MAX_DURATION. Diva regularly has
  # 60-180 min selling calls, so cap at 3h. Override via env if needed.
  local min_dur="${WHISPER_MIN_DURATION:-60}"
  local max_dur="${WHISPER_MAX_DURATION:-10800}"
  sshpass -p "$SERVER_PW" ssh $SSH_OPTS root@$ip "
nohup setsid bash -c '
source /opt/whisper-env/bin/activate
export LD_LIBRARY_PATH=/opt/whisper-env/lib/python3.10/site-packages/nvidia/cudnn/lib:\$LD_LIBRARY_PATH
export ON_PBX_DOMAIN=\"$ON_PBX_DOMAIN\"
export ON_PBX_KEY_ID=\"$ON_PBX_KEY_ID\"
export ON_PBX_KEY=\"$ON_PBX_KEY\"
export MIN_DURATION=$min_dur
export MAX_DURATION=$max_dur
cd /workspace
ECHO_ENERGY_RATIO=2.5 python3 scripts/intelion-transcribe-v2.py batch.jsonl results.jsonl > run.log 2>&1
' < /dev/null > /workspace/launch.out 2>&1 &
sleep 2
"
}

poll_whisper_done() {
  local ip=$1
  while sshpass -p "$SERVER_PW" ssh $SSH_OPTS root@$ip "pgrep -f intelion-transcribe > /dev/null"; do
    sleep 30
  done
}

# ───── PIPELINE ─────

echo "=== Mode: $GPUS GPU(s) ==="

# 1. Start servers
echo "=== [1/7] Start $GPUS Intelion server(s) ==="
for ((i=0; i<GPUS; i++)); do
  start_server "${SERVER_IDS[$i]}"
done
echo "Waiting for servers to boot..."
for ((i=0; i<GPUS; i++)); do
  wait_server_ready "${SERVER_IDS[$i]}"
done

# 2. Split batch + run Whisper in parallel
echo "=== [2/7] Split batch into $GPUS chunks ==="
split_batch "$INPUT" "$GPUS" "$OUT_DIR"

echo "=== [3/7] Run Whisper on all GPUs in parallel ==="
for ((i=0; i<GPUS; i++)); do
  run_whisper_on_server $i
done

echo "Polling completion (check every 30s)..."
for ((i=0; i<GPUS; i++)); do
  echo "  Waiting for chunk-$i on ${SERVER_IPS[$i]}..."
  poll_whisper_done "${SERVER_IPS[$i]}"
  sshpass -p "$SERVER_PW" scp $SSH_OPTS root@${SERVER_IPS[$i]}:/workspace/results.jsonl "$OUT_DIR/whisper-$i.jsonl"
  echo "    ✅ chunk-$i done"
done

# Combine
cat "$OUT_DIR"/whisper-*.jsonl > "$OUT_DIR/whisper.jsonl"
WHISPER_OK=$(grep -c '"transcript"' "$OUT_DIR/whisper.jsonl" || echo 0)
echo "Total transcribed: $WHISPER_OK"

# 4-5. AI role detection + re-merge.
# v2.5: SKIP for tenants where pipeline default LEFT=МЕНЕДЖЕР is reliable
# (onPBX inbound/outbound — diva). AI detector relied on first-30s window which
# Whisper repetition guards corrupted; default heuristic outperforms AI on these.
SKIP_AI_TENANTS="diva-school"
INPUT_TENANTS=$(python3 -c "
import json
tenants = set()
for line in open('$INPUT'):
    line = line.strip()
    if not line: continue
    try: tenants.add(json.loads(line).get('tenant',''))
    except: pass
print(','.join(sorted(tenants)))
")
SKIP_AI=0
for skip_t in $SKIP_AI_TENANTS; do
  if [[ "$INPUT_TENANTS" == "$skip_t" ]]; then
    SKIP_AI=1
    break
  fi
done

if [ "$SKIP_AI" = "1" ]; then
  echo "=== [4-5/7] SKIP AI role detector (tenant=$INPUT_TENANTS — default LEFT=МЕНЕДЖЕР reliable) ==="
  cp "$OUT_DIR/whisper.jsonl" "$OUT_DIR/merged.jsonl"
else
  echo "=== [4/7] AI role detector (DeepSeek) ==="
  tsx scripts/detect-channel-roles.ts --input "$OUT_DIR/whisper.jsonl" --out "$OUT_DIR/roles.jsonl" 2>&1 | tail -5

  echo "=== [5/7] Re-merge with AI roles ==="
  python3 scripts/orchestrate-pipeline.py \
    --input "$OUT_DIR/whisper.jsonl" \
    --roles "$OUT_DIR/roles.jsonl" \
    --output "$OUT_DIR/merged.jsonl"
fi

# 6. Persist to DB
echo "=== [6/7] Persist to DB ==="
tsx scripts/persist-pipeline-results.ts --input "$OUT_DIR/merged.jsonl" 2>&1 | tail -5 \
  || echo "  ⚠️ persist-pipeline-results.ts not yet implemented — manual import needed"

# 7. Stop servers (cost savings)
echo "=== [7/7] Stop $GPUS Intelion server(s) ==="
for ((i=0; i<GPUS; i++)); do
  stop_server "${SERVER_IDS[$i]}"
done

# Summary
{
  echo "=== SUMMARY ==="
  echo "Date: $(date)"
  echo "Mode: $GPUS GPU(s)"
  echo "Input: $INPUT"
  echo "Output dir: $OUT_DIR"
  echo "Transcribed: $WHISPER_OK"
  echo
  echo "Next steps (run after DB persist):"
  echo "  tsx scripts/detect-call-type.ts --tenant=all --limit=10000 --write-back"
  echo "  tsx scripts/repair-transcripts.ts --tenant=all --limit=10000 --write-back"
  echo "  tsx scripts/score-diva-script-compliance.ts --tenant=diva-school --limit=10000 --write-back"
} | tee "$OUT_DIR/SUMMARY.txt"
