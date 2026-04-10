#!/bin/bash
set -e

SERVER="root@80.76.60.130"
SSH_KEY="~/.ssh/timeweb"
PROJECT_DIR="/root/smart-analyze"

echo "🚀 Deploying Smart Analyze..."

ssh -i $SSH_KEY $SERVER "
  cd $PROJECT_DIR && \
  git pull && \
  docker compose -f docker-compose.prod.yml up -d --build && \
  sleep 5 && \
  docker exec smart-analyze-app npx prisma migrate deploy && \
  echo '✅ Deploy complete!'
"
