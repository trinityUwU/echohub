#!/bin/bash
set -e

mkdir -p /mnt/projects/echohub/logs
mkdir -p /mnt/models/echohub

# Kill only EchoHub-specific processes (by name, not port)
pkill -f "uvicorn.*echohub" 2>/dev/null || true
pkill -f "vite.*echohub" 2>/dev/null || true

# Clean stale PID files
rm -f /tmp/echohub_backend.pid /tmp/echohub_frontend.pid

# ─── Backend venv ─────────────────────────────────────────────────────────────
cd /mnt/projects/echohub/backend

if [ ! -d ".venv" ]; then
  echo "Creating Python venv..."
  python3 -m venv .venv

  # Détecter le hardware pour installer llama-cpp-python avec le bon backend
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    echo "NVIDIA GPU detected — installing llama-cpp-python with CUDA support..."
    CMAKE_ARGS="-DGGML_CUDA=on" .venv/bin/pip install llama-cpp-python -q
  elif command -v rocm-smi &>/dev/null; then
    echo "AMD GPU detected — installing llama-cpp-python with ROCm support..."
    CMAKE_ARGS="-DGGML_HIPBLAS=on" .venv/bin/pip install llama-cpp-python -q
  elif [[ "$(uname)" == "Darwin" ]]; then
    echo "Apple Silicon detected — installing llama-cpp-python with Metal support..."
    CMAKE_ARGS="-DGGML_METAL=on" .venv/bin/pip install llama-cpp-python -q
  else
    echo "No GPU detected — installing llama-cpp-python for CPU..."
    .venv/bin/pip install llama-cpp-python -q
  fi

  # Installer les autres dépendances (sans llama-cpp-python pour éviter double install)
  .venv/bin/pip install fastapi uvicorn[standard] huggingface_hub loguru pydantic httpx python-dotenv -q
fi

source .venv/bin/activate
PYTHONPATH=/mnt/projects/echohub uvicorn backend.main:app \
  --host 0.0.0.0 \
  --port 37821 \
  > /mnt/projects/echohub/logs/backend.log 2>&1 &
echo $! > /tmp/echohub_backend.pid
echo "Backend started (PID $!) — port 37821"

# ─── Frontend ─────────────────────────────────────────────────────────────────
cd /mnt/projects/echohub/frontend

if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  bun install
fi

bun run dev > /mnt/projects/echohub/logs/frontend.log 2>&1 &
echo $! > /tmp/echohub_frontend.pid
echo "Frontend started (PID $!) — port 37822"

echo ""
echo "EchoHub running"
echo "  Backend  : http://localhost:37821"
echo "  Frontend : http://localhost:37822"
echo "  Engine   : llama-cpp-python (GGUF) | vLLM optional (NVIDIA AWQ/GPTQ)"
