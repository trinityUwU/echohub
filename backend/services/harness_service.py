"""
Universal validation harness — intercepts every file mutation from sub-agents.
Pipeline: language detection → syntax → lint → types → result normalizer.
Each layer runs in an isolated subprocess with timeout.
"""
from __future__ import annotations

import ast
import json
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from loguru import logger

Overall = Literal["ok", "warning", "error", "fatal"]

_TIMEOUT = 10  # seconds per layer


@dataclass
class LayerResult:
    ok: bool
    errors: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)

    def skipped(self) -> bool:
        return self.ok and not self.errors and not self.warnings


@dataclass
class HarnessResult:
    file: str
    language: str
    syntax: LayerResult
    lint: LayerResult
    types: LayerResult
    overall: Overall
    actionable: list[str]

    def to_dict(self) -> dict:
        return {
            "file": self.file,
            "language": self.language,
            "layers": {
                "syntax": {"ok": self.syntax.ok, "errors": self.syntax.errors},
                "lint": {"ok": self.lint.ok, "warnings": self.lint.warnings},
                "types": {"ok": self.types.ok, "errors": self.types.errors},
            },
            "overall": self.overall,
            "actionable": self.actionable,
        }

    def to_agent_feedback(self) -> str:
        if self.overall == "ok":
            return f"[harness] {self.file}: OK"
        lines = [f"[harness] {self.file} — {self.overall.upper()}"]
        for a in self.actionable:
            lines.append(f"  {a}")
        return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────────
# Language detection
# ──────────────────────────────────────────────────────────────────────────────

_EXT_MAP: dict[str, str] = {
    ".py": "python",
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".rs": "rust",
    ".go": "go",
    ".sh": "bash", ".bash": "bash",
    ".c": "c", ".cpp": "cpp", ".cc": "cpp",
    ".json": "json",
    ".md": "markdown",
}


def detect_language(path: str, content: str | None = None) -> str:
    ext = Path(path).suffix.lower()
    if ext in _EXT_MAP:
        return _EXT_MAP[ext]
    if content:
        first = content.lstrip()[:50]
        if first.startswith("#!/usr/bin/env python") or first.startswith("#!/usr/bin/python"):
            return "python"
        if first.startswith("#!/bin/bash") or first.startswith("#!/bin/sh"):
            return "bash"
    return "unknown"


# ──────────────────────────────────────────────────────────────────────────────
# Layers
# ──────────────────────────────────────────────────────────────────────────────

def _run(cmd: list[str], cwd: str | None = None) -> tuple[int, str, str]:
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=_TIMEOUT, cwd=cwd
        )
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"timeout after {_TIMEOUT}s"
    except FileNotFoundError:
        return -1, "", f"command not found: {cmd[0]}"


def _syntax_python(content: str) -> LayerResult:
    try:
        ast.parse(content)
        return LayerResult(ok=True)
    except SyntaxError as e:
        return LayerResult(ok=False, errors=[{
            "line": e.lineno or 0,
            "msg": str(e.msg),
            "severity": "fatal",
        }])


def _syntax_typescript(content: str, path: str) -> LayerResult:
    # Write to temp file and run tsc --noEmit --allowJs on it
    with tempfile.NamedTemporaryFile(suffix=Path(path).suffix, mode="w", delete=False) as f:
        f.write(content)
        tmp = f.name
    try:
        tsc = _find_tsc()
        if not tsc:
            return LayerResult(ok=True)  # skip if no tsc
        code, out, err = _run([tsc, "--noEmit", "--allowJs", "--skipLibCheck", tmp])
        if code == 0:
            return LayerResult(ok=True)
        errors = []
        for line in (out + err).splitlines():
            if ": error TS" in line:
                errors.append({"line": 0, "msg": line.strip(), "severity": "error"})
        return LayerResult(ok=False, errors=errors) if errors else LayerResult(ok=True)
    finally:
        Path(tmp).unlink(missing_ok=True)


def _lint_python(content: str, path: str) -> LayerResult:
    ruff = _find_ruff()
    if not ruff:
        return LayerResult(ok=True)
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write(content)
        tmp = f.name
    try:
        code, out, err = _run([ruff, "check", "--output-format=json", tmp])
        if code == 0:
            return LayerResult(ok=True)
        try:
            issues = json.loads(out) if out.strip() else []
        except (json.JSONDecodeError, ValueError):
            return LayerResult(ok=True)
        warnings = []
        errors = []
        for issue in issues:
            item = {
                "line": issue.get("location", {}).get("row", 0),
                "rule": issue.get("code", ""),
                "msg": issue.get("message", ""),
                "severity": "error" if issue.get("code", "").startswith("E") else "warning",
            }
            if item["severity"] == "error":
                errors.append(item)
            else:
                warnings.append(item)
        return LayerResult(ok=not errors, warnings=warnings, errors=errors)
    finally:
        Path(tmp).unlink(missing_ok=True)


def _lint_typescript(content: str, path: str) -> LayerResult:
    # Lightweight: check for obvious patterns only (no eslint dependency)
    warnings = []
    for i, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if ": any" in stripped or "as any" in stripped:
            warnings.append({"line": i, "rule": "no-any", "msg": "Avoid `any` type", "severity": "warning"})
        if "console.log(" in stripped:
            warnings.append({"line": i, "rule": "no-console", "msg": "console.log left in code", "severity": "warning"})
    return LayerResult(ok=True, warnings=warnings)


def _types_typescript(content: str, path: str) -> LayerResult:
    # Reuse tsc output (already done in syntax) — skip to avoid double run
    return LayerResult(ok=True)


# ──────────────────────────────────────────────────────────────────────────────
# Tool finders (cached)
# ──────────────────────────────────────────────────────────────────────────────

_ruff_path: str | None = None
_tsc_path: str | None = None


def _find_ruff() -> str | None:
    global _ruff_path
    if _ruff_path is not None:
        return _ruff_path or None
    for candidate in [
        "/mnt/projects/echohub/backend/.venv/bin/ruff",
        "ruff",
    ]:
        code, _, _ = _run([candidate, "--version"])
        if code == 0:
            _ruff_path = candidate
            return candidate
    _ruff_path = ""
    return None


def _find_tsc() -> str | None:
    global _tsc_path
    if _tsc_path is not None:
        return _tsc_path or None
    for candidate in [
        "/mnt/projects/echohub/frontend/node_modules/.bin/tsc",
        "tsc",
    ]:
        code, _, _ = _run([candidate, "--version"])
        if code == 0:
            _tsc_path = candidate
            return candidate
    _tsc_path = ""
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Main entry point
# ──────────────────────────────────────────────────────────────────────────────

def _run_layers(lang: str, content: str, path: str) -> tuple[LayerResult, LayerResult, LayerResult]:
    """Run syntax + lint + types layers for a given language."""
    syntax = LayerResult(ok=True)
    lint = LayerResult(ok=True)
    types = LayerResult(ok=True)

    if lang == "python":
        syntax = _syntax_python(content)
        if syntax.ok:
            lint = _lint_python(content, path)
    elif lang in ("typescript", "javascript"):
        syntax = _syntax_typescript(content, path)
        lint = _lint_typescript(content, path)
    elif lang == "json":
        try:
            json.loads(content)
        except (json.JSONDecodeError, ValueError) as e:
            syntax = LayerResult(ok=False, errors=[{"line": 0, "msg": str(e), "severity": "fatal"}])

    return syntax, lint, types


def _compute_overall(
    syntax: LayerResult, lint: LayerResult, types: LayerResult
) -> tuple[Overall, list[str]]:
    """Compute overall severity and actionable messages from layer results."""
    all_errors = syntax.errors + lint.errors + types.errors
    all_warnings = syntax.warnings + lint.warnings + types.warnings

    if any(e.get("severity") == "fatal" for e in all_errors):
        overall: Overall = "fatal"
    elif not syntax.ok or not types.ok:
        overall = "error"
    elif not lint.ok or all_warnings:
        overall = "warning"
    else:
        overall = "ok"

    actionable: list[str] = []
    for e in all_errors:
        line = e.get("line", 0)
        prefix = f"line {line}: " if line else ""
        actionable.append(f"{prefix}{e.get('msg', '')} [{e.get('rule', e.get('severity', ''))}]")
    for w in all_warnings[:5]:
        line = w.get("line", 0)
        prefix = f"line {line}: " if line else ""
        actionable.append(f"{prefix}{w.get('msg', '')} [warning/{w.get('rule', '')}]")

    return overall, actionable


def validate_file(path: str, content: str) -> HarnessResult:
    """Run validation pipeline. Called synchronously after a sub-agent file mutation."""
    lang = detect_language(path, content)
    syntax, lint, types = _run_layers(lang, content, path)
    overall, actionable = _compute_overall(syntax, lint, types)
    result = HarnessResult(file=path, language=lang, syntax=syntax, lint=lint,
                           types=types, overall=overall, actionable=actionable)
    if overall != "ok":
        logger.debug("[harness] {} — {} — {} actionable items", path, overall, len(actionable))
    return result


def validate_and_format_for_agent(path: str, content: str) -> str:
    """Returns feedback string injected into sub-agent context after a file edit."""
    result = validate_file(path, content)
    return result.to_agent_feedback()
