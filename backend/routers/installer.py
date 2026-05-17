"""
Installer router — streams installation progress to the InstallerApp frontend.
Each step is a subprocess or validation check, streamed as SSE.
"""
from __future__ import annotations

import asyncio
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from loguru import logger

from backend.services.db import get_app_state, set_app_state

router = APIRouter(prefix="/installer", tags=["installer"])

ROOT = Path(__file__).resolve().parents[2]


def _sse(msg: str, level: str = "info") -> str:
    return f"data: {json.dumps({'level': level, 'msg': msg, 'ts': time.time()})}\n\n"


def _step(title: str) -> str:
    return f"data: {json.dumps({'level': 'step', 'msg': title, 'ts': time.time()})}\n\n"


def _done(success: bool) -> str:
    return f"data: {json.dumps({'done': True, 'success': success, 'ts': time.time()})}\n\n"


@router.get("/run")
async def run_installer():
    """SSE stream for the full installation process."""
    return StreamingResponse(
        _install_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/complete")
def mark_complete() -> dict:
    set_app_state("install_complete", "true")
    return {"status": "ok"}


@router.get("/status")
def get_status() -> dict:
    return {"complete": get_app_state("install_complete") == "true"}


async def _install_stream():
    yield _step("Checking system")
    yield _sse(f"OS: {platform.system()} {platform.release()}")
    yield _sse(f"Python: {sys.version.split()[0]}")

    # Check/create directories
    yield _step("Setting up directories")
    from backend.services.config_service import get_models_dir, get_vllm_envs_dir
    try:
        models = get_models_dir()
        vllm_envs = get_vllm_envs_dir()
        models.mkdir(parents=True, exist_ok=True)
        vllm_envs.mkdir(parents=True, exist_ok=True)
        yield _sse(f"Models dir: {models}", "ok")
        yield _sse(f"vLLM envs dir: {vllm_envs}", "ok")
    except Exception as e:
        yield _sse(f"Directory setup error: {e}", "warn")

    # Check backend venv
    yield _step("Backend Python environment")
    venv = ROOT / "backend" / ".venv"
    pip = venv / "bin" / "pip"
    if venv.exists() and pip.exists():
        yield _sse("Backend venv already installed", "ok")
    else:
        yield _sse("Creating backend venv…")
        async for line in _run_cmd([sys.executable, "-m", "venv", str(venv)]):
            yield _sse(line)
        yield _sse("Installing backend dependencies…")
        async for line in _run_cmd([str(pip), "install", "--quiet",
                                     "fastapi", "uvicorn[standard]", "huggingface_hub",
                                     "loguru", "pydantic", "httpx", "python-dotenv"]):
            yield _sse(line)
        yield _sse("Backend dependencies installed", "ok")

    # Check GPU + compile llama-cpp
    yield _step("Inference engine (llama-cpp-python)")
    python_venv = venv / "bin" / "python"
    result = subprocess.run([str(python_venv), "-c", "import llama_cpp; print('ok')"],
                            capture_output=True, text=True, timeout=15)
    if "ok" in result.stdout:
        yield _sse("llama-cpp-python already installed", "ok")
    else:
        async for chunk in _compile_llama_async(pip):
            yield chunk

    # Check vLLM
    yield _step("vLLM environment")
    legacy = ROOT / ".venv-vllm"
    vllm_envs_dir = get_vllm_envs_dir()
    managed = vllm_envs_dir / "0.21.0"
    if legacy.exists() and not managed.exists():
        yield _sse("Migrating legacy vLLM environment…")
        try:
            shutil.copytree(str(legacy), str(managed))
            yield _sse(f"Migrated to {managed}", "ok")
        except Exception as e:
            yield _sse(f"Migration error: {e}", "warn")
    elif managed.exists():
        yield _sse("vLLM 0.21.0 already available", "ok")
    else:
        yield _sse("No vLLM environment found. Install from Settings → Engines after launch.", "warn")

    # Mark complete
    set_app_state("install_complete", "true")
    yield _sse("Installation complete", "ok")
    yield _done(True)


async def _run_cmd(cmd: list[str]):
    """Run a command and yield output lines."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    async for line in proc.stdout:
        decoded = line.decode().rstrip()
        if decoded:
            yield decoded
    await proc.wait()


async def _compile_llama_async(pip: Path):
    """Async generator for llama-cpp-python compilation."""
    import subprocess as sp
    env = dict(os.environ)

    # Detect GPU
    has_nvidia = False
    try:
        r = sp.run(["nvidia-smi"], capture_output=True, timeout=5)
        has_nvidia = r.returncode == 0
    except Exception:
        pass

    if has_nvidia:
        yield _sse("NVIDIA GPU detected — compiling with CUDA…")
        is_arch = Path("/etc/arch-release").exists()
        if is_arch and Path("/usr/bin/gcc-15").exists() and Path("/opt/cuda").exists():
            yield _sse("Arch Linux + CUDA 13 detected — using gcc-15")
            env.update({
                "CUDA_PATH": "/opt/cuda",
                "PATH": f"/opt/cuda/bin:{env.get('PATH','')}",
                "NVCC_CCBIN": "/usr/bin/gcc-15",
                "CMAKE_ARGS": "-DGGML_CUDA=on -DCMAKE_CUDA_ARCHITECTURES=native -DCMAKE_CUDA_FLAGS=--allow-unsupported-compiler -DCMAKE_CUDA_HOST_COMPILER=/usr/bin/gcc-15",
            })
        else:
            env["CMAKE_ARGS"] = "-DGGML_CUDA=on"
    elif platform.system() == "Darwin":
        yield _sse("macOS detected — Metal backend")
        env["CMAKE_ARGS"] = "-DGGML_METAL=on"
    else:
        yield _sse("No GPU detected — CPU backend")

    yield _sse("Compiling llama-cpp-python (3–10 min)…")
    yield _sse("CUDA compilation is the longest step — do not close this window.", "warn")

    import asyncio as _aio
    proc2 = await _aio.create_subprocess_exec(
        str(pip), "install", "llama-cpp-python", "--no-cache-dir",
        stdout=_aio.subprocess.PIPE, stderr=_aio.subprocess.STDOUT,
        env=env,
    )

    still_running_count = 0
    start_ts = time.time()

    async for line in proc2.stdout:
        decoded = line.decode().rstrip()
        if not decoded:
            continue
        # Collapse repetitive "still running" into a timed progress line
        if "still running" in decoded:
            still_running_count += 1
            elapsed = int(time.time() - start_ts)
            if still_running_count % 5 == 1:  # emit every 5th occurrence
                mins, secs = divmod(elapsed, 60)
                yield _sse(f"  Compiling… {mins}m{secs:02d}s elapsed (still working, this is normal)")
        else:
            still_running_count = 0
            yield _sse(decoded)

    rc = await proc2.wait()
    if rc == 0:
        yield _sse("llama-cpp-python compiled successfully", "ok")
    else:
        yield _sse("Compilation failed — will run on CPU", "warn")
