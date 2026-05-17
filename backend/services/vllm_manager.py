"""
vLLM environment manager.

Each vLLM version lives in its own isolated venv:
  ~/.local/share/echohub/vllm-envs/{version}/

This module handles:
  - Scanning and listing installed versions
  - Validating that a version is operational (not just installed)
  - Installing a new version (streaming SSE logs)
  - Deleting a version (with safety guard: last version is protected)
  - Resolving which Python executable to use for a given version
"""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import time
from pathlib import Path
from typing import AsyncGenerator, Optional

from loguru import logger

from backend.services.user_data import get_user_data_dir

ENVS_DIR_NAME = "vllm-envs"
# Legacy path shipped with v0.1
LEGACY_VENV = Path("/mnt/projects/echohub/.venv-vllm")


def get_envs_dir() -> Path:
    d = get_user_data_dir() / ENVS_DIR_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _venv_path(version: str) -> Path:
    return get_envs_dir() / version


def _python(version: str) -> Path:
    return _venv_path(version) / "bin" / "python"


def _get_installed_version_from_metadata(venv: Path) -> Optional[str]:
    """Read version from dist-info instead of running Python (fast)."""
    for dist in (venv / "lib").glob("python*/site-packages/vllm-*.dist-info/METADATA"):
        for line in dist.read_text(errors="ignore").splitlines():
            if line.startswith("Version:"):
                return line.split(":", 1)[1].strip()
    return None


def _dir_size_gb(path: Path) -> float:
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return round(total / (1024 ** 3), 2)


def _is_operational(version: str) -> bool:
    """Check that vLLM can be imported — quick subprocess test."""
    py = _python(version)
    if not py.exists():
        return False
    try:
        result = subprocess.run(
            [str(py), "-c", "from vllm.model_executor.models import ModelRegistry; print('ok')"],
            capture_output=True, text=True, timeout=30,
        )
        return result.returncode == 0 and "ok" in result.stdout
    except Exception:
        return False


def _get_supported_arch_count(version: str) -> int:
    """Return how many architectures this version supports."""
    py = _python(version)
    if not py.exists():
        return 0
    try:
        result = subprocess.run(
            [str(py), "-c",
             "from vllm.model_executor.models import ModelRegistry; "
             "print(len(ModelRegistry.get_supported_archs()))"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return int(result.stdout.strip())
    except Exception:
        pass
    return 0


def list_versions() -> list[dict]:
    """Return all installed vLLM versions with metadata."""
    envs_dir = get_envs_dir()
    versions = []

    # Include legacy venv if it exists and no managed envs yet
    managed = {p.name for p in envs_dir.iterdir() if p.is_dir()} if envs_dir.exists() else set()

    for venv_dir in sorted(envs_dir.iterdir() if envs_dir.exists() else []):
        if not venv_dir.is_dir():
            continue
        version = venv_dir.name
        py = _python(version)
        installed = py.exists()
        meta_version = _get_installed_version_from_metadata(venv_dir) if installed else None
        size_gb = _dir_size_gb(venv_dir) if installed else 0
        operational = _is_operational(version) if installed else False
        arch_count = _get_supported_arch_count(version) if operational else 0

        versions.append({
            "version": version,
            "path": str(venv_dir),
            "installed": installed,
            "operational": operational,
            "size_gb": size_gb,
            "arch_count": arch_count,
            "is_legacy": False,
        })

    # Check legacy venv
    if LEGACY_VENV.exists() and not any(v["version"] == "0.21.0" for v in versions):
        meta = _get_installed_version_from_metadata(LEGACY_VENV)
        size_gb = _dir_size_gb(LEGACY_VENV)
        operational = _is_operational_legacy()
        versions.insert(0, {
            "version": meta or "0.21.0",
            "path": str(LEGACY_VENV),
            "installed": True,
            "operational": operational,
            "size_gb": size_gb,
            "arch_count": _get_supported_arch_count_legacy() if operational else 0,
            "is_legacy": True,
        })

    return versions


def _is_operational_legacy() -> bool:
    py = LEGACY_VENV / "bin" / "python"
    if not py.exists():
        return False
    try:
        result = subprocess.run(
            [str(py), "-c", "from vllm.model_executor.models import ModelRegistry; print('ok')"],
            capture_output=True, text=True, timeout=30,
        )
        return result.returncode == 0 and "ok" in result.stdout
    except Exception:
        return False


def _get_supported_arch_count_legacy() -> int:
    py = LEGACY_VENV / "bin" / "python"
    try:
        result = subprocess.run(
            [str(py), "-c",
             "from vllm.model_executor.models import ModelRegistry; "
             "print(len(ModelRegistry.get_supported_archs()))"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return int(result.stdout.strip())
    except Exception:
        pass
    return 0


def get_python_for_version(version: str) -> Optional[Path]:
    """Return the python executable for a given vLLM version."""
    # Check managed envs first
    managed = _python(version)
    if managed.exists():
        return managed
    # Fall back to legacy venv
    if LEGACY_VENV.exists():
        legacy_py = LEGACY_VENV / "bin" / "python"
        if legacy_py.exists():
            meta = _get_installed_version_from_metadata(LEGACY_VENV)
            if meta == version or version == "0.21.0":
                return legacy_py
    return None


def get_default_python() -> Path:
    """Return the best available vLLM python (legacy or newest managed)."""
    # Prefer managed if available
    envs_dir = get_envs_dir()
    if envs_dir.exists():
        candidates = sorted(
            [p for p in envs_dir.iterdir() if p.is_dir() and _python(p.name).exists()],
            reverse=True
        )
        if candidates:
            return _python(candidates[0].name)
    # Fall back to legacy
    legacy_py = LEGACY_VENV / "bin" / "python"
    if legacy_py.exists():
        return legacy_py
    raise FileNotFoundError("No vLLM installation found")


def can_delete(version: str) -> tuple[bool, str]:
    """Returns (can_delete, reason). Protected if it's the last version."""
    versions = list_versions()
    operational = [v for v in versions if v["operational"]]
    if len(operational) <= 1:
        return False, "Cannot delete the last operational vLLM installation"
    return True, ""


def delete_version(version: str) -> None:
    ok, reason = can_delete(version)
    if not ok:
        raise RuntimeError(reason)
    venv = _venv_path(version)
    if venv.exists():
        shutil.rmtree(venv)
        logger.info(f"Deleted vLLM venv: {venv}")
    else:
        raise FileNotFoundError(f"vLLM version {version} not found at {venv}")


COMMON_ARCHITECTURES = {
    "Qwen3ForCausalLM", "Qwen2ForCausalLM", "LlamaForCausalLM", "MistralForCausalLM",
    "GemmaForCausalLM", "Gemma2ForCausalLM", "PhiForCausalLM", "Phi3ForCausalLM",
    "DeepseekV2ForCausalLM", "DeepseekV3ForCausalLM", "MixtralForCausalLM",
    "FalconForCausalLM", "GPTNeoXForCausalLM", "CohereForCausalLM",
    "Qwen2VLForConditionalGeneration", "LlavaForConditionalGeneration",
    "InternVLChatModel", "Qwen3_5ForConditionalGeneration",
}


def get_coverage_warning() -> Optional[str]:
    """Return a warning if installed versions cover few common architectures."""
    versions = list_versions()
    operational = [v for v in versions if v["operational"]]
    if not operational:
        return "No operational vLLM installation found"

    covered = set()
    for v in operational:
        py = Path(v["path"]) / "bin" / "python"
        try:
            result = subprocess.run(
                [str(py), "-c",
                 "from vllm.model_executor.models import ModelRegistry; "
                 "import json; print(json.dumps(list(ModelRegistry.get_supported_archs())))"],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                covered.update(json.loads(result.stdout.strip()))
        except Exception:
            pass

    missing = COMMON_ARCHITECTURES - covered
    coverage_pct = round((len(COMMON_ARCHITECTURES - missing) / len(COMMON_ARCHITECTURES)) * 100)

    if coverage_pct < 70:
        return (
            f"Your vLLM installation covers ~{coverage_pct}% of common model architectures. "
            f"Installing additional versions would give access to more models."
        )
    return None


async def install_version_stream(version: str) -> AsyncGenerator[str, None]:
    """
    Install a vLLM version in an isolated venv, streaming SSE log lines.
    Yields lines prefixed with 'data: ' for SSE consumption.
    """
    venv_dir = _venv_path(version)

    def _sse(msg: str, level: str = "info") -> str:
        return f"data: {json.dumps({'level': level, 'msg': msg, 'ts': time.time()})}\n\n"

    yield _sse(f"Starting vLLM {version} installation...")
    yield _sse(f"Target: {venv_dir}")

    if venv_dir.exists():
        yield _sse(f"Removing existing incomplete installation at {venv_dir}", "warn")
        shutil.rmtree(venv_dir)

    # Step 1: create venv
    yield _sse("Creating isolated Python environment...")
    proc = await asyncio.create_subprocess_exec(
        "python3", "-m", "venv", str(venv_dir),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    async for line in proc.stdout:
        yield _sse(line.decode().rstrip())
    await proc.wait()
    if proc.returncode != 0:
        yield _sse("Failed to create venv", "error")
        yield "data: {\"done\": true, \"success\": false}\n\n"
        return

    pip = venv_dir / "bin" / "pip"
    py = venv_dir / "bin" / "python"

    # Step 2: upgrade pip
    yield _sse("Upgrading pip...")
    proc = await asyncio.create_subprocess_exec(
        str(pip), "install", "--upgrade", "pip", "--quiet",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    async for line in proc.stdout:
        yield _sse(line.decode().rstrip())
    await proc.wait()

    # Step 3: install vLLM
    yield _sse(f"Installing vLLM {version} — this may take 10–30 minutes...")
    yield _sse("(downloading packages, compiling CUDA extensions if needed)")
    proc = await asyncio.create_subprocess_exec(
        str(pip), "install", f"vllm=={version}", "--no-cache-dir",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    async for line in proc.stdout:
        decoded = line.decode().rstrip()
        if decoded:
            yield _sse(decoded)
    await proc.wait()

    if proc.returncode != 0:
        yield _sse(f"pip install failed (exit code {proc.returncode})", "error")
        shutil.rmtree(venv_dir, ignore_errors=True)
        yield "data: {\"done\": true, \"success\": false}\n\n"
        return

    # Step 4: validate
    yield _sse("Validating installation...")
    result = await asyncio.create_subprocess_exec(
        str(py), "-c",
        "from vllm.model_executor.models import ModelRegistry; "
        "archs = ModelRegistry.get_supported_archs(); "
        f"print(f'OK — {{len(archs)}} architectures supported')",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    stdout, _ = await result.communicate()
    output = stdout.decode().strip()

    if result.returncode == 0:
        yield _sse(output, "ok")
        size_gb = _dir_size_gb(venv_dir)
        yield _sse(f"Installation complete — {size_gb} GB on disk", "ok")
        yield f"data: {{\"done\": true, \"success\": true, \"version\": \"{version}\", \"size_gb\": {size_gb}}}\n\n"
    else:
        yield _sse(f"Validation failed: {output}", "error")
        shutil.rmtree(venv_dir, ignore_errors=True)
        yield "data: {\"done\": true, \"success\": false}\n\n"
