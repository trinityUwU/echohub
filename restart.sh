#!/bin/bash
# restart.sh — kills all EchoHub processes cleanly then relaunches
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Stopping EchoHub..."

# Kill by PID files first
for pidfile in /tmp/echohub_backend.pid /tmp/echohub_tauri.pid /tmp/echohub_frontend.pid /tmp/echohub_vllm.pid; do
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    kill -0 "$pid" 2>/dev/null && kill "$pid" && echo "  Killed PID $pid ($pidfile)"
    rm -f "$pidfile"
  fi
done

# Kill by process name — covers cases where PID files are stale
pkill -f "uvicorn backend.main" 2>/dev/null && echo "  Killed uvicorn" || true
pkill -f "cargo-tauri tauri dev"  2>/dev/null && echo "  Killed cargo tauri dev" || true
pkill -f "vite.*echohub"           2>/dev/null && echo "  Killed vite" || true
pkill -f "vllm.entrypoints"        2>/dev/null && echo "  Killed vLLM" || true

# Wait for ports to free up
sleep 2

echo "Restarting EchoHub..."
exec "$ROOT/start.sh"
