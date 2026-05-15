import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

load_dotenv()

from backend.routers import conversations, inference, models, settings, system
from backend.services import db, engine_router, vllm_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("EchoHub backend starting up")
    vllm_service.kill_stale_pid()
    db.init_db()
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
    allow_origins=["http://localhost:37822", "http://127.0.0.1:37822"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models.router)
app.include_router(inference.router)
app.include_router(system.router)
app.include_router(settings.router)
app.include_router(conversations.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
