#!/usr/bin/env python3
"""
EchoHub code standards linter.
Enforces: file size, function size, line length, type hints, try/catch, naming, no-any.
"""
from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

MAX_FILE_LINES   = 500
MAX_FN_LINES     = 35
MAX_LINE_CHARS   = 120

PROJECT_ROOT = Path(__file__).resolve().parents[1]

SKIP_DIRS = {
    "__pycache__", ".venv", ".venv-vllm", "node_modules", "target",
    ".git", "dist", "build", ".cache", "migrations",
}

# External call patterns that require try/catch (Python)
EXTERNAL_CALL_PATTERNS = [
    r"\brequests\.\w+\(",
    r"\bhttpx\.\w+\(",
    r"\baiohttp\.\w+\(",
    r"\.execute\(",          # DB
    r"\.fetchone\(",
    r"\.fetchall\(",
    r"\bopen\(",             # filesystem
    r"\bsubprocess\.",
    r"\bPath\(.*\)\.(read|write|unlink|mkdir)",
]

# ── Data ──────────────────────────────────────────────────────────────────────

@dataclass
class Violation:
    file: str
    line: int
    rule: str
    severity: str          # "error" | "warning"
    message: str
    snippet: str = ""

    def fmt(self) -> str:
        sev = "❌" if self.severity == "error" else "⚠️ "
        loc = f"{self.file}:{self.line}"
        snip = f"\n    {self.snippet}" if self.snippet else ""
        return f"{sev} [{self.rule}] {loc} — {self.message}{snip}"


@dataclass
class LintResult:
    files_checked: int = 0
    violations: list[Violation] = field(default_factory=list)

    @property
    def errors(self) -> list[Violation]:
        return [v for v in self.violations if v.severity == "error"]

    @property
    def warnings(self) -> list[Violation]:
        return [v for v in self.violations if v.severity == "warning"]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _read(path: Path) -> list[str] | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None


def _snippet(lines: list[str], lineno: int) -> str:
    idx = lineno - 1
    if 0 <= idx < len(lines):
        return lines[idx].strip()[:100]
    return ""


# ── Python linter ─────────────────────────────────────────────────────────────

def _lint_python(path: Path, result: LintResult) -> None:
    lines = _read(path)
    if lines is None:
        return
    rel = str(path.relative_to(PROJECT_ROOT))

    # File length
    if len(lines) > MAX_FILE_LINES:
        result.violations.append(Violation(
            rel, 1, "file-too-long", "error",
            f"{len(lines)} lines — max {MAX_FILE_LINES}. Split into modules.",
        ))

    # Line length
    for i, line in enumerate(lines, 1):
        if len(line) > MAX_LINE_CHARS:
            result.violations.append(Violation(
                rel, i, "line-too-long", "warning",
                f"{len(line)} chars — max {MAX_LINE_CHARS}.",
                line.strip()[:80] + "…",
            ))

    # AST analysis
    try:
        tree = ast.parse("\n".join(lines), filename=str(path))
    except SyntaxError as e:
        result.violations.append(Violation(
            rel, e.lineno or 1, "syntax-error", "error",
            str(e.msg),
        ))
        return

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        fn_name = node.name
        start = node.lineno
        end = node.end_lineno or start
        fn_lines = end - start + 1

        # Function length
        if fn_lines > MAX_FN_LINES:
            result.violations.append(Violation(
                rel, start, "fn-too-long", "error",
                f"`{fn_name}` — {fn_lines} lines, max {MAX_FN_LINES}. Extract helpers.",
                _snippet(lines, start),
            ))

        # Type hints on public functions
        if not fn_name.startswith("_"):
            missing_hints = []
            for arg in node.args.args:
                if arg.arg == "self":
                    continue
                if arg.annotation is None:
                    missing_hints.append(arg.arg)
            if missing_hints:
                result.violations.append(Violation(
                    rel, start, "missing-type-hints", "warning",
                    f"`{fn_name}` — params without hints: {', '.join(missing_hints)}",
                    _snippet(lines, start),
                ))
            if node.returns is None and fn_name not in ("__init__", "__str__", "__repr__"):
                result.violations.append(Violation(
                    rel, start, "missing-return-type", "warning",
                    f"`{fn_name}` — missing return type annotation.",
                    _snippet(lines, start),
                ))

        # try/catch on external calls
        fn_body_lines = lines[start - 1: end]
        fn_body = "\n".join(fn_body_lines)
        has_external = any(re.search(p, fn_body) for p in EXTERNAL_CALL_PATTERNS)
        has_try = "try:" in fn_body or "except " in fn_body
        if has_external and not has_try:
            result.violations.append(Violation(
                rel, start, "missing-try-catch", "error",
                f"`{fn_name}` — external call without try/except.",
                _snippet(lines, start),
            ))

        # Bare except
        for child in ast.walk(node):
            if isinstance(child, ast.ExceptHandler) and child.type is None:
                result.violations.append(Violation(
                    rel, child.lineno, "bare-except", "warning",
                    "Bare `except:` — catch specific exceptions.",
                ))


# ── TypeScript linter ─────────────────────────────────────────────────────────

_TS_FN_RE = re.compile(
    r"^(?P<indent>\s*)"
    r"(?:export\s+)?(?:async\s+)?(?:function\s+(?P<fname>\w+)|"
    r"(?:const|let)\s+(?P<cname>\w+)\s*=\s*(?:async\s*)?\(|"
    r"(?P<method>\w+)\s*\()",
    re.MULTILINE,
)

_TS_ANY_RE   = re.compile(r":\s*any\b|as\s+any\b|<any>")
_TS_CONSOLE  = re.compile(r"\bconsole\.(log|warn|error|debug)\(")
_TS_NOTYPE   = re.compile(r"^(?!.*\/\/).*\)\s*\{")   # func without return type
_TS_ARROW_NO_RT = re.compile(r"=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{")


def _count_ts_function_lines(lines: list[str], start_idx: int) -> int:
    """Count lines of a TS function starting at start_idx (0-based) by brace matching."""
    depth = 0
    for i in range(start_idx, min(start_idx + MAX_FN_LINES * 3, len(lines))):
        depth += lines[i].count("{") - lines[i].count("}")
        if i > start_idx and depth <= 0:
            return i - start_idx + 1
    return MAX_FN_LINES * 3


def _lint_typescript(path: Path, result: LintResult) -> None:
    lines = _read(path)
    if lines is None:
        return
    rel = str(path.relative_to(PROJECT_ROOT))
    text = "\n".join(lines)

    # File length
    if len(lines) > MAX_FILE_LINES:
        result.violations.append(Violation(
            rel, 1, "file-too-long", "error",
            f"{len(lines)} lines — max {MAX_FILE_LINES}. Split component/hook/service.",
        ))

    # Line length
    for i, line in enumerate(lines, 1):
        if len(line) > MAX_LINE_CHARS:
            result.violations.append(Violation(
                rel, i, "line-too-long", "warning",
                f"{len(line)} chars — max {MAX_LINE_CHARS}.",
                line.strip()[:80] + "…",
            ))

    # any usage
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        if _TS_ANY_RE.search(line):
            result.violations.append(Violation(
                rel, i, "no-any", "error",
                "Use of `any` — use specific type or `unknown` + narrowing.",
                stripped[:80],
            ))

    # console.log
    for i, line in enumerate(lines, 1):
        if _TS_CONSOLE.search(line) and "//" not in line.split("console")[0]:
            result.violations.append(Violation(
                rel, i, "no-console", "warning",
                "console.log left in code.",
                line.strip()[:80],
            ))

    # Function length — scan for function starts
    fn_starts: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        # Named function
        m = re.match(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(", stripped)
        if m:
            fn_starts.append((i, m.group(1)))
            continue
        # Arrow function assigned to const
        m = re.match(r"(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(", stripped)
        if m and "=>" in "".join(lines[i:i+5]):
            fn_starts.append((i, m.group(1)))
            continue
        # Class method
        m = re.match(r"(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\S+\s*)?\{", stripped)
        if m and m.group(1) not in ("if", "for", "while", "switch", "catch"):
            fn_starts.append((i, m.group(1)))

    seen_fns: set[tuple[int, str]] = set()
    for idx, fname in fn_starts:
        key = (idx, fname)
        if key in seen_fns:
            continue
        seen_fns.add(key)
        fn_len = _count_ts_function_lines(lines, idx)
        if fn_len > MAX_FN_LINES:
            result.violations.append(Violation(
                rel, idx + 1, "fn-too-long", "error",
                f"`{fname}` — ~{fn_len} lines, max {MAX_FN_LINES}. Extract helpers.",
                lines[idx].strip()[:80],
            ))


# ── File walker ───────────────────────────────────────────────────────────────

def _should_skip(path: Path) -> bool:
    for part in path.parts:
        if part in SKIP_DIRS:
            return True
    return False


def lint_path(target: Path, result: LintResult) -> None:
    if target.is_file():
        _lint_file(target, result)
    elif target.is_dir():
        for p in sorted(target.rglob("*")):
            if p.is_file() and not _should_skip(p):
                _lint_file(p, result)


def _lint_file(path: Path, result: LintResult) -> None:
    if path.suffix == ".py":
        result.files_checked += 1
        _lint_python(path, result)
    elif path.suffix in (".ts", ".tsx"):
        result.files_checked += 1
        _lint_typescript(path, result)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    args = sys.argv[1:]

    if not args:
        targets = [
            PROJECT_ROOT / "backend",
            PROJECT_ROOT / "frontend" / "src",
        ]
    else:
        targets = [PROJECT_ROOT / a if not Path(a).is_absolute() else Path(a) for a in args]

    result = LintResult()
    for t in targets:
        if not t.exists():
            print(f"Path not found: {t}", file=sys.stderr)
            continue
        lint_path(t, result)

    # Print violations grouped by file
    by_file: dict[str, list[Violation]] = {}
    for v in result.violations:
        by_file.setdefault(v.file, []).append(v)

    for fpath, viols in sorted(by_file.items()):
        print(f"\n{fpath}")
        for v in sorted(viols, key=lambda x: x.line):
            print(f"  {v.fmt()}")

    # Summary
    e, w = len(result.errors), len(result.warnings)
    total = e + w
    print(f"\n{'─' * 60}")
    print(f"Checked {result.files_checked} files — {total} violations ({e} errors, {w} warnings)")

    if e == 0 and w == 0:
        print("✅ All clear.")
    elif e == 0:
        print("⚠️  Warnings only — no blockers.")
    else:
        print(f"❌ {e} error(s) must be fixed.")

    return 1 if e > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
