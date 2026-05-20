"""
skills_discover.py — Search + analyze routes for community skills.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from loguru import logger

from backend.routers.skills_helpers import _load_registry

router = APIRouter(prefix="/skills", tags=["skills"])


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

    # Build GitHub query — GitHub API only supports OR between full qualifier expressions,
    # mixing stars: with OR-ed topics causes 422. Use plain keyword search instead.
    # Filter to focused MCP servers (size < 5000KB excludes platforms like n8n).
    # Compatible with Claude Code MCP format = compatible with EchoHub.
    if not q:
        github_query = "topic:mcp-server size:<5000 stars:>5 fork:false"
    else:
        github_query = f"{q} topic:mcp-server size:<5000 fork:false"

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
        # Parse rate limit headers (always present even on success)
        rl_remaining = int(r.headers.get("X-RateLimit-Remaining", -1))
        rl_limit = int(r.headers.get("X-RateLimit-Limit", rate_limit))
        rl_reset = int(r.headers.get("X-RateLimit-Reset", 0))  # unix timestamp

        if r.status_code == 403:
            stale_data = get_skills_cache(cache_key)
            base = {"rate_limited": True, "authenticated": bool(token), "rl_remaining": 0, "rl_limit": rl_limit, "rl_reset": rl_reset}
            if stale_data:
                return {**base, "results": _mark_installed(stale_data["results"]), "total": stale_data["total"], "from_cache": True}
            return {**base, "results": [], "total": 0}

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
        set_skills_cache(cache_key, results, total)

        return {
            "results": _mark_installed(results),
            "total": total,
            "from_cache": False,
            "authenticated": bool(token),
            "rate_limited": False,
            "rl_remaining": rl_remaining,
            "rl_limit": rl_limit,
            "rl_reset": rl_reset,
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


@router.post("/{skill_id}/analyze")
async def analyze_skill(skill_id: str) -> StreamingResponse:
    """
    Use the loaded model to analyze a skill. Streams tokens live as SSE, then
    emits a final DONE event with the parsed result.
    Events:
      data: {"type": "log", "msg": "..."}       — progress messages
      data: {"type": "token", "content": "..."}  — live model tokens
      data: {"type": "done", "result": {...}}    — final parsed result
      data: {"type": "error", "message": "..."}  — on failure
    """
    from backend.services import engine_router

    if engine_router.get_status() is None:
        async def _err():
            yield f'data: {json.dumps({"type":"error","message":"No model loaded. Load a model first."})}\n\n'
        return StreamingResponse(_err(), media_type="text/event-stream",
                                 headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)

    async def _stream():
        import re as _re

        def sse(obj: dict) -> str:
            return f"data: {json.dumps(obj)}\n\n"

        if not entry:
            yield sse({"type":"error","message":f"Skill '{skill_id}' not found"})
            return

        skill_dir = Path(entry["path"])
        if not skill_dir.exists():
            yield sse({"type":"error","message":"Skill directory not found on disk"})
            return

        # ── Collect context ───────────────────────────────────────────────────
        yield sse({"type":"log","msg":f"Scanning skill directory: {skill_dir}"})

        def _read_safe(path: Path, max_chars: int = 3000) -> str:
            try:
                return path.read_text(errors="replace")[:max_chars]
            except Exception:
                return ""

        context_parts: list[str] = []
        seen: set[str] = set()

        # 1. Always include package.json / pyproject.toml first (tool manifest)
        for fname in ["package.json", "pyproject.toml", "setup.py"]:
            p = skill_dir / fname
            if p.exists():
                content = _read_safe(p, 4000)
                if content.strip():
                    context_parts.append(f"=== {fname} ===\n{content}")
                    seen.add(fname)

        # 2. MCP-specific files — highest signal
        mcp_patterns = [
            "src/app/api/mcp/route.ts", "src/app/api/mcp/server.ts",
            "src/libs/mcp-server/index.ts", "src/libs/mcp-server/streamableHttp.ts",
            "mcp.json", ".mcp.json", "src/mcp.ts", "mcp_server.py", "server.py",
        ]
        for fname in mcp_patterns:
            p = skill_dir / fname
            if p.exists() and p.name not in seen:
                content = _read_safe(p, 3000)
                if content.strip():
                    context_parts.append(f"=== {fname} ===\n{content}")
                    seen.add(p.name)

        # 3. README for general description
        for fname in ["README.md", "README.rst"]:
            p = skill_dir / fname
            if p.exists() and p.name not in seen:
                content = _read_safe(p, 2000)
                if content.strip():
                    context_parts.append(f"=== {fname} ===\n{content}")
                    seen.add(p.name)

        # 4. Scan all TS/JS/PY for MCP patterns (max 5 extra files)
        mcp_source_patterns = [
            r"StreamableHTTPServerTransport", r"McpServer|createMcpServer",
            r"server\.tool\(", r"setRequestHandler", r"from.*@modelcontextprotocol",
            r"FastMCP", r"mcp\.server",
        ]
        extras = 0
        for p in sorted(skill_dir.rglob("*.ts")) + sorted(skill_dir.rglob("*.py")):
            if extras >= 5:
                break
            if "node_modules" in str(p) or ".git" in str(p) or p.name in seen:
                continue
            try:
                txt = p.read_text(errors="ignore")
                if any(_re.search(pat, txt) for pat in mcp_source_patterns):
                    content = txt[:2500]
                    context_parts.append(f"=== {p.relative_to(skill_dir)} ===\n{content}")
                    seen.add(p.name)
                    extras += 1
            except Exception:
                pass

        if not context_parts:
            yield sse({"type":"error","message":"No readable source files found in skill directory"})
            return

        full_context = "\n\n".join(context_parts)
        if len(full_context) > 12000:
            full_context = full_context[:12000] + "\n\n[... truncated ...]"

        yield sse({"type":"log","msg":f"Loaded {len(context_parts)} file(s), {len(full_context)} chars of context"})
        yield sse({"type":"log","msg":"Sending to model for analysis..."})

        # ── Build prompt ──────────────────────────────────────────────────────
        prompt = f"""Analyze this software skill to configure it for an AI assistant called EchoHub.

Skill: {entry.get('name', skill_id)}
Description: {entry.get('description', '')}

Source files:
{full_context}

Answer these questions:
1. What tool function names does this skill expose for an AI model to call?
2. Write a concise awareness block (≤80 tokens) telling the model how/when to use these tools.
3. Is this an MCP (Model Context Protocol) server? Signs: StreamableHTTPServerTransport, McpServer class, server.tool() registrations, /api/mcp routes, @modelcontextprotocol imports, FastMCP usage.
4. If MCP, what command starts it? (from package.json scripts.start or main entry). What transport: "http" or "stdio"?

Respond ONLY with this exact JSON, no explanation, no markdown:
{{"tools":["tool_name"],"awareness":"Brief description for the model.","is_mcp":true,"mcp_start_command":"bun run start","mcp_transport":"http"}}"""

        messages = [{"role": "user", "content": prompt}]
        accumulated = ""
        _in_think = False  # suppress <think>...</think> blocks from token display

        # ── Stream model tokens ───────────────────────────────────────────────
        try:
            async for chunk in engine_router.generate(
                messages=messages, temperature=0.1, max_tokens=512, stream=True,
            ):
                if not isinstance(chunk, str):
                    continue
                for line in chunk.splitlines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        continue
                    try:
                        parsed = json.loads(raw)
                        delta = parsed.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if not delta:
                            continue
                        accumulated += delta
                        # Track think blocks — don't stream them to frontend
                        if "<think>" in delta:
                            _in_think = True
                        if "</think>" in delta:
                            _in_think = False
                            continue
                        if not _in_think:
                            yield sse({"type":"token","content":delta})
                    except (json.JSONDecodeError, IndexError, KeyError):
                        pass
        except Exception as e:
            yield sse({"type":"error","message":f"Model generation failed: {e}"})
            return

        yield sse({"type":"log","msg":"Parsing result..."})

        # ── Parse JSON ────────────────────────────────────────────────────────
        text = accumulated.strip()
        if "```" in text:
            m = _re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, _re.DOTALL)
            if m:
                text = m.group(1)

        m = _re.search(r"\{.*\}", text, _re.DOTALL)
        if not m:
            yield sse({"type":"error","message":f"Model did not return valid JSON. Got: {accumulated[:200]}"})
            return

        try:
            result = json.loads(m.group())
        except json.JSONDecodeError as e:
            yield sse({"type":"error","message":f"JSON parse error: {e}"})
            return

        tools = result.get("tools", [])
        if not isinstance(tools, list):
            tools = []
        tools = [str(t).strip() for t in tools if t]

        awareness = str(result.get("awareness", ""))
        is_mcp: bool = bool(result.get("is_mcp", False))
        mcp_start_command: str | None = result.get("mcp_start_command") or None
        mcp_transport: str | None = result.get("mcp_transport") or None
        if mcp_transport not in ("http", "stdio"):
            mcp_transport = None

        model_id = engine_router.get_status().id if engine_router.get_status() else "unknown"
        yield sse({"type":"done","result":{
            "skill_id": skill_id,
            "suggested_tools": tools,
            "suggested_awareness": awareness,
            "is_mcp": is_mcp,
            "mcp_start_command": mcp_start_command,
            "mcp_transport": mcp_transport,
            "model_used": model_id,
        }})

    return StreamingResponse(
        _stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
