from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from backend.services import gpu_service, engine_router
from backend.models.schemas import GpuStats

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/gpu", response_model=GpuStats)
def get_gpu() -> GpuStats:
    return gpu_service.get_gpu_stats()


@router.get("/engine-log", response_class=PlainTextResponse)
def get_engine_log() -> str:
    """Return last 100 lines of the active engine log."""
    return engine_router.get_engine_log(100)


@router.get("/vllm-log", response_class=PlainTextResponse)
def get_vllm_log() -> str:
    """Alias pour compatibilité frontend existant."""
    return engine_router.get_engine_log(100)
