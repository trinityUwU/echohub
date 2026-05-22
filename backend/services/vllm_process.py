"""
vllm_process.py — PID management and VRAM logging helpers for vLLM subprocess.
Pure utilities with no dependency on vllm_service globals.
"""
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Optional

from loguru import logger

VLLM_PID_FILE = Path("/tmp/echohub_vllm.pid")


def _write_pid(pid: int) -> None:
    VLLM_PID_FILE.write_text(str(pid))


def _read_pid() -> Optional[int]:
    if VLLM_PID_FILE.exists():
        try:
            return int(VLLM_PID_FILE.read_text().strip())
        except ValueError:
            return None
    return None


def _remove_pid() -> None:
    VLLM_PID_FILE.unlink(missing_ok=True)


def _kill_pid(pid: int) -> None:
    """Kill a process by PID, wait for it to die."""
    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(30):  # wait up to 3s
            time.sleep(0.1)
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                logger.info(f"vLLM PID {pid} terminated")
                return
        # Force kill if still alive
        os.kill(pid, signal.SIGKILL)
        logger.warning(f"vLLM PID {pid} force-killed with SIGKILL")
    except ProcessLookupError:
        logger.info(f"vLLM PID {pid} already gone")


def _log_vram_freed() -> None:
    """Log nvidia-smi VRAM after unload for verification."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            used, free = result.stdout.strip().split(",")
            logger.info(f"VRAM after unload — used: {used.strip()} MB, free: {free.strip()} MB")
    except Exception as e:
        logger.warning(f"Could not verify VRAM after unload: {e}")
