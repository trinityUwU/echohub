#!/bin/bash
set -e

mkdir -p /mnt/projects/echohub/logs
mkdir -p /mnt/models/echohub

pkill -f "uvicorn.*echohub" 2>/dev/null || true
pkill -f "tauri.*echohub"   2>/dev/null || true
pkill -f "vite"             2>/dev/null || true
rm -f /tmp/echohub_backend.pid /tmp/echohub_tauri.pid
sleep 1

# ─── Backend ──────────────────────────────────────────────────────────────────
cd /mnt/projects/echohub/backend

if [ ! -d ".venv" ]; then
  echo "[echohub] Creating Python venv..."
  python3 -m venv .venv

  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
    echo "[echohub] NVIDIA GPU detected"
    # Arch Linux: CUDA 13 needs gcc-15 as host compiler
    if [ -f /usr/bin/gcc-15 ] && [ -d /opt/cuda ]; then
      echo "[echohub] Arch Linux + CUDA detected — compiling with gcc-15"
      CUDA_PATH=/opt/cuda PATH="/opt/cuda/bin:$PATH" \
        NVCC_CCBIN=/usr/bin/gcc-15 \
        CMAKE_ARGS="-DGGML_CUDA=on -DCMAKE_CUDA_ARCHITECTURES=native -DCMAKE_CUDA_FLAGS=--allow-unsupported-compiler -DCMAKE_CUDA_HOST_COMPILER=/usr/bin/gcc-15" \
        .venv/bin/pip install llama-cpp-python --no-cache-dir
    else
      CMAKE_ARGS="-DGGML_CUDA=on" .venv/bin/pip install llama-cpp-python --no-cache-dir
    fi
  elif command -v rocm-smi &>/dev/null 2>&1; then
    echo "[echohub] AMD ROCm detected"
    CMAKE_ARGS="-DGGML_HIPBLAS=on" .venv/bin/pip install llama-cpp-python --no-cache-dir
  elif [[ "$(uname)" == "Darwin" ]]; then
    echo "[echohub] macOS detected"
    CMAKE_ARGS="-DGGML_METAL=on" .venv/bin/pip install llama-cpp-python --no-cache-dir
  else
    echo "[echohub] No GPU — CPU inference only"
    .venv/bin/pip install llama-cpp-python --no-cache-dir
  fi

  .venv/bin/pip install fastapi "uvicorn[standard]" huggingface_hub loguru pydantic httpx python-dotenv -q
fi

.venv/bin/python -c "import llama_cpp" 2>/dev/null || {
  echo "[echohub] llama_cpp import failed — reinstalling..."
  CMAKE_ARGS="-DGGML_CUDA=on" .venv/bin/pip install llama-cpp-python --force-reinstall --no-cache-dir
}

PYTHONPATH=/mnt/projects/echohub \
  .venv/bin/uvicorn backend.main:app \
    --host 0.0.0.0 --port 37821 \
    > /mnt/projects/echohub/logs/backend.log 2>&1 &
echo $! > /tmp/echohub_backend.pid
echo "[echohub] Backend started (PID $!) — port 37821"

# ─── Tauri app ────────────────────────────────────────────────────────────────
cd /mnt/projects/echohub/frontend

if [ ! -d "node_modules" ]; then
  echo "[echohub] Installing frontend dependencies..."
  bun install
fi

# Display backend detection (Wayland vs X11)
SESSION="${ECHOHUB_DISPLAY_BACKEND:-${XDG_SESSION_TYPE:-}}"
if [ -z "$SESSION" ] && [ -n "$WAYLAND_DISPLAY" ]; then SESSION="wayland"; fi
if [ -z "$SESSION" ] && [ -n "$DISPLAY" ];          then SESSION="x11"; fi

if [ "$SESSION" = "wayland" ]; then
  export GDK_BACKEND=x11
  export WEBKIT_DISABLE_COMPOSITING_MODE=1
  echo "[echohub] Wayland detected — using XWayland"
fi

export VITE_MSW=false   # prod: use real backend

cargo tauri dev > /mnt/projects/echohub/logs/tauri.log 2>&1 &
echo $! > /tmp/echohub_tauri.pid
echo "[echohub] Tauri app starting (PID $!) — logs/tauri.log"

echo ""
echo "EchoHub is starting..."
echo "  Backend  : http://localhost:37821"
echo "  App logs : tail -f logs/tauri.log"
echo ""
echo "To stop: ./stop.sh"
