"""
skills.py — Community skill install/manage router.
Skills are cloned into ~/.local/share/echohub/skills/{skill_id}/
Each skill can declare its install instructions via echohub.yml or skill.yml.
Auto-detection fallback: package.json → bun install, pyproject.toml/setup.py → pip install,
requirements.txt → pip install -r, *.sh → chmod+exec.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

router = APIRouter(prefix="/skills", tags=["skills"])

SKILLS_DIR = Path.home() / ".local" / "share" / "echohub" / "skills"
REGISTRY_FILE = SKILLS_DIR / "registry.json"

# ── Native skills (built-in, read-only) ───────────────────────────────────────

NATIVE_SKILLS = [
    {
        "id": "web-search",
        "name": "Web Search",
        "description": "Fetch URLs and search the web using Scrapling. Exposes fetch_url and web_search tools.",
        "tools": ["fetch_url", "web_search"],
        "type": "native",
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "Web search: use web_search to find URLs, fetch_url to read pages. Always search before fetching.",
        "version": "built-in",
        "author": "EchoHub",
    },
    {
        "id": "code-runner",
        "name": "Code Runner",
        "description": "Execute shell commands in the project workspace via run_command.",
        "tools": ["run_command"],
        "type": "native",
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "Code runner: use run_command to execute shell commands, run scripts, validate code.",
        "version": "built-in",
        "author": "EchoHub",
    },
    {
        "id": "file-system",
        "name": "File System",
        "description": "Full workspace file management: create, read, edit, delete, list files.",
        "tools": ["create_file", "read_file", "edit_file", "delete_file", "list_files", "get_workspace_info"],
        "type": "native",
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "File system: use create_file, read_file, edit_file, delete_file, list_files to manage workspace files.",
        "version": "built-in",
        "author": "EchoHub",
    },
    {
        "id": "calculator",
        "name": "Calculator",
        "description": "Precise arithmetic via python3 -c. Avoids floating point errors in LLM math.",
        "tools": ["run_command"],
        "type": "native",
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "Calculator: for precise math, run python3 -c \"print(expression)\" via run_command.",
        "version": "built-in",
        "author": "EchoHub",
    },
]


# ── Registry helpers ───────────────────────────────────────────────────────────

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


# ── Auto-detect install strategy ──────────────────────────────────────────────

def _detect_install_commands(skill_dir: Path) -> list[str]:
    """Return a list of shell commands to install the skill."""
    # Prefer explicit manifest
    for manifest_name in ("echohub.yml", "echohub.yaml", "skill.yml", "skill.yaml"):
        manifest_path = skill_dir / manifest_name
        if manifest_path.exists():
            try:
                data = yaml.safe_load(manifest_path.read_text())
                install = data.get("install") or data.get("setup")
                if isinstance(install, str):
                    return [install]
                if isinstance(install, list):
                    return install
            except Exception:
                pass

    cmds: list[str] = []

    # JS/TS project
    if (skill_dir / "package.json").exists():
        cmds.append("bun install")
        pkg = json.loads((skill_dir / "package.json").read_text())
        if "build" in (pkg.get("scripts") or {}):
            cmds.append("bun run build")
        return cmds

    # Python project
    has_pyproject = (skill_dir / "pyproject.toml").exists()
    has_setup = (skill_dir / "setup.py").exists()
    has_req = (skill_dir / "requirements.txt").exists()

    if has_pyproject or has_setup:
        cmds.append(f"{sys.executable} -m pip install -e . --quiet")
        return cmds
    if has_req:
        cmds.append(f"{sys.executable} -m pip install -r requirements.txt --quiet")
        return cmds

    # Shell scripts
    for sh in sorted(skill_dir.glob("*.sh")):
        cmds.append(f"bash {sh.name}")
        break

    return cmds


def _read_manifest(skill_dir: Path) -> dict[str, Any]:
    """Read skill metadata from manifest file if present."""
    for name in ("echohub.yml", "echohub.yaml", "skill.yml", "skill.yaml"):
        p = skill_dir / name
        if p.exists():
            try:
                return yaml.safe_load(p.read_text()) or {}
            except Exception:
                pass
    # Fallback: try package.json
    pkg_path = skill_dir / "package.json"
    if pkg_path.exists():
        try:
            pkg = json.loads(pkg_path.read_text())
            return {"name": pkg.get("name"), "description": pkg.get("description"), "version": pkg.get("version")}
        except Exception:
            pass
    return {}


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_skills() -> dict[str, Any]:
    community = _load_registry()
    return {"native": NATIVE_SKILLS, "community": community}


class InstallRequest(BaseModel):
    repo_url: str
    skill_id: str | None = None


@router.post("/install")
async def install_skill(req: InstallRequest) -> StreamingResponse:
    """
    Clone a GitHub repo into the skills directory and run auto-detected install commands.
    Streams install log lines as text/event-stream.
    """
    skill_id = req.skill_id or str(uuid.uuid4())[:8]

    # Derive a clean skill_id from the repo URL if not provided
    if not req.skill_id:
        repo_name = req.repo_url.rstrip("/").split("/")[-1]
        repo_name = repo_name.replace(".git", "")
        skill_id = repo_name.lower().replace(" ", "-")

    target_dir = SKILLS_DIR / skill_id

    async def _stream():
        yield f"data: Starting install for {req.repo_url}\n\n"

        # Conflict check
        if target_dir.exists():
            yield f"data: Directory {skill_id} already exists — removing and re-cloning\n\n"
            shutil.rmtree(target_dir)

        # Clone
        yield f"data: Cloning {req.repo_url}...\n\n"
        try:
            result = subprocess.run(
                ["git", "clone", "--depth=1", req.repo_url, str(target_dir)],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode != 0:
                yield f"data: ERROR: git clone failed\n{result.stderr}\n\n"
                yield "data: INSTALL_FAILED\n\n"
                return
            yield "data: Clone complete\n\n"
        except subprocess.TimeoutExpired:
            yield "data: ERROR: git clone timed out (120s)\n\n"
            yield "data: INSTALL_FAILED\n\n"
            return
        except Exception as e:
            yield f"data: ERROR: {e}\n\n"
            yield "data: INSTALL_FAILED\n\n"
            return

        # Read manifest
        manifest = _read_manifest(target_dir)
        display_name = manifest.get("name") or skill_id
        description = manifest.get("description") or "Community skill"
        version = manifest.get("version") or "unknown"
        author = manifest.get("author") or req.repo_url.split("/")[-2] if "/" in req.repo_url else "unknown"
        tools = manifest.get("tools") or []
        awareness = manifest.get("awareness") or ""

        # Detect and run install commands
        cmds = _detect_install_commands(target_dir)
        if cmds:
            yield f"data: Detected {len(cmds)} install command(s)\n\n"
            for cmd in cmds:
                yield f"data: Running: {cmd}\n\n"
                try:
                    proc = subprocess.run(
                        cmd, shell=True, capture_output=True, text=True,
                        cwd=str(target_dir), timeout=300,
                    )
                    if proc.stdout.strip():
                        for line in proc.stdout.strip().splitlines():
                            yield f"data: {line}\n\n"
                    if proc.returncode != 0:
                        yield f"data: ERROR: command exited with code {proc.returncode}\n\n"
                        if proc.stderr.strip():
                            for line in proc.stderr.strip().splitlines()[-10:]:
                                yield f"data: {line}\n\n"
                        yield "data: INSTALL_FAILED\n\n"
                        return
                except subprocess.TimeoutExpired:
                    yield "data: ERROR: command timed out (300s)\n\n"
                    yield "data: INSTALL_FAILED\n\n"
                    return
        else:
            yield "data: No install commands detected — skill registered as-is\n\n"

        # Register
        entry: dict[str, Any] = {
            "id": skill_id,
            "name": display_name,
            "description": description,
            "version": version,
            "author": author,
            "repo_url": req.repo_url,
            "path": str(target_dir),
            "tools": tools,
            "awareness": awareness,
            "type": "community",
        }
        registry = _load_registry()
        registry = [r for r in registry if r["id"] != skill_id]
        registry.append(entry)
        _save_registry(registry)

        yield f"data: Skill '{display_name}' installed successfully\n\n"
        yield f"data: INSTALL_DONE:{skill_id}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.delete("/{skill_id}")
def delete_skill(skill_id: str) -> dict[str, str]:
    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")

    target_dir = Path(entry["path"])
    if target_dir.exists():
        shutil.rmtree(target_dir)

    registry = [r for r in registry if r["id"] != skill_id]
    _save_registry(registry)
    logger.info(f"[skills] deleted {skill_id}")
    return {"status": "deleted", "id": skill_id}


@router.get("/{skill_id}")
def get_skill(skill_id: str) -> dict[str, Any]:
    # Check native first
    native = next((s for s in NATIVE_SKILLS if s["id"] == skill_id), None)
    if native:
        return native
    # Then community
    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    return entry
