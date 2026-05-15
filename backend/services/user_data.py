from __future__ import annotations

import os
import platform
from pathlib import Path


def get_user_data_dir() -> Path:
    """
    Retourne le répertoire de données utilisateur selon l'OS :
    - Linux/Unix  : ~/.local/share/echohub
    - macOS       : ~/Library/Application Support/echohub
    - Windows     : %APPDATA%\\echohub
    Crée le répertoire s'il n'existe pas.
    """
    system = platform.system()

    if system == "Windows":
        appdata = os.environ.get("APPDATA") or Path.home()
        base = Path(appdata)
    elif system == "Darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        xdg = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
        base = Path(xdg)

    data_dir = base / "echohub"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_db_path() -> Path:
    return get_user_data_dir() / "echohub.db"


def get_logs_dir() -> Path:
    logs = get_user_data_dir() / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    return logs


def get_config_path() -> Path:
    return get_user_data_dir() / "config.json"
