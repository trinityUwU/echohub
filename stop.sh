#!/bin/bash
echo "Stopping EchoHub..."

for pidfile in /tmp/echohub_backend.pid /tmp/echohub_tauri.pid /tmp/echohub_frontend.pid /tmp/echohub_vllm.pid; do
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    kill -0 "$pid" 2>/dev/null && kill "$pid" && echo "  Killed PID $pid"
    rm -f "$pidfile"
  fi
done

pkill -f "vllm.entrypoints"  2>/dev/null || true
pkill -f "uvicorn.*echohub"  2>/dev/null || true
pkill -f "target/debug/app"  2>/dev/null || true
sleep 1

echo "EchoHub stopped"
