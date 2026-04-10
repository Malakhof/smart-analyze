#!/bin/bash
set -e

SERVER="root@80.76.60.130"
SSH_KEY="~/.ssh/timeweb"

echo "🚀 First deploy of Smart Analyze..."

ssh -i $SSH_KEY $SERVER "
  cd /root && \
  git clone https://github.com/Malakhof/smart-analyze.git && \
  cd smart-analyze && \
  cp .env.example .env && \
  echo 'Edit .env with production values, then run:' && \
  echo 'docker compose -f docker-compose.prod.yml up -d --build' && \
  echo 'docker exec smart-analyze-app npx prisma migrate deploy' && \
  echo 'docker exec smart-analyze-app npx prisma db seed'
"
