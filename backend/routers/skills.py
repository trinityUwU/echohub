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
    """
    Return install commands in priority order:
    1. `install` key in package.json[echohub] or pyproject.toml[tool.echohub]
    2. Standard package manager: bun install (package.json), pip install (pyproject/setup/requirements)
    3. Shell script fallback
    """
    cmds: list[str] = []

    # JS/TS: package.json is the standard
    pkg_path = skill_dir / "package.json"
    if pkg_path.exists():
        try:
            pkg = json.loads(pkg_path.read_text())
            # Custom install override via echohub namespace
            override = (pkg.get("echohub") or {}).get("install")
            if isinstance(override, list):
                return override
            if isinstance(override, str):
                return [override]
        except Exception:
            pass
        cmds.append("bun install")
        try:
            pkg = json.loads(pkg_path.read_text())
            scripts = pkg.get("scripts") or {}
            if "build" in scripts:
                cmds.append("bun run build")
            elif "prepare" in scripts:
                cmds.append("bun run prepare")
        except Exception:
            pass
        return cmds

    # Python: pyproject.toml is the standard (PEP 517/518)
    if (skill_dir / "pyproject.toml").exists() or (skill_dir / "setup.py").exists():
        cmds.append(f"{sys.executable} -m pip install -e . --quiet")
        return cmds

    # requirements.txt fallback
    if (skill_dir / "requirements.txt").exists():
        cmds.append(f"{sys.executable} -m pip install -r requirements.txt --quiet")
        return cmds

    # Shell script last resort
    for sh in sorted(skill_dir.glob("install*.sh")):
        cmds.append(f"bash {sh.name}")
        return cmds

    return cmds


def _read_manifest(skill_dir: Path) -> dict[str, Any]:
    """
    Read skill metadata. Priority:
    1. package.json → `echohub` field (JS/TS standard)
    2. pyproject.toml → [tool.echohub] section (Python standard)
    3. Top-level package.json fields (name, description, version, author)
    """
    # JS/TS: read package.json with echohub namespace
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

    # Python: read pyproject.toml [tool.echohub] section
    pyproject_path = skill_dir / "pyproject.toml"
    if pyproject_path.exists():
        try:
            # tomllib available in Python 3.11+, fallback to manual parse
            try:
                import tomllib
                data = tomllib.loads(pyproject_path.read_text())
            except ImportError:
                import tomli  # type: ignore
                data = tomli.loads(pyproject_path.read_text())
            meta = (data.get("project") or {})
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


def _extract_author(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        return raw.get("name") or raw.get("email") or ""
    return ""


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


@router.get("/search")
def search_skills(q: str = "", force_refresh: bool = False) -> dict[str, Any]:
    """
    Search GitHub for skill repos.
    Empty query → broad search (echohub-skill OR mcp-server OR llm-tool topics).
    Results cached in DB for 24h. Cache is always returned if GitHub is unavailable.
    """
    import httpx
    from backend.services.db import get_skills_cache, set_skills_cache, get_skills_cache_age

    q = q.strip()
    cache_key = q or "__default__"
    installed_urls = {r["repo_url"] for r in _load_registry()}

    def _mark_installed(results: list[dict]) -> list[dict]:
        for res in results:
            res["installed"] = res["repo_url"] in installed_urls
        return results

    # Check cache first (unless force_refresh)
    if not force_refresh:
        cached = get_skills_cache(cache_key)
        if cached:
            age_s = get_skills_cache_age(cache_key) or 0
            return {
                "results": _mark_installed(cached["results"]),
                "total": cached["total"],
                "from_cache": True,
                "cache_age_h": round(age_s / 3600, 1),
                "authenticated": bool(os.getenv("GITHUB_TOKEN")),
            }

    # Build GitHub query
    # Empty query: broad search covering common skill/tool repo patterns
    if not q:
        github_query = "topic:echohub-skill OR topic:mcp-server OR topic:llm-tool"
    else:
        # User typed something: search by name/description, bias toward echohub-skill
        github_query = f"{q} topic:echohub-skill"

    headers: dict[str, str] = {"Accept": "application/vnd.github+json"}
    token = os.getenv("GITHUB_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
        rate_limit = 5000
    else:
        rate_limit = 60

    try:
        r = httpx.get(
            "https://api.github.com/search/repositories",
            params={"q": github_query, "sort": "stars", "order": "desc", "per_page": 30},
            headers=headers,
            timeout=10,
        )
        if r.status_code == 403:
            # Rate limited — return cache even if stale
            stale = get_skills_cache(cache_key) or get_skills_cache.__module__ and None
            stale_data = get_skills_cache(cache_key)
            if stale_data:
                return {
                    "results": _mark_installed(stale_data["results"]),
                    "total": stale_data["total"],
                    "from_cache": True,
                    "rate_limited": True,
                    "authenticated": bool(token),
                }
            return {"results": [], "total": 0, "rate_limited": True, "authenticated": bool(token)}

        r.raise_for_status()
        data = r.json()
        results = [
            {
                "id": item["full_name"].replace("/", "-").lower(),
                "name": item["name"],
                "full_name": item["full_name"],
                "description": item.get("description") or "",
                "stars": item.get("stargazers_count", 0),
                "author": item["owner"]["login"],
                "repo_url": item["clone_url"],
                "html_url": item["html_url"],
                "topics": item.get("topics", []),
                "updated_at": item.get("updated_at", ""),
                "language": item.get("language"),
            }
            for item in data.get("items", [])
        ]
        total = data.get("total_count", 0)

        # Persist to cache
        set_skills_cache(cache_key, results, total)

        return {
            "results": _mark_installed(results),
            "total": total,
            "from_cache": False,
            "authenticated": bool(token),
            "rate_limit": rate_limit,
            "rate_limited": False,
        }

    except httpx.TimeoutException:
        # Network failure — return stale cache if available
        stale = get_skills_cache(cache_key)
        if stale:
            return {
                "results": _mark_installed(stale["results"]),
                "total": stale["total"],
                "from_cache": True,
                "error": "GitHub timed out — showing cached results",
                "authenticated": bool(token),
            }
        return {"results": [], "total": 0, "error": "GitHub API timed out", "authenticated": bool(token)}

    except Exception as e:
        logger.error(f"[skills] search error: {e}")
        stale = get_skills_cache(cache_key)
        if stale:
            return {
                "results": _mark_installed(stale["results"]),
                "total": stale["total"],
                "from_cache": True,
                "error": str(e),
                "authenticated": bool(token),
            }
        return {"results": [], "total": 0, "error": str(e), "authenticated": bool(token)}


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
