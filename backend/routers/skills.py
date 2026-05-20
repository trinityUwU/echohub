"""skills — aggregator, re-exports all sub-routers via a single router."""
from fastapi import APIRouter
from backend.routers.skills_registry import router as _reg
from backend.routers.skills_mcp import router as _mcp
from backend.routers.skills_discover import router as _disc

# Re-exports for external consumers (inference.py uses _load_registry)
from backend.routers.skills_helpers import _load_registry, NATIVE_SKILLS  # noqa: F401

router = APIRouter()
router.include_router(_reg)
router.include_router(_mcp)
router.include_router(_disc)
