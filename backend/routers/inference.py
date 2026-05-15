from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger

from backend.models.schemas import ChatRequest, LoadRequest, ModelInfo
from backend.services import engine_router, hf_service

router = APIRouter(prefix="/inference", tags=["inference"])

MODELS_DIR = Path("/mnt/models/echohub")


def _resolve_model_path(model_id: str) -> str:
    candidate = MODELS_DIR / model_id.replace("/", "--")
    if candidate.exists():
        return str(candidate)
    raise FileNotFoundError(f"Model not found locally: {model_id}")


@router.post("/load")
def load_model(req: LoadRequest) -> dict:
    """Start loading a model asynchronously. Poll /inference/load-state for progress."""
    if engine_router.get_status() is not None:
        raise HTTPException(status_code=409, detail="A model is already loaded. Unload it first.")
    state = engine_router.get_load_state()
    if state.get("loading_model_id") is not None:
        raise HTTPException(status_code=409, detail="A model is already loading.")
    try:
        model_path = _resolve_model_path(req.model_id)
        engine_router.load_model_async(
            model_path=model_path,
            model_id=req.model_id,
            gpu_memory_utilization=req.gpu_memory_utilization if req.gpu_memory_utilization != 0.75 else None,
            max_model_len=req.max_model_len,
        )
        return {"status": "loading", "model_id": req.model_id}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"load_model failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/load-state")
def get_load_state() -> dict:
    """Poll loading progress. loading_model_id is set while loading, null when done."""
    return engine_router.get_load_state()


@router.post("/unload")
def unload_model() -> dict:
    """Unload the current model and free VRAM."""
    if engine_router.get_status() is None:
        raise HTTPException(status_code=404, detail="No model currently loaded.")
    try:
        engine_router.unload_model()
        return {"status": "unloaded"}
    except Exception as e:
        logger.error(f"unload_model failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status", response_model=Optional[ModelInfo])
def get_status() -> Optional[ModelInfo]:
    """Return the currently loaded model, or null."""
    return engine_router.get_status()


@router.get("/engine")
def get_engine() -> dict:
    """Return which inference engine is currently active."""
    return {
        "engine": engine_router.get_active_engine(),
        "available_engines": _get_available_engines(),
    }


def _get_available_engines() -> list[str]:
    engines = ["llama"]
    if engine_router.is_vllm_available():
        engines.append("vllm")
    return engines


@router.post("/chat")
async def chat(req: ChatRequest):
    """Chat with the loaded model. Supports streaming via SSE."""
    if engine_router.get_status() is None:
        raise HTTPException(status_code=404, detail="No model loaded.")

    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    if req.system_prompt and req.system_prompt.strip():
        messages = [{"role": "system", "content": req.system_prompt}] + messages

    generate_kwargs = dict(
        stream=req.stream,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        top_p=req.top_p,
        top_k=req.top_k,
        repetition_penalty=req.repetition_penalty,
        presence_penalty=req.presence_penalty,
        frequency_penalty=req.frequency_penalty,
        stop=req.stop,
    )

    if req.stream:
        async def event_stream():
            try:
                async for chunk in engine_router.generate(messages=messages, **generate_kwargs):
                    yield f"{chunk}\n\n"
            except Exception as e:
                logger.error(f"chat stream error: {e}")
                yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    result = None
    async for chunk in engine_router.generate(messages=messages, **generate_kwargs):
        result = chunk
    return result


@router.post("/summarize")
async def summarize_messages(req: ChatRequest) -> dict:
    """Summarize a list of messages into a compact context string."""
    if engine_router.get_status() is None:
        raise HTTPException(status_code=404, detail="No model loaded.")

    messages_text = "\n".join(
        f"{m.role.upper()}: {m.content}" for m in req.messages
    )
    summarize_prompt = [
        {
            "role": "user",
            "content": (
                "Summarize the following conversation concisely. "
                "Preserve all key facts, decisions, and context. "
                "Write in third person, past tense. Be dense and complete.\n\n"
                f"{messages_text}"
            )
        }
    ]
    result = None
    async for chunk in engine_router.generate(
        messages=summarize_prompt,
        stream=False,
        temperature=0.3,
        max_tokens=512,
    ):
        result = chunk

    if not result:
        raise HTTPException(status_code=500, detail="Summarization failed")

    summary = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    return {"summary": summary}
