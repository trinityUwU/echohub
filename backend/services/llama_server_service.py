"""
Backend d'inférence `llama-server` externe (troisième moteur, à côté de
llama-cpp-python in-process et vLLM).

Pilote le binaire llama.cpp compilé avec CUDA comme un process externe : start,
attente de disponibilité, arrêt propre. La génération passe par son endpoint
OpenAI-compatible (voir llama_server_generate.py).

Raison d'être : llama-cpp-python n'expose ni `n_cpu_moe` ni
`tensor_buft_overrides`, ce qui rend l'offload d'experts MoE impossible
in-process (1,59 tok/s mesuré vs 25,54 tok/s via le binaire).

NOTE — llama_lock : ce chemin ne prend PAS le mutex global llama_lock. Ce verrou
existe pour l'état C partagé de llama.cpp chargé *dans* le process Python ; un
process externe a son propre espace mémoire. Le prendre ici sérialiserait
inutilement les requêtes et créerait un couplage entre deux moteurs qui ne
partagent rien.
"""
from __future__ import annotations

import atexit
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from backend.models.schemas import ModelInfo
from backend.services.llama_server_config import (
    LLAMA_SERVER_BASE_URL, LlamaServerConfig, build_cmd, check_binary,
    get_model_config, resolve_binary, save_model_config,
)

PID_FILE = Path("/tmp/echohub_llama_server.pid")
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOG_PATH = _PROJECT_ROOT / "logs" / "llama-server.log"

_current_model: Optional[ModelInfo] = None
_proc: Optional[subprocess.Popen] = None
_loading_model_id: Optional[str] = None
_load_error: Optional[str] = None
_eject_requested: bool = False
_load_config: Optional[dict] = None


# ---------------------------------------------------------------------------
# PID helpers
# ---------------------------------------------------------------------------

def _read_pid() -> Optional[int]:
    if PID_FILE.exists():
        try:
            return int(PID_FILE.read_text().strip())
        except ValueError:
            return None
    return None


def _kill_pid(pid: int) -> None:
    """SIGTERM puis SIGKILL après 5 s. Ne lève jamais."""
    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(50):
            time.sleep(0.1)
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                logger.info(f"[llama_server] PID {pid} terminated")
                return
        os.kill(pid, signal.SIGKILL)
        logger.warning(f"[llama_server] PID {pid} force-killed")
    except ProcessLookupError:
        logger.info(f"[llama_server] PID {pid} already gone")
    except Exception as e:
        logger.error(f"[llama_server] kill {pid} failed: {e}")


def kill_stale_pid() -> None:
    """Au démarrage : tue un process llama-server orphelin d'un crash précédent."""
    pid = _read_pid()
    if pid is None:
        return
    logger.warning(f"[llama_server] stale PID {pid} — killing before startup")
    _kill_pid(pid)
    PID_FILE.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

def get_status() -> Optional[ModelInfo]:
    return _current_model


def get_load_state() -> dict:
    return {"loading_model_id": _loading_model_id,
            "loaded_model_id": _current_model.id if _current_model else None,
            "error": _load_error}


def get_load_config() -> Optional[dict]:
    return _load_config


def is_available() -> bool:
    """True si le binaire est présent, exécutable et expose un device GPU."""
    info = check_binary()
    return bool(info["available"] and info["cuda"])


def _wait_ready(timeout: int = 900) -> bool:
    """Poll /health jusqu'à disponibilité, mort du process, timeout ou eject."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _eject_requested:
            logger.info("[llama_server] eject requested — aborting ready wait")
            return False
        if _proc is not None and _proc.poll() is not None:
            logger.warning(f"[llama_server] process exited with code {_proc.returncode}")
            return False
        try:
            r = httpx.get(f"{LLAMA_SERVER_BASE_URL}/health", timeout=2)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(1)
    logger.error(f"[llama_server] not ready after {timeout}s")
    return False


# ---------------------------------------------------------------------------
# Load / unload
# ---------------------------------------------------------------------------

def _resolve_config(model_id: str, is_moe: bool, overrides: dict) -> LlamaServerConfig:
    """Config persistée ou défauts, surchargée par les valeurs explicites."""
    cfg = get_model_config(model_id, is_moe=is_moe)
    for key, val in overrides.items():
        if val is not None and hasattr(cfg, key):
            setattr(cfg, key, val)
    return cfg


def _spawn(cmd: list[str]) -> subprocess.Popen:
    """Lance le process externe, log redirigé vers logs/llama-server.log."""
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        log_file = open(LOG_PATH, "w")
        proc = subprocess.Popen(cmd, stdout=log_file, stderr=log_file,
                                start_new_session=True, env={**os.environ})
    except Exception as e:
        logger.error(f"[llama_server] spawn failed: {e}")
        raise RuntimeError(f"Cannot start llama-server: {e}")
    PID_FILE.write_text(str(proc.pid))
    return proc


def load_model(gguf_path: str, model_id: str, is_moe: bool = False,
               mmproj_path: Optional[str] = None, **overrides) -> None:
    """Démarre llama-server sur gguf_path et attend qu'il réponde sur /health."""
    global _current_model, _proc, _eject_requested, _load_config
    _eject_requested = False
    if _proc is not None:
        raise RuntimeError("A model is already loaded on llama-server. Unload it first.")

    diag = check_binary()
    if not diag["available"] or not diag["cuda"]:
        raise RuntimeError(diag["error"] or "llama-server unavailable")

    cfg = _resolve_config(model_id, is_moe, overrides)
    cmd = build_cmd(resolve_binary(), gguf_path, model_id, cfg, mmproj_path)
    logger.info(f"[llama_server] starting: {' '.join(cmd)}")

    _proc = _spawn(cmd)
    logger.info(f"[llama_server] started PID {_proc.pid} (n_cpu_moe={cfg.n_cpu_moe}, n_ctx={cfg.n_ctx})")

    if not _wait_ready():
        _fail_load(cfg)
        return

    _current_model = ModelInfo(id=model_id, name=model_id.split("/")[-1], downloaded=True,
                               loaded=True, max_context_window=cfg.n_ctx, engine="llama_server")
    _load_config = {"engine": "llama_server", "gguf_path": gguf_path,
                    "max_model_len": cfg.n_ctx, "n_cpu_moe": cfg.n_cpu_moe,
                    "n_gpu_layers": cfg.n_gpu_layers, "threads": cfg.threads,
                    "flash_attn": cfg.flash_attn, "cache_type_k": cfg.cache_type_k,
                    "cache_type_v": cfg.cache_type_v, "binary": diag["path"],
                    "version": diag["version"]}
    save_model_config(model_id, cfg)
    logger.info(f"[llama_server] model loaded: {model_id}")


def _fail_load(cfg: LlamaServerConfig) -> None:
    """Extrait la cause depuis le log, nettoie, et relève une erreur lisible."""
    tail = ""
    try:
        tail = "\n".join(LOG_PATH.read_text(errors="replace").splitlines()[-40:])
    except Exception as e:
        logger.warning(f"[llama_server] cannot read log: {e}")
    unload_model()
    if _eject_requested:
        raise RuntimeError("Ejected by user")
    root = next((ln.strip()[:200] for ln in reversed(tail.splitlines())
                 if any(t in ln for t in ("error", "failed", "CUDA", "out of memory"))), "")
    if "out of memory" in tail or "CUDA error" in tail:
        raise RuntimeError(
            f"llama-server VRAM insuffisante — augmentez n_cpu_moe (actuel {cfg.n_cpu_moe}) "
            f"ou réduisez n_ctx ({cfg.n_ctx}). Détail : {root}"
        )
    raise RuntimeError(root or "llama-server failed to start — voir logs/llama-server.log")


def load_model_async(gguf_path: str, model_id: str, is_moe: bool = False,
                     mmproj_path: Optional[str] = None, **overrides) -> None:
    """Lance le chargement dans un thread — retourne immédiatement."""
    import threading
    global _loading_model_id, _load_error, _eject_requested
    _loading_model_id = model_id
    _load_error = None
    _eject_requested = False

    def _run() -> None:
        global _loading_model_id, _load_error
        try:
            load_model(gguf_path, model_id, is_moe, mmproj_path, **overrides)
        except Exception as e:
            if not _eject_requested:
                _load_error = str(e)
                logger.error(f"[llama_server] async load failed: {e}")
        finally:
            _loading_model_id = None

    threading.Thread(target=_run, daemon=True, name=f"llama-server-load-{model_id}").start()


def unload_model() -> None:
    """Tue le process llama-server et libère la VRAM. Sûr pendant un chargement."""
    global _current_model, _proc, _loading_model_id, _eject_requested, _load_config
    _eject_requested = True
    _loading_model_id = None

    pid = _read_pid()
    if pid is not None:
        _kill_pid(pid)
        PID_FILE.unlink(missing_ok=True)

    if _proc is not None:
        try:
            _proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _proc.kill()
        except Exception as e:
            logger.error(f"[llama_server] wait failed: {e}")
        _proc = None

    _current_model = None
    _load_config = None
    time.sleep(1)
    logger.info("[llama_server] model unloaded")


def get_log(n_lines: int = 100) -> str:
    """Dernières lignes du log du process externe."""
    try:
        if not LOG_PATH.exists():
            return ""
        return "\n".join(LOG_PATH.read_text(errors="replace").splitlines()[-n_lines:])
    except Exception as e:
        logger.error(f"[llama_server] cannot read log: {e}")
        return ""


def cleanup() -> None:
    """atexit — tue toujours le process externe à la sortie du backend."""
    if _proc is None and _read_pid() is None:
        return
    logger.info("[llama_server] cleanup — killing external process")
    try:
        unload_model()
    except Exception as e:
        logger.error(f"[llama_server] cleanup error: {e}")


atexit.register(cleanup)

from backend.services.llama_server_generate import (  # noqa: E402
    chat_completion_sync, generate, generate_with_tools,
)

__all__ = ["load_model", "load_model_async", "unload_model", "get_status",
           "get_load_state", "get_load_config", "kill_stale_pid", "is_available",
           "get_log", "cleanup", "generate", "generate_with_tools",
           "chat_completion_sync", "LLAMA_SERVER_BASE_URL"]
