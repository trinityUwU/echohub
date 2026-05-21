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
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from loguru import logger

from backend.services.db import get_app_state, set_app_state

router = APIRouter(prefix="/installer", tags=["installer"])

ROOT = Path(__file__).resolve().parents[2]

GpuType = Literal["nvidia", "amd", "apple", "cpu"]


def _sse(msg: str, level: str = "info") -> str:
    return f"data: {json.dumps({'level': level, 'msg': msg, 'ts': time.time()})}\n\n"


def _step(title: str) -> str:
    return f"data: {json.dumps({'level': 'step', 'msg': title, 'ts': time.time()})}\n\n"


def _done(success: bool) -> str:
    return f"data: {json.dumps({'done': True, 'success': success, 'ts': time.time()})}\n\n"


def _detect_gpu() -> GpuType:
    """Reliable GPU detection — nvidia-smi -L must list a device, not just return 0."""
    # NVIDIA: require an actual device line, not just driver presence
    try:
        r = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip():
            return "nvidia"
    except Exception:
        pass

    # AMD ROCm
    try:
        r = subprocess.run(["rocm-smi", "--showproductname"], capture_output=True, timeout=5)
        if r.returncode == 0:
            return "amd"
    except Exception:
        pass

    if platform.system() == "Darwin":
        return "apple"

    return "cpu"


@router.get("/diagnose")
def diagnose() -> dict:
    """Return GPU type, llama backend, and whether they match — used for health check on app start."""
    gpu_type = _detect_gpu()
    expected_backend = {"nvidia": "cuda", "amd": "hipblas", "apple": "metal"}.get(gpu_type, "cpu")

    venv_python = ROOT / "backend" / ".venv" / "bin" / "python"
    actual_backend: str | None = None
    llama_installed = False
    try:
        r = subprocess.run(
            [str(venv_python), "-c",
             "import llama_cpp, os; lib=os.path.join(os.path.dirname(llama_cpp.__file__),'lib');"
             "files=[f.lower() for f in os.listdir(lib)];"
             "print('cuda' if any('cuda' in f for f in files) else 'hipblas' if any('hipblas' in f or 'rocm' in f for f in files) else 'metal' if any('metal' in f for f in files) else 'cpu')"],
            capture_output=True, text=True, timeout=10,
        )
        actual_backend = r.stdout.strip() or None
        llama_installed = actual_backend is not None
    except Exception:
        pass

    issues: list[str] = []
    if llama_installed and actual_backend != expected_backend:
        issues.append(f"llama-cpp compiled for {actual_backend or 'unknown'} but {gpu_type} GPU detected — recompile needed")
    if not llama_installed:
        issues.append("llama-cpp-python not installed")

    return {
        "gpu_type": gpu_type,
        "expected_backend": expected_backend,
        "actual_backend": actual_backend,
        "llama_installed": llama_installed,
        "backend_ok": llama_installed and actual_backend == expected_backend,
        "issues": issues,
    }


@router.get("/recompile-llama")
async def recompile_llama():
    """SSE stream to recompile llama-cpp-python for current GPU — callable from Settings."""
    pip = ROOT / "backend" / ".venv" / "bin" / "pip"

    async def _stream():
        if not pip.exists():
            yield _sse("Backend venv not found — run full installer first", "error")
            yield _done(False)
            return
        yield _step("Recompiling llama-cpp-python for current GPU")
        async for chunk in _compile_llama_async(pip):
            yield chunk
        yield _done(True)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
        # Verify the installed backend matches the current GPU
        gpu_type = _detect_gpu()
        expected_backend = {"nvidia": "cuda", "amd": "hipblas", "apple": "metal"}.get(gpu_type, "cpu")
        mismatch = _check_llama_backend_mismatch(python_venv, gpu_type)
        if mismatch:
            yield _sse(f"Backend mismatch detected — installed: {mismatch}, expected: {expected_backend}", "warn")
            yield _sse("Recompiling for correct GPU backend…")
            async for chunk in _compile_llama_async(pip):
                yield chunk
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
        gpu_type = _detect_gpu()
        if gpu_type == "nvidia":
            yield _sse("NVIDIA GPU detected — installing vLLM 0.21.0 (this takes 10–30 min)…", "step")
            yield _sse("vLLM enables AWQ/GPTQ models with maximum throughput.")
            async for chunk in _install_vllm_async(managed):
                yield chunk
        else:
            gpu_label = {"amd": "AMD GPU (ROCm)", "apple": "Apple Silicon", "cpu": "No GPU"}.get(gpu_type, gpu_type)
            yield _sse(f"{gpu_label} detected — skipping vLLM (llama-cpp-python handles GGUF via ROCm/Metal/CPU)", "warn")

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


def _check_llama_backend_mismatch(python_bin: Path, gpu_type: GpuType) -> str | None:
    """Return actual backend name if it doesn't match the GPU, else None."""
    try:
        r = subprocess.run(
            [str(python_bin), "-c",
             "import llama_cpp, os; lib=os.path.join(os.path.dirname(llama_cpp.__file__),'lib');"
             "files=[f.lower() for f in os.listdir(lib)];"
             "print('cuda' if any('cuda' in f for f in files) else 'hipblas' if any('hipblas' in f or 'rocm' in f for f in files) else 'metal' if any('metal' in f for f in files) else 'cpu')"],
            capture_output=True, text=True, timeout=10,
        )
        actual = r.stdout.strip()
        expected = {"nvidia": "cuda", "amd": "hipblas", "apple": "metal"}.get(gpu_type, "cpu")
        if actual != expected:
            return actual
    except Exception:
        pass
    return None


async def _compile_llama_async(pip: Path):
    """Async generator for llama-cpp-python compilation — NVIDIA, AMD ROCm, Metal, CPU."""
    env = dict(os.environ)
    gpu_type = _detect_gpu()

    if gpu_type == "nvidia":
        yield _sse("NVIDIA GPU detected — compiling with CUDA…")
        is_arch = Path("/etc/arch-release").exists()
        if is_arch and Path("/usr/bin/gcc-15").exists() and Path("/opt/cuda").exists():
            yield _sse("Arch Linux + CUDA 13 detected — using gcc-15")
            env.update({
                "CUDA_PATH": "/opt/cuda",
                "PATH": f"/opt/cuda/bin:{env.get('PATH', '')}",
                "NVCC_CCBIN": "/usr/bin/gcc-15",
                "CMAKE_ARGS": (
                    "-DGGML_CUDA=on -DCMAKE_CUDA_ARCHITECTURES=native"
                    " -DCMAKE_CUDA_FLAGS=--allow-unsupported-compiler"
                    " -DCMAKE_CUDA_HOST_COMPILER=/usr/bin/gcc-15"
                ),
            })
        else:
            env["CMAKE_ARGS"] = "-DGGML_CUDA=on"

    elif gpu_type == "amd":
        yield _sse("AMD GPU detected — compiling with ROCm/HIP…")
        # Locate ROCm installation
        rocm_path = next(
            (p for p in ["/opt/rocm", "/usr/lib/rocm", "/usr/local/rocm"] if Path(p).exists()),
            None,
        )
        if rocm_path:
            yield _sse(f"ROCm found at {rocm_path}")
            env.update({
                "ROCM_PATH": rocm_path,
                "PATH": f"{rocm_path}/bin:{env.get('PATH', '')}",
                "CMAKE_ARGS": "-DGGML_HIPBLAS=on",
                "LLAMA_HIPBLAS": "1",
            })
        else:
            yield _sse("ROCm path not found — trying default HIPBlas flags", "warn")
            env["CMAKE_ARGS"] = "-DGGML_HIPBLAS=on"
            env["LLAMA_HIPBLAS"] = "1"

    elif gpu_type == "apple":
        yield _sse("macOS detected — Metal backend")
        env["CMAKE_ARGS"] = "-DGGML_METAL=on"

    else:
        yield _sse("No GPU detected — CPU backend")

    yield _sse("Compiling llama-cpp-python (3–10 min)…")
    if gpu_type in ("nvidia", "amd"):
        yield _sse("GPU compilation takes 3–15 min — do not close this window.", "warn")

    proc2 = await asyncio.create_subprocess_exec(
        str(pip), "install", "llama-cpp-python", "--no-cache-dir",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        env=env,
    )

    still_running_count = 0
    start_ts = time.time()

    async for line in proc2.stdout:
        decoded = line.decode().rstrip()
        if not decoded:
            continue
        if "still running" in decoded:
            still_running_count += 1
            elapsed = int(time.time() - start_ts)
            if still_running_count % 5 == 1:
                mins, secs = divmod(elapsed, 60)
                yield _sse(f"  Compiling… {mins}m{secs:02d}s elapsed (still working, this is normal)")
        else:
            still_running_count = 0
            yield _sse(decoded)

    rc = await proc2.wait()
    if rc == 0:
        yield _sse("llama-cpp-python compiled successfully", "ok")
    else:
        yield _sse("Compilation failed — will run on CPU (check ROCm/CUDA installation)", "warn")


async def _install_vllm_async(target_path: Path):
    """Install vLLM 0.21.0 into a new venv at target_path."""
    import asyncio as _aio

    # Create venv
    yield _sse(f"Creating vLLM venv at {target_path}…")
    proc = await _aio.create_subprocess_exec(
        sys.executable, "-m", "venv", str(target_path),
        stdout=_aio.subprocess.PIPE, stderr=_aio.subprocess.STDOUT,
    )
    await proc.wait()

    pip = target_path / "bin" / "pip"

    # Install vLLM
    yield _sse("Installing vLLM 0.21.0 (downloading ~4 GB)…")
    still_running_count = 0
    start_ts = time.time()
    proc2 = await _aio.create_subprocess_exec(
        str(pip), "install", "vllm==0.21.0", "--no-cache-dir",
        stdout=_aio.subprocess.PIPE, stderr=_aio.subprocess.STDOUT,
    )
    async for line in proc2.stdout:
        decoded = line.decode().rstrip()
        if not decoded:
            continue
        if "still running" in decoded:
            still_running_count += 1
            elapsed = int(time.time() - start_ts)
            if still_running_count % 5 == 1:
                mins, secs = divmod(elapsed, 60)
                yield _sse(f"  Installing… {mins}m{secs:02d}s elapsed")
        else:
            still_running_count = 0
            yield _sse(decoded)
    rc = await proc2.wait()
    if rc == 0:
        yield _sse("vLLM 0.21.0 installed successfully", "ok")
    else:
        yield _sse("vLLM installation failed — you can retry from Settings → Engines", "warn")
        import shutil as _shutil
        _shutil.rmtree(str(target_path), ignore_errors=True)
