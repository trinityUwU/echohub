"""Fine-tuning API router."""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.services import db
from backend.services import finetune_service as ft

router = APIRouter(prefix="/finetune", tags=["finetune"])


# ── Schemas ────────────────────────────────────────────────────────────────

class TrainingPairCreate(BaseModel):
    prompt: str
    chosen: str
    rejected: str
    source_conv_id: Optional[str] = None
    source_msg_id: Optional[str] = None
    model_id: Optional[str] = None
    profile_id: Optional[str] = None


class FinetuneJobCreate(BaseModel):
    model_id: str
    model_path: Optional[str] = None  # resolved from local path if omitted
    lora_rank: int = 16
    lora_alpha: int = 16
    target_modules: list[str] = ["q_proj", "v_proj", "k_proj", "o_proj"]
    num_epochs: int = 3
    learning_rate: float = 2e-4
    pair_ids: Optional[list[str]] = None  # None = use all pairs
    profile_id: Optional[str] = None
    max_seq_length: int = 512
    per_device_train_batch_size: int = 1
    gradient_accumulation_steps: int = 8
    optim: str = "adamw_8bit"
    cpu_offload_gb: int = 0


class FinetuneProfileCreate(BaseModel):
    name: str
    description: str = ""
    domain: str = "general"
    target_pairs: int = 100
    color: str = "#6366f1"


class EvalRequest(BaseModel):
    profile_id: str
    job_id: Optional[str] = None
    stage: str  # "before" | "after"
    model_id: str
    # model_path MUST be a GGUF file — BF16 is forbidden for eval
    model_path: str


class EvalResultItem(BaseModel):
    prompt_id: str
    prompt: str
    response: str
    score: Optional[float] = None


class EvalSubmit(BaseModel):
    profile_id: str
    job_id: Optional[str] = None
    stage: str
    model_id: str
    model_path: str
    results: list[EvalResultItem]


# ── Training pairs ─────────────────────────────────────────────────────────

@router.get("/pairs")
def list_pairs() -> list[dict]:
    return db.get_training_pairs()


@router.post("/pairs")
def create_pair(body: TrainingPairCreate) -> dict:
    return db.create_training_pair(
        id=str(uuid.uuid4()),
        prompt=body.prompt,
        chosen=body.chosen,
        rejected=body.rejected,
        source_conv_id=body.source_conv_id,
        source_msg_id=body.source_msg_id,
        model_id=body.model_id,
        profile_id=body.profile_id,
    )


@router.delete("/pairs/{pair_id}")
def delete_pair(pair_id: str) -> dict:
    ok = db.delete_training_pair(pair_id)
    if not ok:
        raise HTTPException(404, "Pair not found")
    return {"status": "deleted"}


# ── Profiles ──────────────────────────────────────────────────────────────

@router.get("/profiles")
def list_profiles() -> list[dict]:
    profiles = db.get_finetune_profiles()
    counts = db.get_profile_pair_counts()
    for p in profiles:
        p["pair_count"] = counts.get(p["id"], 0)
    return profiles


@router.post("/profiles")
def create_profile(body: FinetuneProfileCreate) -> dict:
    return db.create_finetune_profile(
        id=str(uuid.uuid4()),
        name=body.name, description=body.description,
        domain=body.domain, target_pairs=body.target_pairs, color=body.color,
    )


@router.delete("/profiles/{profile_id}")
def delete_profile(profile_id: str) -> dict:
    ok = db.delete_finetune_profile(profile_id)
    if not ok:
        raise HTTPException(404, "Profile not found or builtin")
    return {"status": "deleted"}


@router.get("/profiles/{profile_id}/pairs")
def list_profile_pairs(profile_id: str) -> list[dict]:
    return db.get_training_pairs_for_profile(profile_id)


# ── Evals ─────────────────────────────────────────────────────────────────

@router.post("/evals")
def create_eval(body: EvalRequest) -> dict:
    if not body.model_path.endswith(".gguf"):
        raise HTTPException(400, "Eval must use a GGUF model. BF16 is not allowed for evaluation.")

    profile = db.get_finetune_profile(body.profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")

    pairs = db.get_training_pairs_for_profile(body.profile_id)
    if not pairs:
        raise HTTPException(400, "No pairs in this profile")

    eval_pairs = pairs[:20]

    return {
        "eval_id": str(uuid.uuid4()),
        "profile_id": body.profile_id,
        "stage": body.stage,
        "model_id": body.model_id,
        "prompt_count": len(eval_pairs),
        "prompts": [{"id": p["id"], "prompt": p["prompt"]} for p in eval_pairs],
        "status": "ready",
        "note": "Run these prompts against the loaded model, then POST results to /finetune/evals/submit",
    }


@router.post("/evals/submit")
def submit_eval(body: EvalSubmit) -> dict:
    if not body.model_path.endswith(".gguf"):
        raise HTTPException(400, "Eval must use a GGUF model.")

    from backend.services.quality_scorer import score_general
    results_with_scores = []
    for r in body.results:
        auto_score = r.score
        if auto_score is None:
            try:
                scored = score_general(r.prompt, r.response)
                auto_score = scored.get("score") if isinstance(scored, dict) else float(scored)
            except Exception:
                auto_score = None
        results_with_scores.append({
            "prompt_id": r.prompt_id,
            "prompt": r.prompt,
            "response": r.response,
            "score": auto_score,
        })

    valid_scores = [r["score"] for r in results_with_scores if r["score"] is not None]
    score_avg = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else None

    eval_record = db.create_finetune_eval(
        id=str(uuid.uuid4()),
        job_id=body.job_id,
        profile_id=body.profile_id,
        stage=body.stage,
        model_path=body.model_path,
        model_id=body.model_id,
        results=results_with_scores,
        score_avg=score_avg,
    )
    return eval_record


@router.get("/evals")
def list_evals(job_id: Optional[str] = None, profile_id: Optional[str] = None) -> list[dict]:
    return db.get_finetune_evals(job_id=job_id, profile_id=profile_id)


# ── Status ─────────────────────────────────────────────────────────────────

@router.get("/status")
def get_status() -> dict:
    return {
        "unsloth_available": ft.is_unsloth_available(),
        "unsloth_venv": str(ft.get_unsloth_python()),
        "pair_count": db.get_training_pair_count(),
    }


# ── Install Unsloth ────────────────────────────────────────────────────────

@router.get("/install/stream")
async def install_stream() -> StreamingResponse:
    return StreamingResponse(
        ft.install_unsloth_sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Fine-tune jobs ─────────────────────────────────────────────────────────

@router.get("/jobs")
def list_jobs() -> list[dict]:
    return db.get_finetune_jobs()


@router.post("/jobs")
def create_job(body: FinetuneJobCreate) -> dict:
    from backend.services.hf_service import _model_dir, _is_downloaded
    job_id = str(uuid.uuid4())
    config = body.model_dump()
    # Resolve local path — required for Unsloth
    if _is_downloaded(body.model_id):
        config["model_path"] = str(_model_dir(body.model_id))
    elif not config.get("model_path"):
        # Fallback: use HF model ID directly (Unsloth will download it)
        config["model_path"] = body.model_id
    return db.create_finetune_job(job_id, body.model_id, config)


@router.get("/jobs/{job_id}/logs")
def get_job_logs(job_id: str) -> dict:
    """Return persisted training logs from disk."""
    from backend.services.user_data import get_user_data_dir
    log_path = get_user_data_dir() / "finetune" / job_id / "train.log"
    if not log_path.exists():
        return {"lines": [], "exists": False}
    try:
        lines = log_path.read_text(errors="replace").splitlines()
        return {"lines": lines, "exists": True}
    except Exception:
        return {"lines": [], "exists": False}


@router.post("/jobs/{job_id}/recover")
def recover_job(job_id: str) -> dict:
    """Mark a failed job as done if the LoRA output was actually saved."""
    from backend.services.user_data import get_user_data_dir
    lora_path = get_user_data_dir() / "finetune" / job_id / "lora" / "adapter_config.json"
    if not lora_path.exists():
        raise HTTPException(400, "LoRA output not found — training did not complete")
    output_dir = str(get_user_data_dir() / "finetune" / job_id)
    db.update_finetune_job(job_id, status="done", output_path=output_dir)
    return {"status": "recovered", "output_dir": output_dir}


@router.delete("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    job = db.get_finetune_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] not in ("pending", "running"):
        return {"cancelled": False, "reason": "already_terminal"}
    # Kill process if running, then always mark cancelled in DB
    ft.cancel_finetune(job_id)
    db.update_finetune_job(job_id, status="cancelled")
    return {"cancelled": True}


@router.get("/jobs/{job_id}/stream")
async def run_job_stream(job_id: str) -> StreamingResponse:
    job = db.get_finetune_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    # Jobs in terminal state — stream status only, don't relaunch
    if job["status"] in ("cancelled", "done", "error"):
        status = job["status"]
        error  = job.get("error") or ""
        async def _terminal():
            msg = f"Job already {status}" + (f": {error}" if error else "")
            yield f"data: {json.dumps({'type': 'error' if status != 'done' else 'done', 'text': msg})}\n\n"
        return StreamingResponse(_terminal(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # Job running but NOT in active_jobs → backend restarted mid-training, status stale
    # Mark as error rather than relaunching (would OOM since no VRAM freed)
    if job["status"] == "running" and job_id not in ft._active_jobs:
        db.update_finetune_job(job_id, status="error", error="Backend restarted during training — relaunch the job")
        async def _stale():
            yield f"data: {json.dumps({'type': 'error', 'text': 'Backend restarted during training. Please relaunch the job.'})}\n\n"
        return StreamingResponse(_stale(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # Job already running in an active process — don't start a second
    if job["status"] == "running" and job_id in ft._active_jobs:
        async def _already_running():
            yield f"data: {json.dumps({'type': 'log', 'text': 'Already running…'})}\n\n"
            await asyncio.sleep(60)
        return StreamingResponse(_already_running(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # Unload any loaded inference model to free VRAM before training
    try:
        from backend.services.engine_router import unload_model as _unload_model
        _unload_model()
    except Exception:
        pass

    cfg = job["config"]

    profile_id = cfg.get("profile_id")
    if profile_id:
        all_pairs = db.get_training_pairs_for_profile(profile_id)
    else:
        all_pairs = db.get_training_pairs()

    pair_ids = cfg.get("pair_ids")
    pairs = [p for p in all_pairs if p["id"] in set(pair_ids)] if pair_ids else all_pairs

    if not pairs:
        async def _no_pairs():
            db.update_finetune_job(job_id, status="error", error="No training pairs — add pairs in the Pairs tab first")
            yield f"data: {json.dumps({'type': 'error', 'text': 'No training pairs available. Go to Pairs tab and add some first.'})}\n\n"
        return StreamingResponse(_no_pairs(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    def on_status(status: str, output_path: str | None) -> None:
        db.update_finetune_job(job_id, status=status, output_path=output_path)

    gen = ft.run_finetune_sse(
        job_id=job_id,
        model_path=cfg["model_path"],
        pairs=pairs,
        lora_rank=cfg.get("lora_rank", 16),
        lora_alpha=cfg.get("lora_alpha", 16),
        target_modules=cfg.get("target_modules", ["q_proj", "v_proj"]),
        num_epochs=cfg.get("num_epochs", 3),
        learning_rate=cfg.get("learning_rate", 2e-4),
        on_status=on_status,
        max_seq_length=cfg.get("max_seq_length", 512),
        per_device_train_batch_size=cfg.get("per_device_train_batch_size", 1),
        gradient_accumulation_steps=cfg.get("gradient_accumulation_steps", 8),
        optim=cfg.get("optim", "adamw_8bit"),
        cpu_offload_gb=cfg.get("cpu_offload_gb", 0),
    )
    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Export GGUF ────────────────────────────────────────────────────────────

@router.get("/jobs/{job_id}/export/stream")
async def export_job_stream(job_id: str) -> StreamingResponse:
    job = db.get_finetune_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "done":
        raise HTTPException(400, "Job not completed")

    from backend.services.user_data import get_user_data_dir
    lora_path = str(get_user_data_dir() / "finetune" / job_id / "lora")

    def on_done(gguf_path: str) -> None:
        db.update_finetune_job(job_id, output_path=gguf_path)

    return StreamingResponse(
        ft.export_gguf_sse(job_id=job_id, lora_path=lora_path, on_done=on_done),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── VRAM estimation ────────────────────────────────────────────────────────

@router.get("/vram-estimate")
def vram_estimate(params_billion: float) -> dict:
    return {"vram_gb": ft.estimate_qlora_vram_gb(params_billion)}


# ── Recommended config ──────────────────────────────────────────────────────

def _build_rationale(gpu_name: str, vram_gb: float, max_seq_length: int, lora_rank: int) -> str:
    if vram_gb == 0:
        return "No GPU detected — CPU training will be very slow. Reduce dataset size."
    parts = [f"{gpu_name} ({vram_gb:.0f} GB VRAM)"]
    parts.append(f"seq_length={max_seq_length} to fit activations in VRAM")
    parts.append(f"rank={lora_rank} for quality/memory balance")
    return " · ".join(parts)


def _params_for_vram(vram_gb: float) -> tuple[int, int, int, int]:
    """Return (max_seq_length, batch_size, grad_accum, lora_rank) for a given VRAM budget."""
    if vram_gb >= 24:
        return 2048, 2, 4, 32
    if vram_gb >= 16:
        return 1024, 1, 8, 16
    if vram_gb >= 12:
        return 512, 1, 8, 16
    if vram_gb >= 8:
        return 256, 1, 16, 8
    return 256, 1, 16, 8


@router.get("/recommended-config")
def get_recommended_config(params_billion: float = 0.0) -> dict:
    """Return optimal training params based on detected hardware."""
    from backend.services.gpu_service import get_gpu_stats
    try:
        gpu = get_gpu_stats()
        vram_gb = gpu.vram_total_mb / 1024
        gpu_name = gpu.name
        ram_total_gb = round(gpu.cpu.ram_total_gb, 1) if gpu.cpu else 0.0
        ram_free_gb  = round(gpu.cpu.ram_total_gb - gpu.cpu.ram_used_gb, 1) if gpu.cpu else 0.0
    except Exception:
        vram_gb = 0.0
        gpu_name = "Unknown"
        ram_total_gb = 0.0
        ram_free_gb  = 0.0

    has_gpu = vram_gb > 0
    max_seq_length, per_device_batch_size, gradient_accumulation, lora_rank = _params_for_vram(vram_gb)
    vram_budget_gb = max(vram_gb * 0.85, 4.0) if has_gpu else 0.0
    qlora_vram = ft.estimate_qlora_vram_gb(params_billion) if params_billion > 0 else None
    fits = (qlora_vram is not None and qlora_vram <= vram_budget_gb) if has_gpu else False

    return {
        "gpu_name": gpu_name,
        "vram_total_gb": round(vram_gb, 1),
        "ram_total_gb": ram_total_gb,
        "ram_free_gb": ram_free_gb,
        "has_gpu": has_gpu,
        "qlora_vram_estimate_gb": qlora_vram,
        "model_fits": fits,
        "recommended": {
            "max_seq_length": max_seq_length,
            "per_device_train_batch_size": per_device_batch_size,
            "gradient_accumulation_steps": gradient_accumulation,
            "lora_rank": lora_rank,
            "lora_alpha": lora_rank,
            "num_epochs": 3,
            "learning_rate": 2e-4,
            "optim": "adamw_8bit",
            "target_modules": ["q_proj", "v_proj", "k_proj", "o_proj"],
            "cpu_offload_gb": 0,
        },
        "rationale": _build_rationale(gpu_name, vram_gb, max_seq_length, lora_rank),
    }
