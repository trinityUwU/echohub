import asyncio
import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from loguru import logger

from backend.models.schemas import DownloadRequest, ModelInfo
from backend.services import hf_service
from backend.services.hf_service import _get_hf_token
from huggingface_hub import model_info as hf_model_info
from backend.services import download_manager
from backend.services.download_manager import DownloadState

router = APIRouter(prefix="/models", tags=["models"])


@router.get("/search", response_model=list[ModelInfo])
def search_models(
    q: str = Query("", min_length=0),
    filters: Optional[str] = Query(None, description="Comma-separated: awq,gptq,gguf,vision,thinking"),
    page: int = Query(0, ge=0),
    page_size: int = Query(20, ge=5, le=50),
    sort: str = Query("downloads", description="downloads|likes|created_at"),
    sort_dir: str = Query("desc", description="asc|desc"),
) -> list[ModelInfo]:
    filter_list = [f.strip() for f in filters.split(",")] if filters else None
    try:
        return hf_service.search_models(q, filter_list, page=page, page_size=page_size, sort=sort, sort_dir=sort_dir)
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/downloaded", response_model=list[ModelInfo])
def list_downloaded() -> list[ModelInfo]:
    try:
        return hf_service.list_downloaded()
    except Exception as e:
        logger.error(f"list_downloaded failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/info/{model_id:path}", response_model=ModelInfo)
def get_model_info(model_id: str) -> ModelInfo:
    try:
        return hf_service.get_model_info(model_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/download")
def start_download(req: DownloadRequest) -> dict:
    """Start a download job. Returns immediately — poll /downloads for progress."""
    existing = download_manager.get_job(req.model_id)
    if existing and existing.state == DownloadState.RUNNING:
        return {"status": "already_running", "model_id": req.model_id}

    # Calculer la taille exacte — fichier GGUF spécifique ou somme des poids
    total_gb: Optional[float] = None
    try:
        info = hf_service._api.model_info(req.model_id, files_metadata=True)
        if info.siblings:
            if req.gguf_file:
                # Taille du fichier GGUF sélectionné uniquement
                for s in info.siblings:
                    if s.rfilename == req.gguf_file:
                        size = getattr(s, "size", 0) or 0
                        if size:
                            total_gb = round(size / (1024 ** 3), 2)
                        break
            else:
                # Snapshot complet — sommer les poids
                total_bytes = sum(
                    getattr(s, "size", 0) or 0
                    for s in info.siblings
                    if s.rfilename.endswith((".safetensors", ".bin", ".pt", ".gguf"))
                )
                if total_bytes:
                    total_gb = round(total_bytes / (1024 ** 3), 2)
    except Exception:
        pass

    download_manager.start_download(req.model_id, req.revision, total_gb, gguf_file=req.gguf_file)
    return {"status": "started", "model_id": req.model_id}


@router.delete("/download/{model_id:path}")
def cancel_download(model_id: str) -> dict:
    """Cancel and delete partial download."""
    ok = download_manager.cancel_download(model_id)
    if not ok:
        raise HTTPException(status_code=404, detail="No active download for this model")
    return {"status": "cancelled", "model_id": model_id}


@router.delete("/downloaded/{model_id:path}")
def delete_model(model_id: str) -> dict:
    """Permanently delete a downloaded model from disk."""
    import shutil
    dest = hf_service._model_dir(model_id)
    if not dest.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {model_id}")
    try:
        shutil.rmtree(dest)
        logger.info(f"Deleted model: {model_id} ({dest})")
        return {"status": "deleted", "model_id": model_id}
    except Exception as e:
        logger.error(f"delete_model failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/downloads")
def list_downloads() -> list[dict]:
    """Return all active/recent download jobs."""
    return download_manager.get_all_jobs()


@router.post("/check-access")
def check_access(req: dict) -> dict:
    """Vérifie si model_id est accessible avec le token actuel."""
    model_id: str = req.get("model_id", "")
    try:
        info = hf_model_info(model_id, token=_get_hf_token())
        return {"accessible": True, "gated": bool(getattr(info, "gated", False))}
    except Exception as e:
        err = str(e)
        if "401" in err or "403" in err:
            return {
                "accessible": False,
                "gated": True,
                "reason": "token_required",
                "hf_url": f"https://huggingface.co/{model_id}",
            }
        if "404" in err:
            return {"accessible": False, "gated": False, "reason": "not_found"}
        return {"accessible": False, "gated": False, "reason": err}


@router.get("/downloads/stream")
async def stream_downloads() -> StreamingResponse:
    """SSE stream of download progress. Client subscribes once, receives updates every second."""

    async def event_stream():
        try:
            while True:
                jobs = download_manager.get_all_jobs()
                payload = json.dumps(jobs)
                yield f"data: {payload}\n\n"
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/history")
def get_download_history() -> list[dict]:
    """Return persisted download history (survives restarts)."""
    from backend.services import db
    history = db.get_download_history()
    # Enrich: mark entries whose model files no longer exist on disk
    from backend.services.hf_service import _model_dir
    for entry in history:
        model_path = _model_dir(entry["model_id"])
        entry["files_exist"] = model_path.exists() and any(model_path.iterdir())
    return history


@router.delete("/history/{model_id:path}")
def delete_history_entry(model_id: str) -> dict:
    """Delete a history log entry (does NOT delete model files)."""
    from backend.services import db
    ok = db.delete_download_history_entry(model_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"status": "deleted", "model_id": model_id}


@router.get("/readme/{model_id:path}")
def get_model_readme(model_id: str) -> dict:
    """Return the full README.md for a model (fetches from HF cache or downloads)."""
    try:
        from huggingface_hub import hf_hub_download
        from pathlib import Path as _P
        readme_path = hf_hub_download(
            repo_id=model_id,
            filename="README.md",
            token=_get_hf_token(),
        )
        content = _P(readme_path).read_text(encoding="utf-8", errors="ignore")
        # Strip YAML front matter
        if content.startswith("---"):
            end = content.find("\n---", 3)
            if end != -1:
                content = content[end + 4:].lstrip("\n")
        return {"content": content}
    except Exception as e:
        return {"content": None, "error": str(e)}


@router.get("/compatibility/{model_id:path}")
def check_compatibility(model_id: str) -> dict:
    """
    Fetch config.json from HF and check architecture compatibility with vLLM + llama-cpp.
    Returns: { compatible_vllm, compatible_llama, architecture, quantization, issues, recommendation }
    """
    from huggingface_hub import hf_hub_download
    import json as _json
    from pathlib import Path as _P

    # Try local first, then HF
    from backend.services.config_service import get_models_dir as _gmd
    local_config = _gmd() / f"{model_id.replace('/', '--')}/config.json"
    try:
        if local_config.exists():
            config = _json.loads(local_config.read_text())
        else:
            cfg_path = hf_hub_download(repo_id=model_id, filename="config.json", token=_get_hf_token())
            config = _json.loads(_P(cfg_path).read_text())
    except Exception as e:
        return {"error": str(e), "compatible_vllm": None, "compatible_llama": None}

    architectures = config.get("architectures", [])
    quant_config = config.get("quantization_config", {})
    quant_method = quant_config.get("quant_method", "none")
    quant_bits = quant_config.get("bits")
    model_type = config.get("model_type", "")

    # Check vLLM support
    compatible_vllm = False
    vllm_issues = []
    try:
        from vllm.model_executor.models import ModelRegistry
        supported = ModelRegistry.get_supported_archs()
        arch_ok = any(a in supported for a in architectures)
        if not arch_ok:
            vllm_issues.append(f"Architecture {architectures} not supported by vLLM 0.21")
        else:
            compatible_vllm = True

        # Check AWQ + multimodal compatibility
        # vLLM 0.21 has issues with AWQ on multimodal architectures (vision+text)
        has_vision = "vision_config" in config or "ForConditionalGeneration" in str(architectures)
        if quant_method == "awq" and has_vision:
            vllm_issues.append(
                "AWQ quantization on multimodal (vision+text) model — "
                "vLLM 0.21 may fail with alignment errors on vision layers. "
                "This is a known vLLM limitation for this architecture."
            )
            compatible_vllm = False
    except Exception as e:
        vllm_issues.append(f"vLLM check failed: {e}")

    # Check llama-cpp support (GGUF only — can't load safetensors)
    compatible_llama = quant_method in ("gguf", "none") and not quant_method.startswith("awq")
    llama_issues = []
    if quant_method in ("awq", "gptq", "fp8"):
        compatible_llama = False
        llama_issues.append(f"{quant_method.upper()} format not supported by llama-cpp (GGUF only)")

    # Build recommendation
    if compatible_vllm:
        recommendation = "Compatible with vLLM — can be loaded directly"
    elif compatible_llama:
        recommendation = "Compatible with llama-cpp — use GGUF format"
    else:
        rec_parts = []
        if architectures:
            rec_parts.append(f"Search for a GGUF version of this model on HuggingFace")
        recommendation = ". ".join(rec_parts) if rec_parts else "No compatible engine found"

    return {
        "compatible_vllm": compatible_vllm,
        "compatible_llama": compatible_llama,
        "architecture": architectures[0] if architectures else model_type,
        "quantization": quant_method,
        "bits": quant_bits,
        "vllm_issues": vllm_issues,
        "llama_issues": llama_issues,
        "recommendation": recommendation,
        "vllm_version": "0.21.0",
        "installed_vllm_versions": _get_installed_vllm_versions(),
        "required_vllm_version": _get_required_vllm_version(architectures, quant_method, config),
    }


@router.get("/finetuned")
def list_finetuned_models() -> list[dict]:
    """Return GGUF models generated by the fine-tuning pipeline."""
    from backend.services.user_data import get_user_data_dir
    from pathlib import Path

    finetune_dir = get_user_data_dir() / "finetune"
    results = []

    if not finetune_dir.exists():
        return results

    for job_dir in finetune_dir.iterdir():
        if not job_dir.is_dir():
            continue
        gguf_export = job_dir / "gguf_export"
        if not gguf_export.exists():
            continue
        for gguf_file in gguf_export.glob("*.gguf"):
            if gguf_file.name.startswith("model-BF16"):
                continue  # skip intermediate
            job_id = job_dir.name
            try:
                from backend.services import db as _db
                job = _db.get_finetune_job(job_id)
                base_model_id = job.get("model_id", "") if job else ""
                model_name = f"{base_model_id.split('/')[-1] if base_model_id else job_id[:8]}-finetuned"
            except Exception:
                model_name = f"{job_id[:8]}-finetuned"
                base_model_id = ""

            size_gb = round(gguf_file.stat().st_size / 1024**3, 2)
            results.append({
                "id": f"finetuned/{job_id}/{gguf_file.name}",
                "name": model_name,
                "path": str(gguf_file),
                "size_gb": size_gb,
                "job_id": job_id,
                "base_model_id": base_model_id,
                "quantization": gguf_file.stem.split("-")[-1] if "-" in gguf_file.stem else "Q4_K_M",
                "downloaded": True,
                "loaded": False,
                "source": "finetuned",
                "created_at": gguf_file.stat().st_mtime,
            })

    results.sort(key=lambda x: x["created_at"], reverse=True)
    return results


@router.delete("/finetuned/{job_id}")
def delete_finetuned_model(job_id: str) -> dict:
    """Delete the gguf_export directory for a fine-tuned job."""
    import shutil
    from backend.services.user_data import get_user_data_dir
    gguf_dir = get_user_data_dir() / "finetune" / job_id / "gguf_export"
    if not gguf_dir.exists():
        raise HTTPException(status_code=404, detail="Fine-tuned model not found")
    try:
        shutil.rmtree(gguf_dir)
        logger.info(f"Deleted finetuned model gguf_export for job {job_id}")
        return {"status": "deleted", "job_id": job_id}
    except Exception as e:
        logger.error(f"delete_finetuned_model failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/llama-cpp/status")
def get_llama_cpp_status() -> dict:
    """Return llama-cpp-python installation status."""
    import sys
    import os

    try:
        import llama_cpp
        version = llama_cpp.__version__
        installed = True
    except ImportError:
        version = None
        installed = False

    cuda_enabled = False
    if installed:
        try:
            import llama_cpp as _lc
            lib_dir = os.path.join(os.path.dirname(_lc.__file__), "lib")
            cuda_enabled = any(
                "cuda" in f.lower()
                for f in os.listdir(lib_dir)
                if os.path.isfile(os.path.join(lib_dir, f))
            )
        except Exception:
            pass

    size_gb = 0.0
    if installed:
        try:
            import llama_cpp as _lc2
            from pathlib import Path as _P
            pkg_path = _P(_lc2.__file__).parent
            size_gb = round(
                sum(f.stat().st_size for f in pkg_path.rglob("*") if f.is_file()) / 1024 ** 3,
                2,
            )
        except Exception:
            pass

    return {
        "installed": installed,
        "version": version,
        "cuda_enabled": cuda_enabled,
        "size_gb": size_gb,
        "path": str(sys.executable),
    }


@router.get("/llama-compat-check")
def check_llama_compat(gguf_path: str) -> dict:
    """Try loading a GGUF to detect llama-cpp-python version incompatibility."""
    from pathlib import Path

    if not Path(gguf_path).exists():
        return {"compatible": False, "error": "File not found"}

    try:
        import llama_cpp
        llm = llama_cpp.Llama(
            model_path=gguf_path,
            n_ctx=128,
            n_gpu_layers=0,
            verbose=False,
        )
        del llm
        return {"compatible": True, "version": llama_cpp.__version__}
    except Exception as e:
        err = str(e)
        needs_upgrade = any(
            k in err.lower()
            for k in ["sampler", "attribute", "has no attribute", "failed to load"]
        )
        return {
            "compatible": False,
            "needs_upgrade": needs_upgrade,
            "error": err,
            "version": getattr(__import__("llama_cpp"), "__version__", "unknown"),
        }


@router.get("/llama-upgrade/stream")
async def upgrade_llama_cpp() -> StreamingResponse:
    """Upgrade llama-cpp-python in the backend venv via pip. SSE logs."""
    import asyncio
    import os
    import re
    import subprocess
    import sys

    async def _upgrade():
        py = sys.executable

        try:
            r = subprocess.run(["nvcc", "--version"], capture_output=True, text=True, timeout=5)
            m = re.search(r"release (\d+)\.(\d+)", r.stdout)
            cuda = f"{m.group(1)}.{m.group(2)}" if m else "cpu"
        except Exception:
            cuda = "cpu"

        yield f"data: {json.dumps({'type': 'log', 'text': f'Detected CUDA {cuda}'})}\n\n"

        if cuda.startswith("13") or cuda.startswith("12"):
            cuda_tag = (
                "cu130" if cuda.startswith("13")
                else "cu124" if cuda >= "12.4"
                else "cu121"
            )
            cmd = [
                py, "-m", "pip", "install", "llama-cpp-python",
                "--upgrade", "--force-reinstall", "--no-cache-dir",
                "--extra-index-url",
                f"https://abetlen.github.io/llama-cpp-python/whl/{cuda_tag}",
            ]
        else:
            env_extra: dict = {}
            if cuda != "cpu":
                env_extra = {"CMAKE_ARGS": "-DGGML_CUDA=on -DCMAKE_CUDA_ARCHITECTURES=86"}
            cmd = [
                py, "-m", "pip", "install", "llama-cpp-python",
                "--upgrade", "--force-reinstall", "--no-cache-dir",
            ]

        yield f"data: {json.dumps({'type': 'step', 'label': 'Upgrading llama-cpp-python (this may take 5-10 min if compiling)...'})}\n\n"

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "PYTHONUNBUFFERED": "1", **(env_extra if cuda != "cpu" else {})},
        )
        assert proc.stdout is not None
        async for line_b in proc.stdout:
            line = line_b.decode(errors="replace").rstrip()
            if line:
                yield f"data: {json.dumps({'type': 'log', 'text': line})}\n\n"
        await proc.wait()

        if proc.returncode == 0:
            yield f"data: {json.dumps({'type': 'done', 'text': 'llama-cpp-python upgraded successfully. Restart the app to apply.'})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'error', 'text': f'Upgrade failed (code {proc.returncode})'})}\n\n"

    return StreamingResponse(
        _upgrade(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _get_installed_vllm_versions() -> list[str]:
    try:
        from backend.services.vllm_manager import list_versions
        return [v["version"] for v in list_versions() if v["operational"]]
    except Exception:
        return []


def _get_required_vllm_version(architectures: list, quant_method: str, config: dict) -> str | None:
    """
    Return the minimum vLLM version string required for this model, or None if current is fine.
    Based on known compatibility matrix.
    """
    arch = (architectures or [""])[0]
    has_vision = "vision_config" in config or "ForConditionalGeneration" in arch

    # Models known to require newer vLLM
    NEW_ARCH_PATTERNS = {
        "Qwen3_5": "0.22.0",
        "Gemma3": "0.22.0",
        "LlamaForCausalLM4": "0.19.0",
    }
    for pattern, version in NEW_ARCH_PATTERNS.items():
        if pattern in arch:
            return version

    # AWQ on multimodal — current vLLM 0.21 has alignment issues
    if quant_method == "awq" and has_vision:
        return "future"  # no known working version for this combo

    return None  # current version is fine
