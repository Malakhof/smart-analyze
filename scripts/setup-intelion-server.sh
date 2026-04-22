#!/bin/bash
# One-shot setup for fresh Intelion Cloud RTX 3090 instance.
# Run on server as root after first ssh login.
#
# Steps:
#   1. System update + ffmpeg + python deps
#   2. Install faster-whisper + dependencies (CUDA-compatible)
#   3. Pre-download large-v3 model (~2.9 GB) so first batch starts fast
#   4. Setup workdir
#
# Usage: bash setup-intelion-server.sh

set -euo pipefail

echo "=== [1/4] System packages ==="
apt update -y
apt install -y ffmpeg python3 python3-pip python3-venv tmux htop nvtop curl

echo
echo "=== [2/4] Python venv + faster-whisper ==="
python3 -m venv /opt/whisper-env
source /opt/whisper-env/bin/activate
pip install --upgrade pip
# faster-whisper + CTranslate2 (for CUDA) — uses NVIDIA cuBLAS already on Intelion images
pip install faster-whisper==1.0.3
pip install ctranslate2==4.4.0  # explicit version to match cuBLAS on Ubuntu 22.04 + CUDA 12

echo
echo "=== [3/4] Pre-download large-v3 model ==="
python3 -c "
from faster_whisper import WhisperModel
print('Downloading large-v3...')
m = WhisperModel('large-v3', device='cuda', compute_type='float16')
print('OK. Model in cache.')
"

echo
echo "=== [4/4] Workdir ==="
mkdir -p /workspace/audio /workspace/results /workspace/scripts
chmod 755 /workspace
echo "Workdir: /workspace"

echo
echo "=== Verify GPU ==="
nvidia-smi | head -20

echo
echo "✅ READY. Next:"
echo "  scp scripts/intelion-transcribe-v2.py root@INTELION_IP:/workspace/scripts/"
echo "  scp batch.jsonl root@INTELION_IP:/workspace/"
echo "  ssh root@INTELION_IP 'cd /workspace && source /opt/whisper-env/bin/activate && python3 scripts/intelion-transcribe-v2.py batch.jsonl results.jsonl'"
