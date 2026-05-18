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
    eval_before: bool = False
    eval_after: bool = False
    eval_gguf_model_id: Optional[str] = None
    eval_gguf_file: Optional[str] = None


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


class EvalRunRequest(BaseModel):
    profile_id: str
    job_id: Optional[str] = None
    stage: str  # "before" | "after"
    gguf_model_id: str   # HF repo ID
    gguf_file: str       # filename dans le repo
    delete_after: bool = True


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

    # Auto-recover: if LoRA exists on disk but status is wrong, fix it first
    from backend.services.user_data import get_user_data_dir as _gud
    lora_check = _gud() / "finetune" / job_id / "lora" / "adapter_config.json"
    if lora_check.exists() and job["status"] != "done":
        output_dir = str(_gud() / "finetune" / job_id)
        db.update_finetune_job(job_id, status="done", output_path=output_dir)
        job = db.get_finetune_job(job_id)  # refresh

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

    return StreamingResponse(
        _full_pipeline(job_id=job_id, job=job, cfg=cfg, pairs=pairs),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _full_pipeline(job_id: str, job: dict, cfg: dict, pairs: list[dict]):
    """Orchestrates: eval_before → fine-tune → eval_after (with GGUF export)."""
    profile_id: Optional[str] = cfg.get("profile_id")
    eval_before: bool = cfg.get("eval_before", False)
    eval_after: bool = cfg.get("eval_after", False)
    eval_gguf_model_id: Optional[str] = cfg.get("eval_gguf_model_id")
    eval_gguf_file: Optional[str] = cfg.get("eval_gguf_file")

    # ── Step 1: eval before ────────────────────────────────────────────────
    if eval_before and eval_gguf_model_id and eval_gguf_file and profile_id:
        async for chunk in ft._eval_pipeline_sse(
            job_id=job_id,
            profile_id=profile_id,
            stage="before",
            gguf_model_id=eval_gguf_model_id,
            gguf_file=eval_gguf_file,
        ):
            yield chunk

    # ── Step 2: fine-tune ──────────────────────────────────────────────────
    lora_output_dir: Optional[str] = None

    def on_status(status: str, output_path: Optional[str]) -> None:
        nonlocal lora_output_dir
        db.update_finetune_job(job_id, status=status, output_path=output_path)
        if output_path:
            lora_output_dir = output_path

    async for chunk in ft.run_finetune_sse(
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
    ):
        yield chunk

    # Abort pipeline if fine-tune didn't succeed
    current_job = db.get_finetune_job(job_id)
    if not current_job or current_job["status"] != "done":
        return

    # ── Step 3: eval after ─────────────────────────────────────────────────
    if not (eval_after and lora_output_dir and profile_id and eval_gguf_model_id and eval_gguf_file):
        return

    # Export LoRA → GGUF first
    from pathlib import Path as _Path
    lora_path = str(_Path(lora_output_dir) / "lora")
    export_gguf_path: Optional[str] = None

    def _on_export_done(gguf_path: str) -> None:
        nonlocal export_gguf_path
        export_gguf_path = gguf_path

    yield f"data: {json.dumps({'type': 'step', 'label': 'Exporting LoRA to GGUF for after-eval…'})}\n\n"
    async for chunk in ft.export_gguf_sse(job_id=job_id, lora_path=lora_path, on_done=_on_export_done):
        yield chunk

    if not export_gguf_path:
        yield f"data: {json.dumps({'type': 'log', 'text': 'GGUF export failed — skipping after-eval'})}\n\n"
        return

    # Use the finetuned GGUF (local path) for after-eval
    export_model_id = f"{eval_gguf_model_id}-finetuned"
    async for chunk in ft._eval_pipeline_sse(
        job_id=job_id,
        profile_id=profile_id,
        stage="after",
        gguf_model_id=export_model_id,
        gguf_file=export_gguf_path,  # absolute local path — no HF download needed
        delete_after=False,
    ):
        yield chunk


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


# ── Find GGUF ─────────────────────────────────────────────────────────────

@router.get("/find-gguf")
def find_gguf(model_id: str) -> dict:
    """Search HF for a GGUF version of a BF16 model."""
    from huggingface_hub import HfApi
    from backend.services.hf_service import _get_hf_token

    api = HfApi()
    author = model_id.split("/")[0].lower() if "/" in model_id else ""
    name = model_id.split("/", 1)[1] if "/" in model_id else model_id

    seen: set[str] = set()
    candidates: list[dict] = []

    for query in [f"{name}-GGUF", f"{name} GGUF"]:
        try:
            results = list(api.list_models(
                search=query, filter="gguf", limit=8,
                token=_get_hf_token(),
            ))
            for m in results:
                mid = m.modelId
                if mid in seen:
                    continue
                seen.add(mid)
                same_author = mid.split("/")[0].lower() == author if "/" in mid else False
                candidates.append({
                    "id": mid,
                    "same_author": same_author,
                    "downloads": getattr(m, "downloads", 0) or 0,
                })
        except Exception:
            pass

    candidates.sort(key=lambda x: (not x["same_author"], -(x["downloads"] or 0)))
    candidates = candidates[:5]

    if candidates:
        top = candidates[0]
        try:
            info = api.model_info(top["id"], files_metadata=True, token=_get_hf_token())

            def _prio(f: dict) -> int:
                n = f["name"].lower()
                if "q4_k_m" in n: return 0
                if "q4_k_s" in n: return 1
                if "q5_k_m" in n: return 2
                if "q4_0" in n: return 3
                if "q8_0" in n: return 4
                return 10

            gguf_files = [
                {"name": s.rfilename, "size_gb": round(getattr(s, "size", 0) / 1024**3, 2)}
                for s in (info.siblings or [])
                if s.rfilename.endswith(".gguf") and "mmproj" not in s.rfilename.lower()
            ]
            gguf_files.sort(key=_prio)
            top["gguf_files"] = gguf_files
            top["recommended_file"] = gguf_files[0]["name"] if gguf_files else None
        except Exception:
            top["gguf_files"] = []
            top["recommended_file"] = None

    return {"candidates": candidates, "query_model": model_id}


# ── Eval run (SSE — download + load + run + unload) ────────────────────────

@router.post("/eval-run/stream")
async def eval_run_stream(body: EvalRunRequest) -> StreamingResponse:
    return StreamingResponse(
        _eval_run_generator(body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _eval_run_generator(body: EvalRunRequest):
    """SSE generator: download GGUF → load → run prompts → score → unload → delete."""
    import os
    from huggingface_hub import hf_hub_download
    from backend.services.hf_service import _model_dir, _get_hf_token

    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    profile = db.get_finetune_profile(body.profile_id)
    if not profile:
        yield _sse({"type": "error", "text": "Profile not found"})
        return

    pairs = db.get_training_pairs_for_profile(body.profile_id)
    if not pairs:
        yield _sse({"type": "error", "text": "No pairs in this profile"})
        return

    eval_prompts = [{"id": p["id"], "prompt": p["prompt"]} for p in pairs[:20]]

    # Step 1: Download GGUF
    yield _sse({"type": "step", "label": f"Downloading {body.gguf_file}…"})
    gguf_path: str | None = None
    try:
        gguf_path = hf_hub_download(
            repo_id=body.gguf_model_id,
            filename=body.gguf_file,
            local_dir=str(_model_dir(body.gguf_model_id)),
            token=_get_hf_token(),
        )
        yield _sse({"type": "log", "text": f"Downloaded to {gguf_path}"})
    except Exception as e:
        yield _sse({"type": "error", "text": f"Download failed: {e}"})
        return

    # Step 2: Load model via llama_service directly (bypasses inference model state)
    yield _sse({"type": "step", "label": "Loading GGUF model…"})
    try:
        from backend.services import llama_service
        from backend.services.engine_router import detect_gpu
        gpu = detect_gpu()
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: llama_service.load_model_async(
                gguf_path=gguf_path,
                model_id=body.gguf_model_id,
                n_ctx=4096,
                gpu_type=gpu["type"],
            ),
        )
        # Wait for load to complete (up to 120s)
        for _ in range(240):
            state = llama_service.get_load_state()
            if state.get("loaded_model_id"):
                break
            if state.get("error"):
                raise RuntimeError(state["error"])
            await asyncio.sleep(0.5)
        else:
            raise RuntimeError("Load timed out")
        yield _sse({"type": "log", "text": "Model loaded"})
    except Exception as e:
        yield _sse({"type": "error", "text": f"Load failed: {e}"})
        if gguf_path and body.delete_after:
            try:
                os.remove(gguf_path)
            except Exception:
                pass
        return

    # Step 3: Run prompts
    yield _sse({"type": "step", "label": f"Running {len(eval_prompts)} prompts…"})
    results: list[dict] = []
    for i, p in enumerate(eval_prompts):
        try:
            response_text = ""
            async for chunk in llama_service.generate(
                messages=[{"role": "user", "content": p["prompt"]}],
                stream=False,
                temperature=0.0,
                max_tokens=512,
            ):
                if isinstance(chunk, str) and chunk.startswith("data: "):
                    raw = chunk[6:].strip()
                    if raw and raw != "[DONE]":
                        try:
                            parsed = json.loads(raw)
                            delta = (parsed.get("choices") or [{}])[0].get("delta", {}).get("content")
                            if delta:
                                response_text += delta
                        except Exception:
                            pass
            results.append({"prompt_id": p["id"], "prompt": p["prompt"], "response": response_text, "score": None})
        except Exception:
            results.append({"prompt_id": p["id"], "prompt": p["prompt"], "response": "", "score": None})
        yield _sse({"type": "progress", "current": i + 1, "total": len(eval_prompts)})

    # Step 4: Unload
    yield _sse({"type": "step", "label": "Unloading model…"})
    try:
        llama_service.unload_model()
    except Exception:
        pass

    # Step 5: Delete temp GGUF
    if body.delete_after and gguf_path:
        try:
            os.remove(gguf_path)
            yield _sse({"type": "log", "text": "Temp GGUF deleted"})
        except Exception:
            pass

    # Step 6: Score + persist
    from backend.services.quality_scorer import score_general
    for r in results:
        try:
            scored = score_general(r["prompt"], r["response"])
            r["score"] = scored.get("score") if isinstance(scored, dict) else float(scored)
        except Exception:
            pass

    valid = [r["score"] for r in results if r["score"] is not None]
    score_avg = round(sum(valid) / len(valid), 2) if valid else None

    model_path_to_store = body.gguf_file if body.delete_after else (gguf_path or body.gguf_file)
    eval_record = db.create_finetune_eval(
        id=str(uuid.uuid4()),
        job_id=body.job_id,
        profile_id=body.profile_id,
        stage=body.stage,
        model_path=model_path_to_store,
        model_id=body.gguf_model_id,
        results=results,
        score_avg=score_avg,
    )
    yield _sse({"type": "done", "eval": eval_record, "score_avg": score_avg})


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
