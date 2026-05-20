import json
import os
import platform
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from loguru import logger

router = APIRouter(prefix="/settings", tags=["settings"])

_ENV_FILE = Path(__file__).parent.parent.parent / ".env"


def _update_env_file(key: str, value: str) -> None:
    """Update or insert KEY=value in the .env file."""
    lines: list[str] = []
    if _ENV_FILE.exists():
        lines = _ENV_FILE.read_text(encoding="utf-8").splitlines()

    found = False
    for i, line in enumerate(lines):
        if line.startswith(f"{key}=") or line.startswith(f"{key} ="):
            lines[i] = f"{key}={value}" if value else f"# {key}="
            found = True
            break

    if not found:
        if value:
            lines.append(f"{key}={value}")

    _ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


@router.post("/hf-token")
def set_hf_token(req: dict) -> dict:
    """Met à jour HF_TOKEN dans l'environnement runtime + fichier .env"""
    token: str = req.get("token", "").strip()

    if token and not token.startswith("hf_"):
        raise HTTPException(status_code=400, detail="Token invalide : doit commencer par 'hf_' ou être vide.")

    if token:
        os.environ["HF_TOKEN"] = token
        logger.info("HF_TOKEN updated in runtime environment")
    else:
        os.environ.pop("HF_TOKEN", None)
        logger.info("HF_TOKEN removed from runtime environment")

    try:
        _update_env_file("HF_TOKEN", token)
    except Exception as e:
        logger.warning(f"Could not update .env file: {e}")

    return {"status": "ok", "token_set": bool(token)}


@router.get("/hf-token")
def get_hf_token() -> dict:
    """Retourne si un token est configuré (pas le token lui-même)."""
    token = os.getenv("HF_TOKEN", "")
    preview = f"hf_...{token[-4:]}" if len(token) > 8 else ""
    return {"token_set": bool(token), "token_preview": preview}


def _detect_gpu_backend() -> dict:
    """
    Détecte le backend GPU disponible pour llama-cpp-python.
    Retourne : { "backend": "cuda"|"rocm"|"metal"|"cpu", "gpu_name": str|null, "cuda_available": bool }
    """
    sys = platform.system()

    # Mac → Metal natif, toujours OK
    if sys == "Darwin":
        return {"backend": "metal", "gpu_name": "Apple Silicon", "cuda_available": True}

    # Vérifier si llama-cpp-python est compilé avec CUDA
    try:
        import llama_cpp
        lib_dir = Path(llama_cpp.__file__).parent / "lib"
        libs = list(lib_dir.iterdir()) if lib_dir.exists() else []
        has_cuda_lib = any("cuda" in f.name.lower() or "cublas" in f.name.lower() for f in libs)
    except Exception:
        has_cuda_lib = False

    # Détecter GPU NVIDIA
    nvidia_name = None
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0:
            nvidia_name = r.stdout.strip().split("\n")[0]
    except Exception:
        pass

    # Détecter AMD ROCm
    amd_name = None
    try:
        r = subprocess.run(["rocm-smi", "--showproductname"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            amd_name = "AMD GPU"
    except Exception:
        pass

    if nvidia_name:
        if has_cuda_lib:
            return {"backend": "cuda", "gpu_name": nvidia_name, "cuda_available": True}
        else:
            return {"backend": "cpu", "gpu_name": nvidia_name, "cuda_available": False,
                    "reason": "llama-cpp-python built without CUDA support"}

    if amd_name:
        if has_cuda_lib:
            return {"backend": "rocm", "gpu_name": amd_name, "cuda_available": True}
        else:
            return {"backend": "cpu", "gpu_name": amd_name, "cuda_available": False,
                    "reason": "llama-cpp-python built without ROCm support"}

    return {"backend": "cpu", "gpu_name": None, "cuda_available": False, "reason": "No GPU detected"}


@router.get("/gpu-backend")
def get_gpu_backend() -> dict:
    """Retourne le backend GPU actif pour llama-cpp-python."""
    return _detect_gpu_backend()


# ── vLLM Engine Management ─────────────────────────────────────────────────

from backend.services import vllm_manager

@router.get("/engines")
def list_engines() -> dict:
    """List all installed vLLM versions with metadata."""
    versions = vllm_manager.list_versions()
    warning = vllm_manager.get_coverage_warning()
    return {
        "versions": versions,
        "coverage_warning": warning,
        "total_versions": len(versions),
        "operational_count": sum(1 for v in versions if v["operational"]),
    }


@router.delete("/engines/{version:path}")
def delete_engine(version: str) -> dict:
    ok, reason = vllm_manager.can_delete(version)
    if not ok:
        raise HTTPException(status_code=409, detail=reason)
    try:
        vllm_manager.delete_version(version)
        return {"status": "deleted", "version": version}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/engines/install/{version:path}")
async def install_engine_stream(version: str):
    """SSE stream for vLLM installation progress."""
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        vllm_manager.install_version_stream(version),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Path Configuration ────────────────────────────────────────────────────

from backend.services import config_service, migration_service
from fastapi.responses import StreamingResponse as _SSEResponse

@router.get("/paths")
def get_paths() -> dict:
    return config_service.get_all_paths()


@router.post("/paths/models-dir")
def set_models_dir(body: dict) -> dict:
    new_path = body.get("path", "").strip()
    if not new_path:
        raise HTTPException(status_code=400, detail="path is required")
    current = config_service.get_models_dir()
    new = Path(new_path).expanduser().resolve()
    if current == new:
        return {"status": "unchanged", "path": str(new)}
    # Create migration job
    state = migration_service.create_migration("models", str(current), str(new))
    return {"status": "migration_pending", "source": str(current), "destination": str(new), "state": state}


@router.post("/paths/vllm-envs-dir")
def set_vllm_envs_dir(body: dict) -> dict:
    new_path = body.get("path", "").strip()
    if not new_path:
        raise HTTPException(status_code=400, detail="path is required")
    current = config_service.get_vllm_envs_dir()
    new = Path(new_path).expanduser().resolve()
    if current == new:
        return {"status": "unchanged", "path": str(new)}
    state = migration_service.create_migration("vllm_envs", str(current), str(new))
    return {"status": "migration_pending", "source": str(current), "destination": str(new), "state": state}


@router.get("/paths/migration-state")
def get_migration_state() -> dict:
    state = migration_service.get_pending_migration()
    return state or {"status": "idle"}


@router.post("/paths/migration-cancel")
def cancel_migration() -> dict:
    migration_service.cancel_migration()
    return {"status": "cancelled"}


@router.get("/paths/migrate")
async def run_migration():
    """SSE stream for migration execution."""
    return _SSEResponse(
        migration_service.run_migration_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/paths/migration-cleanup")
def cleanup_migration() -> dict:
    migration_service.cleanup_completed()
    return {"status": "cleaned"}


# ── Inference settings ─────────────────────────────────────────────────────

@router.get("/inference")
def get_inference_settings() -> dict:
    from backend.services.config_service import get_inference_settings
    settings = get_inference_settings()
    try:
        gpu = _get_gpu_info()
    except Exception:
        gpu = {"name": "Unknown", "vram_gb": 0, "type": "cpu"}
    return {**settings, "gpu": gpu}


@router.post("/inference/{key}")
def set_inference_setting(key: str, body: dict) -> dict:
    from backend.services.config_service import set_inference_setting
    value = body.get("value")
    if value is None:
        raise HTTPException(status_code=400, detail="value required")
    try:
        set_inference_setting(key, value)
        return {"status": "ok", "key": key, "value": value}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _get_gpu_info() -> dict:
    import subprocess
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
        capture_output=True, text=True, timeout=5
    )
    if result.returncode == 0:
        parts = result.stdout.strip().split(", ")
        return {"name": parts[0], "vram_gb": round(int(parts[1]) / 1024, 1), "type": "nvidia"}
    return {"name": "No GPU", "vram_gb": 0, "type": "cpu"}


# ── Onboarding ─────────────────────────────────────────────────────────────

@router.get("/onboarding")
def get_onboarding_status() -> dict:
    from backend.services.db import get_app_state
    done = get_app_state("onboarding_complete") == "true"
    return {"complete": done}


@router.post("/onboarding/complete")
def complete_onboarding() -> dict:
    from backend.services.db import set_app_state
    set_app_state("onboarding_complete", "true")
    return {"status": "ok"}


@router.post("/onboarding/reset")
def reset_onboarding() -> dict:
    from backend.services.db import set_app_state
    set_app_state("onboarding_complete", "false")
    return {"status": "reset"}


@router.post("/github-token")
def set_github_token(req: dict) -> dict:
    token: str = req.get("token", "").strip()
    if token:
        os.environ["GITHUB_TOKEN"] = token
    else:
        os.environ.pop("GITHUB_TOKEN", None)
    try:
        _update_env_file("GITHUB_TOKEN", token)
    except Exception as e:
        logger.warning(f"Could not update .env file: {e}")
    return {"status": "ok", "token_set": bool(token)}


@router.get("/github-token")
def get_github_token() -> dict:
    token = os.getenv("GITHUB_TOKEN", "")
    preview = f"ghp_...{token[-4:]}" if len(token) > 8 else ""
    return {"token_set": bool(token), "token_preview": preview}


@router.post("/hf-token/validate")
def validate_hf_token() -> dict:
    """Test the current HF token against the HF API."""
    import httpx
    token = os.getenv("HF_TOKEN", "")
    if not token:
        return {"valid": False, "reason": "No token set", "username": None}
    try:
        r = httpx.get(
            "https://huggingface.co/api/whoami-v2",
            headers={"Authorization": f"Bearer {token}"},
            timeout=8,
        )
        if r.status_code == 200:
            data = r.json()
            return {"valid": True, "reason": None, "username": data.get("name")}
        elif r.status_code == 401:
            return {"valid": False, "reason": "Invalid token — check your HuggingFace account", "username": None}
        else:
            return {"valid": False, "reason": f"HF API returned {r.status_code}", "username": None}
    except Exception as e:
        return {"valid": False, "reason": f"Network error: {e}", "username": None}


# ── Update system ──────────────────────────────────────────────────────────

import subprocess as _sp
from pathlib import Path as _P

_APP_ROOT = _P(__file__).resolve().parents[2]


@router.get("/update/check")
def check_for_updates() -> dict:
    """Check if the local git repo is behind origin/master."""
    try:
        _sp.run(["git", "fetch", "origin"], cwd=str(_APP_ROOT), capture_output=True, timeout=8)
        result = _sp.run(
            ["git", "rev-list", "HEAD..origin/master", "--count"],
            cwd=str(_APP_ROOT), capture_output=True, text=True, timeout=10
        )
        commits_behind = int(result.stdout.strip() or "0")

        local = _sp.run(["git", "rev-parse", "--short", "HEAD"],
                        cwd=str(_APP_ROOT), capture_output=True, text=True).stdout.strip()
        remote = _sp.run(["git", "rev-parse", "--short", "origin/master"],
                         cwd=str(_APP_ROOT), capture_output=True, text=True).stdout.strip()

        # Get latest commit message from origin
        log = _sp.run(
            ["git", "log", "HEAD..origin/master", "--oneline", "--no-merges", "-20"],
            cwd=str(_APP_ROOT), capture_output=True, text=True
        ).stdout.strip()

        return {
            "up_to_date": commits_behind == 0,
            "commits_behind": commits_behind,
            "local_sha": local,
            "remote_sha": remote,
            "changelog": log.splitlines() if log else [],
        }
    except Exception as e:
        return {"error": str(e), "up_to_date": True, "commits_behind": 0, "changelog": []}


@router.get("/update/run")
async def run_update():
    """SSE stream for git pull + rebuild notification."""
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        _update_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _update_stream():
    import asyncio, json, time

    def sse(msg: str, level: str = "info") -> str:
        return f"data: {json.dumps({'level': level, 'msg': msg, 'ts': time.time()})}\n\n"

    yield sse("Pulling latest changes from GitHub…", "step")

    proc = await asyncio.create_subprocess_exec(
        "git", "pull", "--ff-only", "origin", "master",
        cwd=str(_APP_ROOT),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**__import__("os").environ, "GIT_TERMINAL_PROMPT": "0"},
    )
    try:
        async for line in proc.stdout:
            decoded = line.decode().rstrip()
            if decoded:
                yield sse(decoded)
        rc = await asyncio.wait_for(proc.wait(), timeout=60)
    except asyncio.TimeoutError:
        proc.kill()
        yield sse("git pull timed out after 60s — check your connection.", "error")
        yield f"data: {json.dumps({'done': True, 'success': False})}\n\n"
        return

    if rc != 0:
        yield sse("git pull failed — check your connection or resolve conflicts manually.", "error")
        yield f"data: {json.dumps({'done': True, 'success': False})}\n\n"
        return

    yield sse("Update downloaded successfully", "ok")

    # Get what changed
    log = _sp.run(
        ["git", "log", "-5", "--oneline", "--no-merges"],
        cwd=str(_APP_ROOT), capture_output=True, text=True
    ).stdout.strip()
    if log:
        yield sse("Recent changes:", "step")
        for line in log.splitlines():
            yield sse(f"  {line}")

    yield sse("Ready to restart — click Restart now to apply the update.", "ok")
    yield f"data: {json.dumps({'done': True, 'success': True})}\n\n"


@router.post("/update/save-changelog")
def save_changelog(body: dict) -> dict:
    """Persist changelog to show on next launch."""
    from backend.services.db import set_app_state
    changelog = body.get("changelog", [])
    set_app_state("pending_changelog", json.dumps(changelog))
    return {"status": "ok"}


@router.get("/update/pending-changelog")
def get_pending_changelog() -> dict:
    from backend.services.db import get_app_state
    raw = get_app_state("pending_changelog")
    if not raw:
        return {"changelog": []}
    try:
        return {"changelog": json.loads(raw)}
    except Exception:
        return {"changelog": []}


@router.post("/update/clear-changelog")
def clear_changelog() -> dict:
    from backend.services.db import set_app_state
    set_app_state("pending_changelog", "")
    return {"status": "ok"}


# ── Benchmarks persistence ──────────────────────────────────────────────────

@router.get("/benchmarks")
def list_benchmarks(archived: int = 0) -> list:
    from backend.services.db import get_benchmarks
    return get_benchmarks(100, include_archived=bool(archived))


@router.post("/benchmarks")
def store_benchmark(body: dict) -> dict:
    from backend.services.db import save_benchmark
    bench_id = save_benchmark(body)
    return {"id": bench_id, "status": "saved"}


@router.delete("/benchmarks/{bench_id}")
def remove_benchmark(bench_id: int) -> dict:
    from backend.services.db import delete_benchmark
    delete_benchmark(bench_id)
    return {"status": "deleted"}


@router.delete("/benchmarks")
def wipe_benchmarks() -> dict:
    from backend.services.db import clear_benchmarks
    clear_benchmarks()
    return {"status": "cleared"}


# ── Benchmark Profiles ──────────────────────────────────────────────────────

@router.get("/benchmark-profiles")
def list_benchmark_profiles() -> list:
    from backend.services.db import get_benchmark_profiles
    return get_benchmark_profiles()


@router.post("/benchmark-profiles")
def create_benchmark_profile(body: dict) -> dict:
    from backend.services.db import create_benchmark_profile as _create
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    return _create(
        name=name,
        description=body.get("description", ""),
        prompt=body.get("prompt", "").strip(),
        max_tokens=int(body.get("max_tokens", 200)),
        temperature=float(body.get("temperature", 0.0)),
    )


@router.delete("/benchmark-profiles/{profile_id}")
def delete_benchmark_profile(profile_id: int) -> dict:
    from backend.services.db import delete_benchmark_profile as _delete
    ok = _delete(profile_id)
    if not ok:
        raise HTTPException(status_code=403, detail="Cannot delete builtin profile or profile not found")
    return {"status": "deleted"}


@router.patch("/benchmarks/{bench_id}")
def patch_benchmark(bench_id: int, body: dict) -> dict:
    from backend.services.db import update_benchmark
    name = body.get("name")
    archived = body.get("archived")
    ok = update_benchmark(bench_id, name=name, archived=archived)
    if not ok:
        raise HTTPException(status_code=404, detail="Benchmark not found")
    return {"status": "updated"}
