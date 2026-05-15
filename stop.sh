#!/bin/bash

echo "Stopping EchoHub..."

for pidfile in /tmp/echohub_backend.pid /tmp/echohub_frontend.pid /tmp/echohub_vllm.pid; do
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && echo "Killed PID $pid ($pidfile)"
    fi
    rm -f "$pidfile"
  fi
done

# Safety net — kill any leftover vllm process
pkill -f "vllm.entrypoints" 2>/dev/null && echo "Killed stale vLLM process" || true
pkill -f "uvicorn.*echohub" 2>/dev/null || true
sleep 1

echo "EchoHub stopped"
