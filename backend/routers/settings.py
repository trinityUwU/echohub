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
    from backend.services.config_service import get_inference_settings, detect_gpu_info
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
