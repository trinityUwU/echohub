"""
Centralized path configuration.
All paths used by the app go through this module — never hardcode paths elsewhere.

Config is persisted in ~/.local/share/echohub/config.json.
Paths are resolved at runtime so changing a path takes effect immediately.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from loguru import logger

from backend.services.user_data import get_user_data_dir, get_config_path

_DEFAULTS = {
    "models_dir": "/mnt/models/echohub",
    "vllm_envs_dir": None,   # None = use default under user_data_dir
    "user_data_dir": None,   # None = use platform default
}


def _load_raw() -> dict:
    cfg_path = get_config_path()
    if cfg_path.exists():
        try:
            return json.loads(cfg_path.read_text())
        except Exception:
            pass
    return {}


def _save_raw(data: dict) -> None:
    cfg_path = get_config_path()
    cfg_path.write_text(json.dumps(data, indent=2))


def get_models_dir() -> Path:
    raw = _load_raw()
    p = Path(raw.get("models_dir") or _DEFAULTS["models_dir"])
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_vllm_envs_dir() -> Path:
    raw = _load_raw()
    override = raw.get("vllm_envs_dir")
    if override:
        p = Path(override)
    else:
        p = get_user_data_dir() / "vllm-envs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_all_paths() -> dict:
    raw = _load_raw()
    return {
        "models_dir":    str(get_models_dir()),
        "vllm_envs_dir": str(get_vllm_envs_dir()),
        "user_data_dir": str(get_user_data_dir()),
        "db_path":       str(get_user_data_dir() / "echohub.db"),
        # Source-of-truth flags (is this an override or the default?)
        "models_dir_is_default":    "models_dir" not in raw,
        "vllm_envs_dir_is_default": "vllm_envs_dir" not in raw,
    }


def set_models_dir(new_path: str) -> None:
    raw = _load_raw()
    raw["models_dir"] = str(Path(new_path).expanduser().resolve())
    _save_raw(raw)
    logger.info(f"models_dir updated → {raw['models_dir']}")


def set_vllm_envs_dir(new_path: str) -> None:
    raw = _load_raw()
    raw["vllm_envs_dir"] = str(Path(new_path).expanduser().resolve())
    _save_raw(raw)
    logger.info(f"vllm_envs_dir updated → {raw['vllm_envs_dir']}")


def reset_to_default(key: str) -> None:
    raw = _load_raw()
    raw.pop(key, None)
    _save_raw(raw)


# ── Inference settings ────────────────────────────────────────────────────

INFERENCE_DEFAULTS = {
    "flash_attn": True,
    "keep_model_in_memory": False,
}


def get_inference_settings() -> dict:
    raw = _load_raw()
    settings = raw.get("inference", {})
    return {**INFERENCE_DEFAULTS, **settings}


def set_inference_setting(key: str, value: object) -> None:
    if key not in INFERENCE_DEFAULTS:
        raise ValueError(f"Unknown inference setting: {key}")
    raw = _load_raw()
    raw.setdefault("inference", {})[key] = value
    _save_raw(raw)
    logger.info(f"inference.{key} = {value}")
