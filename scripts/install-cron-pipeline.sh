#!/bin/bash
# install-cron-pipeline.sh — production install for SalesGuru cron + worker.
#
# Architecture (industrial producer/consumer):
#   1. CRON producer  (every 15 min) — cron-master-pipeline.ts with --skip-gpu
#                                       --skip-deepseek. Fast (~5 min cycle).
#                                       Pulls PBX delta, fills metadata, marks
#                                       'pending' rows for the worker.
#   2. SYSTEMD worker (always-on)    — whisper-worker.ts. Picks pending rows
#                                       (FOR UPDATE SKIP LOCKED), runs Whisper
#                                       + DeepSeek persist, marks 'transcribed'.
#                                       Restart=always, survives reboots.
#   3. CRON cleanup   (03:00 daily)  — older /tmp files.
#   4. CRON health    (04:00 daily)  — daily-health-check (TODO).
#
# Kill switches:
#   touch /tmp/disable-cron-pipeline   → producer cron exit 0
#   systemctl stop whisper-worker@diva-school → worker stops gracefully
#
# Usage (on prod, as root):
#   bash scripts/install-cron-pipeline.sh

set -euo pipefail

REPO=/root/smart-analyze
LOG_DIR=/var/log/smart-analyze
BACKUP=~/cron-backup-$(date +%Y-%m-%d).txt
MARK_BEGIN="# >>> SalesGuru cron-master-pipeline (managed)"
MARK_END="# <<< SalesGuru cron-master-pipeline"

if [ -f /tmp/disable-cron-pipeline ]; then
  echo "WARN: kill switch /tmp/disable-cron-pipeline exists — install proceeds, but cron will exit 0 until removed."
fi

mkdir -p "$LOG_DIR"
crontab -l > "$BACKUP" 2>/dev/null || echo "# (no existing crontab)" > "$BACKUP"
echo "[install] crontab backup → $BACKUP"

# ───── 1. Build the cron docker image (once) ─────
echo "[install] building salesguru-cron:latest image..."
cat > /tmp/Dockerfile.cron <<'EOF'
FROM node:22
RUN apt-get update -qq && apt-get install -qq -y sshpass openssh-client && rm -rf /var/lib/apt/lists/*
EOF
docker build -q -t salesguru-cron:latest -f /tmp/Dockerfile.cron /tmp/ >/dev/null
echo "[install]   ✓ image $(docker images salesguru-cron --format '{{.Tag}} {{.Size}}')"

# ───── 2. Producer cron (managed block) ─────
# Secrets live in $REPO/.env (chmod 600 root-only). We use sh wrapper +
# `set -a; . .env; set +a` rather than docker --env-file because
# --env-file does NOT strip quotes around values (e.g. DATABASE_URL="...")
# and Prisma then tries to resolve a hostname with a literal " in it.
# bash source handles quoting correctly. NEVER hardcode secrets here.
#
# CRITICAL: `sh -c 'cmd' arg1 arg2` makes arg1=$0, arg2=$1 — they do NOT
# reach `cmd` unless `cmd` references "$@". Without "$@" tsx runs with no
# script and exits 0 silently (no log). The `--` after the wrapper is the
# placeholder for $0; real script + flags become $1..$N inside "$@".
RUN_TSX="docker run --rm --network smart-analyze_default \
-v $REPO:/app -w /app \
-v $LOG_DIR:$LOG_DIR \
-e USE_DIRECT_DB=1 \
salesguru-cron:latest sh -c 'set -a && . /app/.env && set +a && exec node_modules/.bin/tsx \"\$@\"' --"

if crontab -l 2>/dev/null | grep -qF "$MARK_BEGIN"; then
  echo "[install] removing previous managed block"
  crontab -l 2>/dev/null | sed "/$MARK_BEGIN/,/$MARK_END/d" | crontab -
fi

CRON_BODY=$(cat <<EOF
$MARK_BEGIN
# Producer: PBX delta + GC linking + reconcile + LastSync (no GPU/DeepSeek).
# Worker (whisper-worker.service) handles Stage 4-7. Producer ~5 min cycle.
*/15 * * * * if [ ! -f /tmp/disable-cron-pipeline ]; then $RUN_TSX scripts/cron-master-pipeline.ts diva-school --skip-gpu --skip-deepseek >> $LOG_DIR/diva-producer.log 2>&1; fi
# Cleanup at 03:00 — transient files older than 2 days, never touch *.lock.
0 3 * * * find /tmp -maxdepth 2 -type f -mtime +2 ! -name '*.lock' -delete
# Daily health check at 04:00 — producer/worker/discrepancy/GPU/disk/cookie + balances.
0 4 * * * $RUN_TSX scripts/daily-health-check.ts >> $LOG_DIR/health.log 2>&1
# API balance probe every 6h — Telegram alert if DeepSeek<\$5 or Intelion<500₽.
0 */6 * * * $RUN_TSX scripts/check-api-balances.ts >> $LOG_DIR/balances.log 2>&1
# Hourly GC cookie probe — refreshes ONLY when age > 5d OR probe fails.
# Uses Playwright image because refresh-gc-cookie.ts logs into web UI.
# Credentials inherited from $REPO/.env via --env-file (NOT hardcoded).
0 * * * * docker run --rm --network smart-analyze_default -v $REPO:/app -w /app -v $LOG_DIR:$LOG_DIR mcr.microsoft.com/playwright:v1.59.1-jammy sh -c 'set -a && . /app/.env && set +a && ./node_modules/.bin/tsx scripts/cron-gc-cookie-check.ts' >> $LOG_DIR/gc-cookie.log 2>&1
$MARK_END
EOF
)

(crontab -l 2>/dev/null || true; echo "$CRON_BODY") | crontab -
echo "[install] crontab installed:"
crontab -l | sed -n "/$MARK_BEGIN/,/$MARK_END/p"

# ───── 3. Worker systemd unit ─────
echo "[install] systemd unit /etc/systemd/system/whisper-worker@.service"
cat > /etc/systemd/system/whisper-worker@.service <<'UNIT'
[Unit]
Description=SalesGuru whisper-worker for tenant %i
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/smart-analyze
# All secrets live in /root/smart-analyze/.env (chmod 600). Never duplicate
# them as Environment= here — this file lives under /etc/systemd/system/
# (world-readable by default) AND would shadow .env if it diverged.
EnvironmentFile=/root/smart-analyze/.env
Environment=USE_DIRECT_DB=1
Environment=REPO_ROOT=/root/smart-analyze
ExecStart=/usr/bin/docker run --rm --name whisper-worker-%i --network smart-analyze_default \
  -v /root/smart-analyze:/app -w /app \
  -v /var/log/smart-analyze:/var/log/smart-analyze \
  -e USE_DIRECT_DB=1 -e REPO_ROOT=/app \
  salesguru-cron:latest sh -c "set -a && . /app/.env && set +a && exec node_modules/.bin/tsx scripts/whisper-worker.ts %i"
ExecStop=/usr/bin/docker stop -t 60 whisper-worker-%i
Restart=always
RestartSec=30
TimeoutStartSec=120
TimeoutStopSec=120
KillSignal=SIGTERM
StandardOutput=append:/var/log/smart-analyze/worker-%i.log
StandardError=append:/var/log/smart-analyze/worker-%i.log

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable whisper-worker@diva-school.service >/dev/null 2>&1 || true
echo "[install]   ✓ whisper-worker@diva-school.service enabled"

# Don't auto-start — let user verify config first
echo
echo "[install] DONE. Manual next steps:"
echo "  systemctl start whisper-worker@diva-school    # start the worker"
echo "  systemctl status whisper-worker@diva-school   # verify"
echo "  journalctl -u whisper-worker@diva-school -f   # tail logs"
echo "  tail -f $LOG_DIR/diva-producer.log            # tail producer logs"
echo
echo "[install] kill switch: touch /tmp/disable-cron-pipeline (producer only)"
echo "[install] worker kill: systemctl stop whisper-worker@diva-school"
echo "[install] backup at $BACKUP"
