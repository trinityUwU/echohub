import os
from pathlib import Path
from typing import Optional
from huggingface_hub import HfApi, hf_hub_download, snapshot_download, model_info as hf_model_info
from loguru import logger
from backend.models.schemas import ModelInfo, ModelCapabilities

def _get_models_dir() -> Path:
    try:
        from backend.services.config_service import get_models_dir
        return get_models_dir()
    except Exception:
        p = Path(os.getenv("MODELS_DIR", "/mnt/models/echohub"))
        p.mkdir(parents=True, exist_ok=True)
        return p

# Backward compat — use _get_models_dir() for all path operations
MODELS_DIR = Path(os.getenv("MODELS_DIR", "/mnt/models/echohub"))
_api = HfApi()


def _get_hf_token() -> Optional[str]:
    import os as _os
    return _os.getenv("HF_TOKEN") or None


def _read_local_tools_support(model_id: str) -> bool:
    """Check if downloaded model's tokenizer_config.json chat_template mentions tool/function_call."""
    import json
    tokenizer_path = _model_dir(model_id) / "tokenizer_config.json"
    if not tokenizer_path.exists():
        return False
    try:
        cfg = json.loads(tokenizer_path.read_text())
        template = cfg.get("chat_template", "")
        if not isinstance(template, str):
            return False
        template_lower = template.lower()
        return any(marker in template_lower for marker in ("tool", "function_call", "<tool_call>"))
    except Exception:
        return False


def _read_local_context_window(model_id: str) -> Optional[int]:
    """Read max_position_embeddings from downloaded model's config.json — ground truth."""
    import json
    config_path = _model_dir(model_id) / "config.json"
    if not config_path.exists():
        return None
    try:
        cfg = json.loads(config_path.read_text())
        for key in ("max_position_embeddings", "max_seq_len", "seq_length", "n_positions", "n_ctx"):
            val = cfg.get(key)
            if isinstance(val, (int, float)) and val > 0:
                return int(val)
    except Exception:
        pass
    return None


def _extract_context_window(model_id: str, tags: list[str], hf_info=None) -> Optional[int]:
    """Extract max context window. For downloaded models, reads config.json directly."""
    import re

    # Ground truth — local config.json always wins
    local = _read_local_context_window(model_id)
    if local is not None:
        return local

    # HF model card metadata
    if hf_info is not None:
        try:
            cfg = getattr(hf_info, "config", None) or {}
            for key in ("max_position_embeddings", "max_seq_len", "seq_length", "n_positions"):
                val = cfg.get(key)
                if isinstance(val, int) and val > 0:
                    return val
        except Exception:
            pass

    # Fallback: well-known families (conservative estimates)
    name = model_id.lower()
    known = {
        "qwen2.5-1.5b": 32768, "qwen2.5-3b": 32768, "qwen2.5-7b": 131072,
        "qwen2.5-14b": 131072, "qwen2.5-32b": 131072, "qwen2.5-72b": 131072,
        "qwen2-vl": 32768, "qwen2vl": 32768,
        "qwen3": 131072, "qwen2": 131072,
        "mistral": 32768, "mixtral": 32768,
        "llama-3": 131072, "llama3": 131072,
        "llama-2": 4096, "llama2": 4096,
        "gemma-2": 8192, "gemma2": 8192,
        "deepseek": 131072,
        "phi-3": 131072, "phi3": 131072,
        "internlm": 200000,
    }
    # Longest key match wins (more specific first)
    for key in sorted(known, key=len, reverse=True):
        if key in name:
            return known[key]

    for tag in tags:
        m = re.match(r'(?:context|ctx|seq)[_-]?(\d+)', tag.lower())
        if m:
            return int(m.group(1))

    return None


def _read_local_params_billion(model_id: str) -> Optional[float]:
    """Read num_parameters from local config.json if available."""
    import json
    config_path = _model_dir(model_id) / "config.json"
    if not config_path.exists():
        return None
    try:
        cfg = json.loads(config_path.read_text())
        # Some models expose total param count directly
        for key in ("num_parameters", "n_params", "total_params"):
            val = cfg.get(key)
            if isinstance(val, (int, float)) and val > 0:
                return round(val / 1e9, 2)
    except Exception:
        pass
    return None


def _extract_params_billion(model_id: str, tags: list[str]) -> Optional[float]:
    """Extract parameter count in billions from model name or HF tags.
    Returns TOTAL params (not active) — all experts are loaded into VRAM for MoE."""
    import re

    # Ground truth from local config.json
    local = _read_local_params_billion(model_id)
    if local is not None:
        return local

    name = model_id.lower()

    # MoE pattern: 30B-A3B → total=30 — all weights loaded even if only 3B active
    moe = re.search(r'(\d+(?:\.\d+)?)b[-_]a(\d+(?:\.\d+)?)b', name)
    if moe:
        return float(moe.group(1))  # total params, NOT active

    # Standard: 7B, 14B, 72B, 1.7B, 0.5B — exclure "4bit", "8bit" etc.
    m = re.search(r'[-_\s](\d+(?:\.\d+)?)b(?:[-_\s]|$|instruct|awq|gptq|chat|gguf|fp8|exl2)', name)
    if m and not re.search(r'\d+b(?:it)', name[m.start():m.end()+2]):
        return float(m.group(1))

    # Try HF safetensors metadata tag e.g. "7B", "14b"
    for tag in tags:
        t = tag.lower()
        mt = re.match(r'^(\d+(?:\.\d+)?)b$', t)
        if mt:
            return float(mt.group(1))

    return None


def _extract_active_params_billion(model_id: str) -> Optional[float]:
    """For MoE models, extract the ACTIVE params (e.g. 3B in 30B-A3B)."""
    import re
    name = model_id.lower()
    moe = re.search(r'(\d+(?:\.\d+)?)b[-_]a(\d+(?:\.\d+)?)b', name)
    if moe:
        return float(moe.group(2))
    return None


def _has_mtp_heuristic(model_id: str, tags: list[str]) -> bool:
    """Detect MTP support from HF tags or model name heuristic.

    On HF we don't have the local GGUF — detect by known families that ship MTP heads.
    Currently: Qwen3 and Gemma3 series.
    """
    name = model_id.lower()
    tags_lower = [t.lower() for t in tags]
    if "mtp" in tags_lower:
        return True
    return any(family in name for family in ("qwen3", "gemma3"))


def _is_moe(model_id: str, tags: list[str]) -> bool:
    """Detect MoE architecture from model name or tags."""
    import re
    name = model_id.lower()
    if re.search(r'\d+b[-_]a\d+(?:\.\d+)?b', name):
        return True
    if any(k in name for k in ['mixtral', 'moe', 'mixture', 'deepseek-v', 'deepseek-moe']):
        return True
    if any(t.lower() in ('moe', 'mixture-of-experts') for t in tags):
        return True
    return False


def _estimate_vram_gb(params_b: float, quantization: Optional[str]) -> float:
    """Estimate VRAM needed to load the model weights (sans KV cache)."""
    if quantization is None:
        return round(params_b * 2.1, 2)
    q = quantization.upper()
    if q == "AWQ":
        return round(params_b * 0.60, 2)
    if q == "GPTQ":
        return round(params_b * 0.65, 2)
    if q in ("FP8", "W8A16"):
        return round(params_b * 1.1, 2)
    if q in ("EXL2", "W4A16"):
        return round(params_b * 0.55, 2)
    if q == "BF16":
        return round(params_b * 2.1, 2)
    if q.startswith("GGUF"):
        return _estimate_vram_gb_gguf(params_b, q)
    return round(params_b * 2.1, 2)


def _detect_capabilities(tags: list[str], model_id: str) -> ModelCapabilities:
    """Detect model capabilities from HF tags and model name."""
    name_lower = model_id.lower()
    tags_lower = [t.lower() for t in tags]

    # Thinking détecté large : tags HF + noms connus + modèles qui pensent nativement
    # On active le toggle pour tout modèle susceptible de produire des <think> tags
    thinking = (
        "thinking" in tags_lower or "thinking" in name_lower
        or "reasoning" in name_lower or "reasoning" in tags_lower
        or "reason" in tags_lower
        or "deepseek-r" in name_lower
        or any(pat in name_lower for pat in ("-r1", "-r2", "-r1.", "-r2."))
        or "orchestrator" in name_lower
        or "qwq" in name_lower
        or "s1" in tags_lower
    )
    vision = any(t in tags_lower for t in ("vision", "multimodal", "vl", "image-text-to-text", "image-to-text")) or any(
        k in name_lower for k in ("vision", "-vl", "vl-")
    )
    code = "code" in tags_lower or any(k in name_lower for k in ("coder", "code", "-code"))
    multilingual = "multilingual" in tags_lower
    # Check local tokenizer_config.json first — ground truth for downloaded models
    local_tools = _read_local_tools_support(model_id)
    tools = local_tools or \
            any(t in tags_lower for t in (
                "function-calling", "tool-use", "tools", "tool_use",
                "tool-calls", "function_calling", "agent", "agentic",
                "hermes", "nexusflow", "gorilla",
            )) or \
            any(k in name_lower for k in (
                "hermes", "gorilla", "nexus", "functionary",
                "xlam", "toolbench", "toolllm", "hammer", "meetkai",
                "tool", "function-calling",
            ))

    return ModelCapabilities(
        thinking=thinking,
        vision=vision,
        code=code,
        multilingual=multilingual,
        tools=tools,
    )


def _detect_quantization(tags: list[str], model_id: str) -> Optional[str]:
    name_lower = model_id.lower()
    tags_lower = [t.lower() for t in tags]
    if "awq" in tags_lower or "awq" in name_lower:
        return "AWQ"
    if "gptq" in tags_lower or "gptq" in name_lower:
        return "GPTQ"
    if "gguf" in tags_lower or "gguf" in name_lower:
        # Détecter la variante GGUF depuis le nom si possible
        for variant in ("Q4_K_M", "Q5_K_M", "Q4_K_S", "Q5_K_S", "Q8_0", "Q4_0", "Q6_K"):
            if variant.lower() in name_lower:
                return f"GGUF/{variant}"
        return "GGUF"
    if "fp8" in tags_lower or "fp8" in name_lower:
        return "FP8"
    if "exl2" in tags_lower or "exl2" in name_lower:
        return "EXL2"
    # W8A16 / W4A16 : formats de quantification activations
    if any(k in name_lower for k in ("w8a16", "w4a16", "w4a8")):
        return "W8A16"
    # BF16 explicite
    if "bf16" in name_lower or "bf16" in tags_lower:
        return "BF16"
    return None


def _estimate_vram_gb_gguf(params_b: float, quant: str) -> float:
    """
    VRAM estimations pour variantes GGUF.
    Source : mesures empiriques, llama.cpp overhead inclus.
    """
    variant = quant.split("/")[-1].upper() if "/" in quant else quant.upper()
    factors = {
        "Q4_0": 0.50, "Q4_K_S": 0.52, "Q4_K_M": 0.55,
        "Q5_K_S": 0.65, "Q5_K_M": 0.67,
        "Q6_K": 0.80, "Q8_0": 1.10, "F16": 2.0,
    }
    factor = factors.get(variant, 0.55)  # défaut Q4_K_M
    return round(params_b * factor, 2)


_KNOWN_ARCHS = [
    "qwen3", "qwen2.5", "qwen2", "qwen",
    "llama3", "llama2", "llama",
    "mistral", "mixtral",
    "gemma2", "gemma",
    "deepseek",
    "phi3", "phi",
    "internlm",
    "falcon",
    "mpt",
    "starcoder",
    "codellama",
    "yi",
]


def _detect_arch_tag(tags: list[str], model_id: str) -> Optional[str]:
    """Detect architecture family from HF tags or model name."""
    sources = [t.lower() for t in tags] + [model_id.lower()]
    for arch in _KNOWN_ARCHS:
        for s in sources:
            if arch in s:
                return arch
    return None


def _detect_gguf_variant(filename: str) -> str:
    """Extract GGUF quantization variant from filename."""
    import re
    upper = filename.upper()
    # Imatrix variants: IQ2_M, IQ3_XXS, IQ4_NL, etc.
    m = re.search(r'(IQ\d+[_\-][A-Z]+)', upper)
    if m:
        return m.group(1).replace('-', '_')
    # Standard: Q4_K_M, Q5_K_S, Q8_0, Q4_0, Q6_K, F16, BF16
    m = re.search(r'(Q\d+[_\-]?K[_\-]?[MS]?|Q\d+[_\-]\d+|Q\d+[_\-]K|Q\d+|F16|BF16)', upper)
    if m:
        return m.group(1).replace('-', '_')
    return "GGUF"


def _extract_gguf_files(siblings) -> list[dict]:
    """Extract GGUF file info from HF model siblings."""
    result = []
    for s in (siblings or []):
        if not s.rfilename.endswith(".gguf"):
            continue
        size_bytes = getattr(s, "size", None) or 0
        result.append({
            "name": s.rfilename,
            "size_gb": round(size_bytes / 1024 ** 3, 2),
            "variant": _detect_gguf_variant(s.rfilename),
        })
    return result or None


def _extract_description(model_id: str) -> Optional[str]:
    """Download README.md from HF and extract a short description (first ~280 chars of prose)."""
    import re
    try:
        readme_path = hf_hub_download(repo_id=model_id, filename="README.md")
        text = Path(readme_path).read_text(encoding="utf-8", errors="ignore")
        # Strip YAML front matter
        if text.startswith("---"):
            end = text.find("\n---", 3)
            if end != -1:
                text = text[end + 4:]
        lines = text.splitlines()
        prose_chars: list[str] = []
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("```"):
                continue
            # Skip badge lines and pure HTML blocks
            if re.match(r'^\[!\[', stripped):
                continue
            # Strip HTML tags
            clean = re.sub(r'<[^>]+>', '', stripped).strip()
            if not clean or len(clean) < 20:
                continue
            prose_chars.append(clean)
            if sum(len(c) for c in prose_chars) >= 280:
                break
        combined = " ".join(prose_chars)
        return combined[:280].strip() or None
    except Exception:
        return None


def _extract_more_from_author(author: str, current_id: str) -> Optional[list[dict]]:
    """Fetch up to 5 other models from same author sorted by downloads."""
    try:
        models = list(_api.list_models(author=author, limit=6, sort="downloads"))
        result = []
        for m in models:
            if m.modelId == current_id:
                continue
            result.append({
                "id": m.modelId,
                "downloads": getattr(m, "downloads", None),
                "likes": getattr(m, "likes", None),
            })
            if len(result) >= 5:
                break
        return result or None
    except Exception:
        return None


def _model_dir(model_id: str) -> Path:
    return _get_models_dir() / model_id.replace("/", "--")


def _is_downloaded(model_id: str) -> bool:
    d = _model_dir(model_id)
    return d.exists() and any(d.iterdir())


def _size_gb(model_id: str) -> Optional[float]:
    d = _model_dir(model_id)
    if not d.exists():
        return None
    total = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
    return round(total / (1024**3), 2)


def search_models(
    query: str,
    filters: Optional[list[str]] = None,
    page: int = 0,
    page_size: int = 20,
    sort: str = "downloads",
    sort_dir: str = "desc",
) -> list[ModelInfo]:
    """Search HuggingFace Hub for models.
    filters: list of awq, gptq, gguf, fp8, exl2, vision, thinking, tools (multi-select).
    sort: downloads | likes | created_at. sort_dir: asc | desc.
    """
    try:
        # Direct lookup for author/model-id queries
        if "/" in query and " " not in query.strip():
            try:
                model = get_model_info(query)
                return [model]
            except Exception:
                return []

        # Separate quant filters from capability filters
        _QUANT_TAGS = {"awq", "gptq", "gguf", "fp8", "exl2"}
        _CAP_FILTERS = {"vision", "thinking", "tools"}
        _FINETUNE_FILTER = "safetensors"

        active_filters = [f.lower() for f in (filters or ["awq", "gptq", "gguf"])]
        finetune_mode = _FINETUNE_FILTER in active_filters
        quant_filters = [f for f in active_filters if f in _QUANT_TAGS] or ([] if finetune_mode else ["awq", "gptq", "gguf"])
        cap_filters = {f for f in active_filters if f in _CAP_FILTERS}

        hf_sort = sort if sort in ("downloads", "likes", "created_at") else "downloads"
        direction = "asc" if sort_dir == "asc" else "desc"
        fetch_limit = (page + 1) * page_size + 20  # extra buffer for dedup

        results: list[ModelInfo] = []

        # Finetuneable mode — search safetensors models (no quant filter), exclude quantized
        if finetune_mode:
            list_kwargs: dict = dict(
                search=query,
                filter="safetensors",
                limit=fetch_limit,
                sort=hf_sort,
                full=True,
                token=_get_hf_token(),
            )
            try:
                import inspect as _inspect
                if "direction" in _inspect.signature(_api.list_models).parameters:
                    list_kwargs["direction"] = -1 if direction == "desc" else 1
            except Exception:
                pass
            _QUANTIZED = {"awq", "gptq", "gguf", "fp8", "exl2", "int4", "int8"}
            for m in _api.list_models(**list_kwargs):
                tags = list(m.tags or [])
                tags_lower = [t.lower() for t in tags]
                name_lower = m.modelId.lower()
                # Skip any quantized variant
                if any(q in tags_lower or q in name_lower for q in _QUANTIZED):
                    continue
                quant_type = _detect_quantization(tags, m.modelId)
                # Only keep float16, bfloat16, or undetected (pure safetensors base)
                if quant_type not in (None, "fp16", "bf16", "none"):
                    continue
                caps = _detect_capabilities(tags, m.modelId)
                if "vision" in cap_filters and not caps.vision:
                    continue
                if "thinking" in cap_filters and not caps.thinking:
                    continue
                if "tools" in cap_filters and not caps.tools:
                    continue
                params_b = _extract_params_billion(m.modelId, tags)
                vram_est = _estimate_vram_gb(params_b, "bf16") if params_b else None
                ctx = _extract_context_window(m.modelId, tags)
                results.append(ModelInfo(
                    id=m.modelId,
                    name=m.modelId.split("/")[-1],
                    quantization="bf16",
                    capabilities=caps,
                    params_billion=params_b,
                    vram_estimate_gb=vram_est,
                    max_context_window=ctx,
                    downloads=m.downloads,
                    likes=m.likes,
                    last_modified=str(m.lastModified)[:10] if m.lastModified else None,
                    pipeline_tag=m.pipeline_tag,
                    is_moe=_is_moe(m.modelId, tags),
                    has_mtp=_has_mtp_heuristic(m.modelId, tags),
                    active_params_billion=_extract_active_params_billion(m.modelId),
                ))
            # Dedup + paginate
            seen: set[str] = set()
            unique = [r for r in results if not (r.id in seen or seen.add(r.id))]  # type: ignore
            start = page * page_size
            return unique[start:start + page_size]

        for quant in quant_filters:
            list_kwargs: dict = dict(
                search=query,
                filter=quant,
                limit=fetch_limit,
                sort=hf_sort,
                full=True,
                token=_get_hf_token(),
            )
            # `direction` param added in huggingface_hub>=0.20 — pass only if supported
            try:
                import inspect as _inspect
                if "direction" in _inspect.signature(_api.list_models).parameters:
                    list_kwargs["direction"] = -1 if direction == "desc" else 1
            except Exception:
                pass
            models = _api.list_models(**list_kwargs)
            for m in models:
                tags = list(m.tags or [])
                quant_type = _detect_quantization(tags, m.modelId)
                if quant_type is None:
                    continue
                caps = _detect_capabilities(tags, m.modelId)
                # Apply capability filters
                if "vision" in cap_filters and not caps.vision:
                    continue
                if "thinking" in cap_filters and not caps.thinking:
                    continue
                if "tools" in cap_filters and not caps.tools:
                    continue
                params_b = _extract_params_billion(m.modelId, tags)
                vram_est = _estimate_vram_gb(params_b, quant_type) if params_b else None
                ctx = _extract_context_window(m.modelId, tags)
                info = ModelInfo(
                    id=m.modelId,
                    name=m.modelId.split("/")[-1],
                    author=m.modelId.split("/")[0] if "/" in m.modelId else None,
                    size_gb=None,
                    capabilities=caps,
                    downloaded=_is_downloaded(m.modelId),
                    loaded=False,
                    quantization=quant_type,
                    downloads=getattr(m, "downloads", None),
                    likes=getattr(m, "likes", None),
                    params_billion=params_b,
                    vram_estimate_gb=vram_est,
                    max_context_window=ctx,
                    is_moe=_is_moe(m.modelId, tags),
                    has_mtp=_has_mtp_heuristic(m.modelId, tags),
                    active_params_billion=_extract_active_params_billion(m.modelId),
                )
                results.append(info)

        # Deduplicate
        seen: set[str] = set()
        deduped: list[ModelInfo] = []
        for r in results:
            if r.id not in seen:
                seen.add(r.id)
                deduped.append(r)

        # Client-side sort (HF already sorts but dedup may mix)
        reverse = direction == "desc"
        if sort == "likes":
            deduped.sort(key=lambda r: r.likes or 0, reverse=reverse)
        elif sort == "created_at":
            deduped.sort(key=lambda r: r.last_modified or "", reverse=reverse)
        else:
            deduped.sort(key=lambda r: r.downloads or 0, reverse=reverse)

        start = page * page_size
        return deduped[start:start + page_size]

    except Exception as e:
        import traceback
        logger.error(f"hf_service.search_models error: {e}\n{traceback.format_exc()}")
        return []
        raise


def get_model_info(model_id: str) -> ModelInfo:
    """Fetch model card and metadata from HuggingFace."""
    try:
        info = hf_model_info(model_id, files_metadata=True, token=_get_hf_token())
        tags = list(info.tags or [])
        author = model_id.split("/")[0] if "/" in model_id else None
        quant = _detect_quantization(tags, model_id)
        params_b = _extract_params_billion(model_id, tags)

        # last_modified: datetime → ISO date string
        last_modified: Optional[str] = None
        raw_lm = getattr(info, "last_modified", None)
        if raw_lm is not None:
            try:
                last_modified = raw_lm.strftime("%Y-%m-%d")
            except Exception:
                last_modified = str(raw_lm)[:10]

        description = _extract_description(model_id)
        gguf_files = _extract_gguf_files(getattr(info, "siblings", None))
        more_from_author = _extract_more_from_author(author, model_id) if author else None

        return ModelInfo(
            id=model_id,
            name=model_id.split("/")[-1],
            author=author,
            size_gb=_size_gb(model_id) if _is_downloaded(model_id) else None,
            capabilities=_detect_capabilities(tags + ([getattr(info, "pipeline_tag")] if getattr(info, "pipeline_tag", None) else []), model_id),
            downloaded=_is_downloaded(model_id),
            loaded=False,
            quantization=quant,
            downloads=getattr(info, "downloads", None),
            likes=getattr(info, "likes", None),
            params_billion=params_b,
            vram_estimate_gb=_estimate_vram_gb(params_b, quant) if params_b else None,
            max_context_window=_extract_context_window(model_id, tags, info),
            description=description,
            last_modified=last_modified,
            pipeline_tag=getattr(info, "pipeline_tag", None),
            arch_tag=_detect_arch_tag(tags, model_id),
            gguf_files=gguf_files,
            more_from_author=more_from_author,
            gated=bool(getattr(info, "gated", False)),
            is_moe=_is_moe(model_id, tags),
            has_mtp=_has_mtp_heuristic(model_id, tags),
            active_params_billion=_extract_active_params_billion(model_id),
        )
    except Exception as e:
        logger.error(f"hf_service.get_model_info error: {e}")
        raise


def download_model(model_id: str, revision: str = "main", gguf_file: Optional[str] = None):
    """Download model to local models dir. If gguf_file is specified, downloads that single file."""
    dest = _model_dir(model_id)
    dest.mkdir(parents=True, exist_ok=True)
    logger.info(f"Downloading {model_id} to {dest}" + (f" (file: {gguf_file})" if gguf_file else ""))
    try:
        if gguf_file:
            hf_hub_download(
                repo_id=model_id,
                filename=gguf_file,
                revision=revision,
                local_dir=str(dest),
            )
        else:
            snapshot_download(
                repo_id=model_id,
                revision=revision,
                local_dir=str(dest),
                ignore_patterns=["*.md", "*.txt", "original/*"],
                token=_get_hf_token(),
            )
        logger.info(f"Download complete: {model_id}")
    except Exception as e:
        logger.error(f"hf_service.download_model error: {e}")
        raise


def list_downloaded() -> list[ModelInfo]:
    """Scan MODELS_DIR and return all downloaded models."""
    if not MODELS_DIR.exists():
        return []
    results: list[ModelInfo] = []
    for entry in MODELS_DIR.iterdir():
        if not entry.is_dir():
            continue
        model_id = entry.name.replace("--", "/", 1)
        total = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
        size_gb = round(total / (1024**3), 2)

        # Détecter la quantization depuis les fichiers présents + nom du dossier
        name_lower = entry.name.lower()
        quant = None
        gguf_files = list(entry.glob("*.gguf"))
        if gguf_files:
            # Détecter la variante depuis le nom du premier fichier GGUF
            gguf_name = gguf_files[0].stem.upper()
            for variant in ("Q4_K_M", "Q5_K_M", "Q4_K_S", "Q5_K_S", "Q8_0", "Q4_0", "Q6_K", "F16"):
                if variant in gguf_name:
                    quant = f"GGUF/{variant}"
                    break
            if quant is None:
                quant = "GGUF"
        elif "awq" in name_lower:
            quant = "AWQ"
        elif "gptq" in name_lower:
            quant = "GPTQ"
        elif "fp8" in name_lower:
            quant = "FP8"
        elif "exl2" in name_lower:
            quant = "EXL2"

        params_b = _extract_params_billion(model_id, [])
        ctx = _extract_context_window(model_id, [])
        results.append(
            ModelInfo(
                id=model_id,
                name=entry.name.split("--")[-1] if "--" in entry.name else entry.name,
                size_gb=size_gb,
                capabilities=_detect_capabilities([], model_id),
                downloaded=True,
                loaded=False,
                quantization=quant,
                params_billion=params_b,
                vram_estimate_gb=_estimate_vram_gb(params_b, quant) if params_b else None,
                max_context_window=ctx,
                is_moe=_is_moe(model_id, []),
                has_mtp=_has_mtp_heuristic(model_id, []),
                active_params_billion=_extract_active_params_billion(model_id),
            )
        )
    return results
