import os
import traceback
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

load_dotenv()

from backend.routers import conversations, finetune, inference, installer, models, projects, settings, skills, system
from backend.services import db, engine_router, vllm_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("EchoHub backend starting up")
    vllm_service.kill_stale_pid()
    db.init_db()
    from backend.services.conversation_manager import migrate_from_sqlite
    migrate_from_sqlite()
    yield
    logger.info("EchoHub backend shutting down")
    engine_router.cleanup()


app = FastAPI(
    title="EchoHub API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    # Tauri webview uses tauri:// or http://127.0.0.1 with a dynamic port
    allow_origin_regex=r"(tauri://localhost|http://127\.0\.0\.1(:\d+)?|http://localhost(:\d+)?)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled exception on {} {}: {}", request.method, request.url.path, traceback.format_exc())
    origin = request.headers.get("origin", "")
    headers = {}
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(status_code=500, content={"detail": str(exc)}, headers=headers)

app.include_router(installer.router)
app.include_router(models.router)
app.include_router(inference.router)
app.include_router(system.router)
app.include_router(settings.router)
app.include_router(conversations.router)
app.include_router(finetune.router)
app.include_router(projects.router)
app.include_router(skills.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
