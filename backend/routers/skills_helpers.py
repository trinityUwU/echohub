"""
skills_helpers.py — Registry I/O, manifest parsing, install detection.
Shared by all skills sub-routers.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

SKILLS_DIR = Path.home() / ".local" / "share" / "echohub" / "skills"
REGISTRY_FILE = SKILLS_DIR / "registry.json"

NATIVE_SKILLS: list[dict[str, Any]] = [
    {
        "id": "web-search", "name": "Web Search", "type": "native",
        "description": "Fetch URLs and search the web using Scrapling.",
        "tools": ["fetch_url", "web_search"],
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "Web search: use web_search to find URLs, fetch_url to read pages. Always search before fetching.",
        "version": "built-in", "author": "EchoHub",
    },
    {
        "id": "code-runner", "name": "Code Runner", "type": "native",
        "description": "Execute shell commands in the project workspace via run_command.",
        "tools": ["run_command"],
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "Code runner: use run_command to execute shell commands, run scripts, validate code.",
        "version": "built-in", "author": "EchoHub",
    },
    {
        "id": "file-system", "name": "File System", "type": "native",
        "description": "Full workspace file management: create, read, edit, delete, list files.",
        "tools": ["create_file", "read_file", "edit_file", "delete_file", "list_files", "get_workspace_info"],
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "File system: use create_file, read_file, edit_file, delete_file, list_files to manage workspace files.",
        "version": "built-in", "author": "EchoHub",
    },
    {
        "id": "calculator", "name": "Calculator", "type": "native",
        "description": "Precise arithmetic via python3 -c. Avoids floating point errors in LLM math.",
        "tools": ["run_command"],
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": 'Calculator: for precise math, run python3 -c "print(expression)" via run_command.',
        "version": "built-in", "author": "EchoHub",
    },
]


def _load_registry() -> list[dict[str, Any]]:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    if not REGISTRY_FILE.exists():
        return []
    try:
        return json.loads(REGISTRY_FILE.read_text())
    except Exception:
        return []


def _save_registry(entries: list[dict[str, Any]]) -> None:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    REGISTRY_FILE.write_text(json.dumps(entries, indent=2))


def _patch_skill_registry_json(skill_path: Path, fields: dict[str, Any]) -> None:
    """
    Merge `fields` into the skill-local registry.json (skill_path/registry.json).
    Creates the file if it doesn't exist. No-ops silently on any error.
    """
    local_reg = skill_path / "registry.json"
    try:
        data: dict[str, Any] = json.loads(local_reg.read_text()) if local_reg.exists() else {}
        data.update(fields)
        local_reg.write_text(json.dumps(data, indent=2))
    except Exception:
        pass


def _extract_author(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        return raw.get("name") or raw.get("email") or ""
    return ""


def _read_manifest(skill_dir: Path) -> dict[str, Any]:
    pkg_path = skill_dir / "package.json"
    if pkg_path.exists():
        try:
            pkg = json.loads(pkg_path.read_text())
            echohub = pkg.get("echohub") or {}
            return {
                "name": echohub.get("name") or pkg.get("name"),
                "description": echohub.get("description") or pkg.get("description"),
                "version": pkg.get("version"),
                "author": _extract_author(pkg.get("author")),
                "tools": echohub.get("tools") or [],
                "awareness": echohub.get("awareness") or "",
            }
        except Exception:
            pass
    pyproject_path = skill_dir / "pyproject.toml"
    if pyproject_path.exists():
        try:
            try:
                import tomllib
                data = tomllib.loads(pyproject_path.read_text())
            except ImportError:
                import tomli  # type: ignore
                data = tomli.loads(pyproject_path.read_text())
            meta = data.get("project") or {}
            echohub = (data.get("tool") or {}).get("echohub") or {}
            return {
                "name": echohub.get("name") or meta.get("name"),
                "description": echohub.get("description") or meta.get("description"),
                "version": meta.get("version"),
                "author": _extract_author(next(iter(meta.get("authors") or []), None)),
                "tools": echohub.get("tools") or [],
                "awareness": echohub.get("awareness") or "",
            }
        except Exception:
            pass
    return {}


def _detect_install_commands(skill_dir: Path) -> list[str]:
    cmds: list[str] = []
    pkg_path = skill_dir / "package.json"
    if pkg_path.exists():
        try:
            pkg = json.loads(pkg_path.read_text())
            override = (pkg.get("echohub") or {}).get("install")
            if isinstance(override, list):
                return override
            if isinstance(override, str):
                return [override]
            cmds.append("bun install")
            scripts = pkg.get("scripts") or {}
            if "build" in scripts:
                cmds.append("bun run build")
            elif "prepare" in scripts:
                cmds.append("bun run prepare")
        except Exception:
            pass
        return cmds
    if (skill_dir / "pyproject.toml").exists() or (skill_dir / "setup.py").exists():
        cmds = [
            "python3 -m venv .venv",
            ".venv/bin/pip install -e . --quiet",
        ]
        if (skill_dir / "requirements.txt").exists():
            cmds.append(".venv/bin/pip install -r requirements.txt --quiet")
        return cmds
    if (skill_dir / "requirements.txt").exists():
        return [
            "python3 -m venv .venv",
            ".venv/bin/pip install -r requirements.txt --quiet",
        ]
    for sh in sorted(skill_dir.glob("install*.sh")):
        return [f"bash {sh.name}"]
    return cmds
