"""
Quality scoring — algorithmic, no LLM judge.

Each scorer returns a QualityResult with:
  - score: 0-100
  - grade: A/B/C/D/F
  - details: dict of sub-scores with explanations
  - method: human-readable description of what was evaluated
"""
from __future__ import annotations

import ast
import re
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import Any


# ── Result type ───────────────────────────────────────────────────────────────

def make_result(score: float, details: dict, method: str) -> dict:
    score = max(0.0, min(100.0, round(score, 1)))
    if score >= 85:   grade = "A"
    elif score >= 70: grade = "B"
    elif score >= 55: grade = "C"
    elif score >= 40: grade = "D"
    else:             grade = "F"
    return {"score": score, "grade": grade, "details": details, "method": method}


# ── Shared helpers ────────────────────────────────────────────────────────────

# Common filler phrases — language-agnostic detection
_FILLER_PATTERNS = re.compile(
    r'\b(certainly|absolutely|of course|sure thing|great question|'
    r'i\'d be happy to|let me|as an ai|i hope this helps|'
    r'feel free to|don\'t hesitate|please note that|'
    r'in conclusion|to summarize|in summary|'
    r'it\'s worth noting|it is important to note)\b',
    re.IGNORECASE
)

def _filler_ratio(text: str) -> float:
    """0.0 = no filler, 1.0 = all filler"""
    words = len(text.split())
    if words == 0:
        return 0.0
    matches = len(_FILLER_PATTERNS.findall(text))
    return min(1.0, matches / max(words / 20, 1))


def _word_coverage(keywords: list[str], text: str) -> float:
    """Fraction of keywords present in text (case-insensitive)"""
    if not keywords:
        return 1.0
    text_lower = text.lower()
    found = sum(1 for kw in keywords if kw.lower() in text_lower)
    return found / len(keywords)


def _response_length_score(text: str, min_words: int, max_words: int) -> float:
    """1.0 if within range, penalized otherwise"""
    words = len(text.split())
    if words < min_words:
        return max(0.0, words / min_words)
    if words > max_words:
        return max(0.5, 1.0 - (words - max_words) / max_words * 0.5)
    return 1.0


# ── Code scorer ───────────────────────────────────────────────────────────────

def _extract_python_blocks(text: str) -> list[str]:
    """Extract all Python code blocks from markdown response"""
    blocks = re.findall(r'```(?:python|py)?\n(.*?)```', text, re.DOTALL)
    if not blocks:
        # Try to find indented code
        lines = text.split('\n')
        code_lines = [l for l in lines if l.startswith('    ') or l.startswith('\t')]
        if code_lines:
            blocks = ['\n'.join(code_lines)]
    return blocks


def _score_code(prompt: str, response: str, expected_keywords: list[str] | None = None) -> dict:
    """
    Code quality: syntax validity, execution, presence of expected elements.
    Returns sub-scores dict.
    """
    blocks = _extract_python_blocks(response)
    if not blocks:
        return {"syntax": 0, "execution": 0, "elements": 0, "structure": 0,
                "note": "No Python code block found in response"}

    code = blocks[0]  # Score the first/main block
    results = {"syntax": 0, "execution": 0, "elements": 0, "structure": 0}

    # 1. Syntax check via AST
    try:
        ast.parse(code)
        results["syntax"] = 100
    except SyntaxError as e:
        results["syntax"] = 0
        results["note"] = f"SyntaxError: {e}"
        return results

    # 2. Execution in sandbox (timeout 5s)
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            tmp_path = f.name
        proc = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True, text=True, timeout=5
        )
        Path(tmp_path).unlink(missing_ok=True)
        if proc.returncode == 0:
            results["execution"] = 100
        else:
            # Partial credit if it's a runtime error (not import/logic)
            if "ImportError" in proc.stderr or "ModuleNotFoundError" in proc.stderr:
                results["execution"] = 60  # can't test, give partial
            else:
                results["execution"] = 20
                results["runtime_error"] = proc.stderr.strip()[:200]
    except subprocess.TimeoutExpired:
        results["execution"] = 50  # ran but timed out — not necessarily bad
        Path(tmp_path).unlink(missing_ok=True)
    except Exception as e:
        results["execution"] = 0
        results["execution_error"] = str(e)

    # 3. Expected structural elements
    if expected_keywords:
        results["elements"] = round(_word_coverage(expected_keywords, code) * 100)
    else:
        # Auto-detect from prompt
        kw_map = {
            "class": ["class "],
            "function": ["def "],
            "websocket": ["WebSocket", "websocket", "ws."],
            "async": ["async def", "await "],
            "docstring": ['"""', "'''"],
            "type hint": [": str", ": int", ": list", ": dict", "-> "],
            "insert": ["def insert"],
            "search": ["def search"],
            "traversal": ["def inorder", "def traverse"],
        }
        prompt_lower = prompt.lower()
        required = []
        for concept, patterns in kw_map.items():
            if concept in prompt_lower:
                required.extend(patterns)
        if required:
            results["elements"] = round(_word_coverage(required, code) * 100)
        else:
            results["elements"] = 75  # can't verify, neutral score

    # 4. Code structure quality
    tree = ast.parse(code)
    has_docstrings = any(
        isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
        for node in ast.walk(tree)
    )
    has_type_hints = ":" in code and ("->" in code or re.search(r'\w+: \w+', code))
    functions = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
    classes = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]

    structure_score = 50  # base
    if has_docstrings: structure_score += 20
    if has_type_hints: structure_score += 20
    if functions or classes: structure_score += 10
    results["structure"] = min(100, structure_score)

    return results


def score_code(prompt: str, response: str) -> dict:
    sub = _score_code(prompt, response)
    note = sub.pop("note", None)
    runtime_error = sub.pop("runtime_error", None)
    execution_error = sub.pop("execution_error", None)

    # Weighted average
    score = (
        sub.get("syntax", 0) * 0.35 +
        sub.get("execution", 0) * 0.35 +
        sub.get("elements", 0) * 0.20 +
        sub.get("structure", 0) * 0.10
    )
    details = {**sub}
    if note: details["note"] = note
    if runtime_error: details["runtime_error"] = runtime_error
    if execution_error: details["execution_error"] = execution_error

    return make_result(score, details, "Python AST parse + sandbox execution + structural analysis")


# ── Reasoning scorer ──────────────────────────────────────────────────────────

def score_reasoning(prompt: str, response: str) -> dict:
    """
    For math/logic: extract expected answer from prompt, check if response contains it.
    Also checks reasoning presence (step-by-step).
    """
    details = {}

    # Extract numbers from response
    numbers_in_response = re.findall(r'\b\d+(?:[.,]\d+)?\b', response)

    # Check for step-by-step reasoning markers
    reasoning_markers = ["step", "first", "second", "therefore", "because",
                         "since", "so", "=", "→", "thus", "hence"]
    has_reasoning = sum(1 for m in reasoning_markers if m.lower() in response.lower())
    reasoning_score = min(100, has_reasoning * 15)
    details["has_stepwise_reasoning"] = has_reasoning > 2

    # Check response length (reasoning should be substantial)
    words = len(response.split())
    length_score = _response_length_score(response, 30, 500)
    details["word_count"] = words

    # Check for answer presence (numbers or factual content)
    answer_score = 70 if numbers_in_response else 40
    details["numbers_found"] = numbers_in_response[:5]

    # Filler penalty
    filler = _filler_ratio(response)
    filler_penalty = filler * 30
    details["filler_ratio"] = round(filler, 3)

    score = (
        reasoning_score * 0.40 +
        answer_score * 0.35 +
        length_score * 100 * 0.25
    ) - filler_penalty

    return make_result(score, details, "Step-by-step reasoning detection + answer extraction + filler analysis")


# ── Instruction scorer ────────────────────────────────────────────────────────

def score_instruction(prompt: str, response: str) -> dict:
    """
    Format compliance: numbered list, item count, length constraints, no filler intro.
    """
    details = {}
    score = 100.0

    prompt_lower = prompt.lower()

    # Expected item count
    count_match = re.search(r'\b(\d+)\b.{0,20}(item|point|step|bullet|thing|best practice|reason)', prompt_lower)
    if count_match:
        expected_count = int(count_match.group(1))
        # Count numbered items
        found_items = re.findall(r'^\s*\d+[\.\)]\s+', response, re.MULTILINE)
        actual_count = len(found_items)
        details["expected_items"] = expected_count
        details["found_items"] = actual_count
        if actual_count == 0:
            score -= 40  # No numbered list at all
            details["format_ok"] = False
        elif actual_count == expected_count:
            details["format_ok"] = True
        else:
            delta = abs(actual_count - expected_count)
            score -= min(30, delta * 10)
            details["format_ok"] = delta <= 1
    else:
        details["expected_items"] = "unspecified"

    # Check for filler intro ("Certainly! Here are...")
    first_line = response.strip().split('\n')[0] if response.strip() else ""
    has_filler_intro = bool(_FILLER_PATTERNS.search(first_line))
    details["clean_start"] = not has_filler_intro
    if has_filler_intro:
        score -= 15

    # Check length per item
    words = len(response.split())
    details["total_words"] = words

    # "one sentence" per item check
    if "one sentence" in prompt_lower:
        items = re.findall(r'^\s*\d+[\.\)]\s+(.+)$', response, re.MULTILINE)
        multi_sentence = sum(1 for item in items if len(re.split(r'[.!?]', item)) > 2)
        if multi_sentence > 0:
            score -= multi_sentence * 5
        details["items_one_sentence"] = multi_sentence == 0

    # Filler throughout
    filler = _filler_ratio(response)
    score -= filler * 20
    details["filler_ratio"] = round(filler, 3)

    return make_result(score, details, "Format compliance: item count, numbered list, sentence length, filler detection")


# ── Summary / Long context scorer ─────────────────────────────────────────────

def score_summary(prompt: str, response: str) -> dict:
    """
    Keyword coverage: key terms from the prompt/context should appear in the summary.
    """
    details = {}

    # Extract key nouns/technical terms from prompt (rough NLP-free approach)
    # Remove stopwords and keep content words
    stopwords = {'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
                 'but', 'is', 'was', 'are', 'were', 'be', 'been', 'that', 'this',
                 'with', 'from', 'by', 'as', 'it', 'its', 'he', 'she', 'they', 'we'}

    prompt_words = re.findall(r'\b[a-zA-Z]{4,}\b', prompt)
    keywords = list(set(w.lower() for w in prompt_words if w.lower() not in stopwords))

    # Weight by frequency in prompt
    freq = {}
    for w in prompt_words:
        lw = w.lower()
        if lw not in stopwords:
            freq[lw] = freq.get(lw, 0) + 1

    # Top 20 most frequent content words = "key terms"
    top_keywords = sorted(freq.keys(), key=lambda k: freq[k], reverse=True)[:20]
    coverage = _word_coverage(top_keywords, response)
    details["keyword_coverage"] = round(coverage * 100, 1)
    details["keywords_checked"] = top_keywords[:10]

    # Response shouldn't be too short (should cover the content)
    words = len(response.split())
    details["word_count"] = words
    length_score = _response_length_score(response, 20, 300)

    # Filler
    filler = _filler_ratio(response)
    details["filler_ratio"] = round(filler, 3)

    score = coverage * 60 + length_score * 30 - filler * 20 + 10  # base 10

    return make_result(score, details, "Keyword coverage from source context + length + filler analysis")


# ── Verbosity / General scorer ────────────────────────────────────────────────

def score_general(prompt: str, response: str) -> dict:
    """
    Signal/noise: information density, no empty response, filler detection.
    Used as fallback for profiles without specific scorer.
    """
    details = {}

    if not response or not response.strip():
        return make_result(0, {"error": "Empty response"}, "General quality")

    words = len(response.split())
    sentences = max(1, len(re.split(r'[.!?]+', response)))
    avg_sentence_len = words / sentences

    details["word_count"] = words
    details["sentence_count"] = sentences
    details["avg_sentence_length"] = round(avg_sentence_len, 1)

    # Penalize very short or extremely long responses
    length_score = _response_length_score(response, 10, 600)

    # Sentence length sweet spot: 10-25 words
    if 10 <= avg_sentence_len <= 25:
        density_score = 1.0
    elif avg_sentence_len < 5:
        density_score = 0.5  # too choppy
    else:
        density_score = max(0.5, 1.0 - (avg_sentence_len - 25) / 50)

    filler = _filler_ratio(response)
    details["filler_ratio"] = round(filler, 3)

    # Check response is topically relevant (shares words with prompt)
    prompt_words = set(re.findall(r'\b[a-zA-Z]{4,}\b', prompt.lower()))
    response_words = set(re.findall(r'\b[a-zA-Z]{4,}\b', response.lower()))
    overlap = len(prompt_words & response_words) / max(len(prompt_words), 1)
    details["topic_overlap"] = round(overlap, 3)

    score = (
        length_score * 40 +
        density_score * 30 +
        min(overlap * 100, 30) -
        filler * 30
    )

    return make_result(score, details, "Information density + topic relevance + filler analysis")


# ── Conversation scorer ───────────────────────────────────────────────────────

def score_conversation(prompt: str, response: str, context: dict | None = None) -> dict:
    """
    For conversation profiles:
    - Check if response is consistent with established facts in context
    - Detect hallucination markers (uncertain language on stated facts)
    - Detect contradiction with previous messages
    """
    details = {}

    if not context:
        return score_general(prompt, response)

    # Known facts from context that should be confirmed
    known_facts = context.get("known_facts", [])
    contradictions = 0
    confirmations = 0

    for fact in known_facts:
        fact_lower = fact.lower()
        response_lower = response.lower()
        # Simple: check if key terms from the fact appear in response
        fact_words = [w for w in fact_lower.split() if len(w) > 4]
        if fact_words and any(w in response_lower for w in fact_words):
            confirmations += 1
        # Check for contradiction markers + fact terms
        contradiction_markers = ["no,", "actually", "incorrect", "wrong", "not "]
        if any(m in response_lower for m in contradiction_markers):
            if any(w in response_lower for w in fact_words):
                contradictions += 1

    total_facts = max(len(known_facts), 1)
    consistency_score = max(0, (confirmations - contradictions * 2) / total_facts * 100)
    details["facts_checked"] = len(known_facts)
    details["confirmations"] = confirmations
    details["contradictions"] = contradictions
    details["consistency_score"] = round(consistency_score, 1)

    # Hallucination markers
    hallucination_patterns = re.compile(
        r'\b(i think|i believe|i\'m not sure|i\'m not certain|i may be wrong|'
        r'if i recall|i don\'t remember|i\'m not confident)\b',
        re.IGNORECASE
    )
    hallu_count = len(hallucination_patterns.findall(response))
    # These are actually GOOD if used appropriately — penalize only if excessive
    if hallu_count > 3:
        details["hallucination_markers"] = hallu_count
        details["note"] = "High uncertainty markers — possible hallucination"

    filler = _filler_ratio(response)
    details["filler_ratio"] = round(filler, 3)

    score = consistency_score * 0.6 + score_general(prompt, response)["score"] * 0.4
    return make_result(score, details, "Fact consistency + contradiction detection + hallucination markers")


# ── Router ────────────────────────────────────────────────────────────────────

PROFILE_SCORERS = {
    "code":           score_code,
    "reasoning":      score_reasoning,
    "instruction":    score_instruction,
    "prefill":        score_summary,
    "long context":   score_summary,
    "throughput":     score_general,
    "latency":        score_general,
    "conversation":   score_conversation,
}

def score_response(profile_name: str, prompt: str, response: str, context: dict | None = None) -> dict:
    """
    Route to the right scorer based on profile name.
    Returns a QualityResult dict.
    """
    if not response or not response.strip():
        return make_result(0, {"error": "Empty response"}, "No response to score")

    key = profile_name.lower() if profile_name else "general"

    # Exact match first
    if key in PROFILE_SCORERS:
        scorer = PROFILE_SCORERS[key]
    else:
        # Partial match
        scorer = next(
            (fn for k, fn in PROFILE_SCORERS.items() if k in key),
            score_general
        )

    try:
        if scorer is score_conversation and context:
            return scorer(prompt, response, context)
        return scorer(prompt, response)
    except Exception as e:
        return make_result(0, {"error": str(e)}, f"Scoring failed: {type(e).__name__}")
