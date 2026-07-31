"""
Configuration du backend llama-server externe.

Résout le binaire `llama-server` (env > config.json > défaut), vérifie qu'il
expose bien un device CUDA, et porte les paramètres d'offload MoE — par défaut
globaux, surchargeables par modèle et persistés en DB.

Le binaire par défaut vit dans un dossier appartenant à unsloth
(`~/.unsloth/llama.cpp/build-cuda/bin/`) : emplacement fragile, d'où l'override.
Rebuild documenté dans docs/llama-server.md.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

from loguru import logger

LLAMA_SERVER_PORT = 37824
LLAMA_SERVER_BASE_URL = f"http://127.0.0.1:{LLAMA_SERVER_PORT}"

ENV_BIN = "ECHOHUB_LLAMA_SERVER_BIN"
DEFAULT_BIN = Path.home() / ".unsloth" / "llama.cpp" / "build-cuda" / "bin" / "llama-server"

_CFG_KEY_PREFIX = "llama_server_cfg:"


@dataclass
class LlamaServerConfig:
    """Paramètres de lancement llama-server. Défauts = profil MoE mesuré."""

    n_cpu_moe: int = 0
    n_gpu_layers: int = 99
    n_ctx: int = 8192
    flash_attn: bool = True
    threads: int = 6
    cache_type_k: str = "q8_0"
    cache_type_v: str = "q8_0"
    n_batch: Optional[int] = None
    extra_args: Optional[list[str]] = None


# Profil validé par mesure sur Qwen3.6-35B-A3B Q4_K_M (25,5 tok/s) — appliqué
# à tout modèle marqué MoE quand l'appelant ne fournit pas de valeur explicite.
MOE_DEFAULTS = LlamaServerConfig(
    n_cpu_moe=30, n_gpu_layers=99, n_ctx=32768,
    flash_attn=True, threads=6, cache_type_k="q8_0", cache_type_v="q8_0",
)


def resolve_binary() -> Path:
    """Chemin du binaire llama-server : env > config.json > défaut > PATH."""
    env_val = os.environ.get(ENV_BIN)
    if env_val:
        return Path(env_val).expanduser()
    try:
        from backend.services.user_data import get_config_path
        cfg_path = get_config_path()
        if cfg_path.exists():
            override = json.loads(cfg_path.read_text()).get("llama_server_bin")
            if override:
                return Path(override).expanduser()
    except Exception as e:
        logger.warning(f"[llama_server] config.json unreadable ({e}) — falling back to default binary")
    if DEFAULT_BIN.exists():
        return DEFAULT_BIN
    which = shutil.which("llama-server")
    return Path(which) if which else DEFAULT_BIN


_diag_cache: dict[str, dict] = {}


def check_binary(refresh: bool = False) -> dict:
    """
    Diagnostic du binaire : présence, exécutabilité, support CUDA, version.
    Retourne un dict toujours renseigné — jamais d'exception.

    Le résultat est mis en cache par chemin : `--list-devices` initialise CUDA et
    coûte plusieurs secondes, or ce check est sur le chemin de /inference/engine.
    """
    path = resolve_binary()
    if not refresh and str(path) in _diag_cache:
        return _diag_cache[str(path)]
    result = _probe_binary(path)
    _diag_cache[str(path)] = result
    return result


def _probe_binary(path: Path) -> dict:
    """Sonde effective du binaire — sans cache."""
    result: dict = {"path": str(path), "available": False, "cuda": False,
                    "version": None, "error": None}
    if not path.exists():
        result["error"] = (
            f"llama-server introuvable à {path}. Définissez {ENV_BIN} ou la clé "
            "'llama_server_bin' dans config.json (voir docs/llama-server.md pour le rebuild CUDA)."
        )
        return result
    if not os.access(path, os.X_OK):
        result["error"] = f"llama-server présent mais non exécutable : {path}"
        return result
    result["available"] = True
    try:
        ver = subprocess.run([str(path), "--version"], capture_output=True, text=True, timeout=15)
        result["version"] = (ver.stdout + ver.stderr).strip().splitlines()[0] if (ver.stdout or ver.stderr) else None
    except Exception as e:
        logger.warning(f"[llama_server] --version failed on {path}: {e}")
    result["cuda"] = _has_cuda_device(path)
    if not result["cuda"]:
        result["error"] = (
            f"llama-server à {path} ne rapporte aucun device CUDA — build CPU. "
            "Rebuild avec -DGGML_CUDA=ON (voir docs/llama-server.md)."
        )
    return result


def _has_cuda_device(path: Path) -> bool:
    """True si `--list-devices` rapporte au moins un device CUDA/ROCm."""
    try:
        out = subprocess.run([str(path), "--list-devices"], capture_output=True,
                             text=True, timeout=30)
        text = (out.stdout + out.stderr)
        return any(tag in text for tag in ("CUDA0", "CUDA1", "ROCm0", "Vulkan0"))
    except Exception as e:
        logger.error(f"[llama_server] --list-devices failed on {path}: {e}")
        return False


def get_model_config(model_id: str, is_moe: bool = False) -> LlamaServerConfig:
    """Config persistée pour ce modèle, sinon défauts MoE ou denses."""
    base = MOE_DEFAULTS if is_moe else LlamaServerConfig()
    try:
        from backend.services.db import get_app_state
        raw = get_app_state(f"{_CFG_KEY_PREFIX}{model_id}")
        if raw:
            stored = json.loads(raw)
            merged = {**asdict(base), **{k: v for k, v in stored.items() if v is not None}}
            return LlamaServerConfig(**merged)
    except Exception as e:
        logger.warning(f"[llama_server] cannot read stored config for {model_id}: {e}")
    return base


def save_model_config(model_id: str, cfg: LlamaServerConfig) -> None:
    """Persiste la config utilisée pour ce modèle — réutilisée au prochain load."""
    try:
        from backend.services.db import set_app_state
        set_app_state(f"{_CFG_KEY_PREFIX}{model_id}", json.dumps(asdict(cfg)))
    except Exception as e:
        logger.error(f"[llama_server] cannot persist config for {model_id}: {e}")


def build_cmd(binary: Path, gguf_path: str, model_id: str, cfg: LlamaServerConfig,
              mmproj_path: Optional[str] = None) -> list[str]:
    """Construit la ligne de commande llama-server à partir de la config."""
    cmd = [
        str(binary),
        "-m", gguf_path,
        "--alias", model_id,
        "--host", "127.0.0.1",
        "--port", str(LLAMA_SERVER_PORT),
        "-ngl", str(cfg.n_gpu_layers),
        "-c", str(cfg.n_ctx),
        "-t", str(cfg.threads),
        "--cache-type-k", cfg.cache_type_k,
        "--cache-type-v", cfg.cache_type_v,
        "--jinja",
        # Laisse le <think>…</think> brut dans message.content — le frontend
        # EchoHub parse les balises lui-même, comme sur le chemin in-process.
        "--reasoning-format", "none",
    ]
    if cfg.flash_attn:
        cmd += ["-fa", "on"]
    if cfg.n_cpu_moe > 0:
        cmd += ["--n-cpu-moe", str(cfg.n_cpu_moe)]
    if cfg.n_batch:
        cmd += ["-b", str(cfg.n_batch)]
    if mmproj_path:
        cmd += ["--mmproj", mmproj_path]
    if cfg.extra_args:
        cmd += list(cfg.extra_args)
    return cmd
