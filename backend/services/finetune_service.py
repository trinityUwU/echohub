"""Fine-tuning service — Unsloth/LoRA via dedicated venv."""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from collections.abc import AsyncIterator, Callable
from pathlib import Path

from loguru import logger

from backend.services.user_data import get_user_data_dir

_UNSLOTH_VENV = Path.home() / ".local" / "share" / "echohub" / "unsloth-env"
_active_jobs: dict[str, asyncio.subprocess.Process] = {}
_cancelled_jobs: set[str] = set()   # jobs cancelled mid-pipeline
_active_pipelines: set[str] = set() # job_ids with a running pipeline (eval or training)


def get_unsloth_python() -> Path:
    if sys.platform == "win32":
        return _UNSLOTH_VENV / "Scripts" / "python.exe"
    return _UNSLOTH_VENV / "bin" / "python"


def is_unsloth_available() -> bool:
    py = get_unsloth_python()
    if not py.exists():
        return False
    # Check via pip show — faster than import (avoids torch CUDA init ~5-10s)
    try:
        result = subprocess.run(
            [str(py), "-m", "pip", "show", "unsloth"],
            capture_output=True,
            timeout=15,
        )
        return result.returncode == 0
    except Exception:
        return False


def estimate_qlora_vram_gb(params_billion: float) -> float:
    """QLoRA 4bit: ~0.5 GB/B params + 2 GB overhead for optimizer + activations."""
    return round(params_billion * 0.5 + 2.0, 1)


def _detect_cuda_version() -> str:
    """Return CUDA major.minor string (e.g. '12.1') or 'cpu'."""
    try:
        result = subprocess.run(
            ["nvcc", "--version"], capture_output=True, text=True, timeout=5
        )
        import re
        m = re.search(r"release (\d+)\.(\d+)", result.stdout)
        if m:
            return f"{m.group(1)}.{m.group(2)}"
    except Exception:
        pass
    return "cpu"


def _torch_index_url(cuda: str) -> str:
    major = int(cuda.split(".")[0]) if cuda != "cpu" else 0
    minor = int(cuda.split(".")[1]) if cuda != "cpu" and "." in cuda else 0
    if cuda == "cpu":
        return "https://download.pytorch.org/whl/cpu"
    if major >= 13:
        return "https://download.pytorch.org/whl/cu130"
    if major == 12 and minor >= 4:
        return "https://download.pytorch.org/whl/cu124"
    return "https://download.pytorch.org/whl/cu121"


async def install_unsloth_sse() -> AsyncIterator[str]:
    """Stream installation logs via SSE. Detects CUDA version automatically."""
    import shutil

    cuda = _detect_cuda_version()
    torch_url = _torch_index_url(cuda)
    yield f"data: {json.dumps({'type': 'log', 'text': f'Detected CUDA {cuda} — using {torch_url}'})}\n\n"

    # Wipe existing broken venv if present
    if _UNSLOTH_VENV.exists():
        yield f"data: {json.dumps({'type': 'step', 'label': 'Removing existing venv'})}\n\n"
        shutil.rmtree(_UNSLOTH_VENV, ignore_errors=True)

    py = get_unsloth_python()

    steps: list[tuple[list[str], str]] = [
        ([sys.executable, "-m", "venv", str(_UNSLOTH_VENV)], "Creating venv"),
        ([str(py), "-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"], "Upgrading pip"),
        (
            [
                str(py), "-m", "pip", "install",
                "torch", "torchvision", "torchaudio",
                "--index-url", torch_url,
            ],
            f"Installing PyTorch (CUDA {cuda})",
        ),
        (
            [
                str(py), "-m", "pip", "install",
                "unsloth", "trl", "peft", "accelerate",
                "bitsandbytes", "xformers",
                "--no-build-isolation",
            ],
            "Installing Unsloth + deps",
        ),
    ]

    for cmd, label in steps:
        yield f"data: {json.dumps({'type': 'step', 'label': label})}\n\n"
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert proc.stdout is not None
        async for line_b in proc.stdout:
            line = line_b.decode(errors="replace").rstrip()
            if line:
                yield f"data: {json.dumps({'type': 'log', 'text': line})}\n\n"
        await proc.wait()
        if proc.returncode != 0:
            yield f"data: {json.dumps({'type': 'error', 'text': f'{label} failed (code {proc.returncode})'})}\n\n"
            return

    yield f"data: {json.dumps({'type': 'done'})}\n\n"


def _build_train_script(
    model_path: str,
    dataset_path: str,
    output_dir: str,
    lora_rank: int,
    lora_alpha: int,
    target_modules: list[str],
    num_epochs: int,
    learning_rate: float,
    max_seq_length: int = 512,
    per_device_train_batch_size: int = 1,
    gradient_accumulation_steps: int = 8,
    optim: str = "adamw_8bit",
    cpu_offload_gb: int = 0,
) -> str:
    targets_repr = repr(target_modules)
    cache_dir = str(Path.home() / ".cache" / "unsloth")
    return f"""
import os, json, torch
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["UNSLOTH_COMPILE_LOCATION"] = "{cache_dir}"
os.makedirs("{cache_dir}", exist_ok=True)

from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig
from datasets import Dataset

MAX_SEQ_LENGTH  = {max_seq_length}
CPU_OFFLOAD_GB  = {cpu_offload_gb}   # GB of model layers to offload to system RAM (0 = GPU only)

if torch.cuda.is_available():
    total_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
    free_gb  = torch.cuda.mem_get_info(0)[0] / 1024**3
    print(f"GPU: {{torch.cuda.get_device_name(0)}} — {{total_gb:.1f}}GB total, {{free_gb:.1f}}GB free", flush=True)
else:
    print("No GPU — CPU training", flush=True)

if CPU_OFFLOAD_GB > 0:
    # CPU offload requires 8bit (4bit does not support mixed dispatch)
    print(f"CPU offload enabled: {{CPU_OFFLOAD_GB}}GB → using 8bit quantization", flush=True)
    import psutil
    ram_gb = psutil.virtual_memory().available / 1024**3
    print(f"System RAM available: {{ram_gb:.1f}}GB", flush=True)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name="{model_path}",
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,
        load_in_8bit=True,
        llm_int8_enable_fp32_cpu_offload=True,
        max_memory={{0: f"{{int(torch.cuda.get_device_properties(0).total_memory / 1024**3 - CPU_OFFLOAD_GB - 1)}}GB", "cpu": f"{{CPU_OFFLOAD_GB + 2}}GB"}},
    )
else:
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name="{model_path}",
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,
        load_in_4bit=True,
        device_map={{"": 0}},
    )

model = FastLanguageModel.get_peft_model(
    model,
    r={lora_rank},
    target_modules={targets_repr},
    lora_alpha={lora_alpha},
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=42,
)

with open("{dataset_path}") as f:
    pairs = json.load(f)

def fmt(p):
    return {{"text": f"### Human: {{p['prompt']}}\\n### Assistant: {{p['chosen']}}"}}

dataset = Dataset.from_list([fmt(p) for p in pairs])
print(f"Dataset: {{len(dataset)}} pairs — seq_length={max_seq_length} batch={per_device_train_batch_size}", flush=True)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=SFTConfig(
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        per_device_train_batch_size={per_device_train_batch_size},
        gradient_accumulation_steps={gradient_accumulation_steps},
        gradient_checkpointing=True,
        warmup_steps=3,
        num_train_epochs={num_epochs},
        learning_rate={learning_rate},
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=1,
        optim="{optim}",
        weight_decay=0.01,
        lr_scheduler_type="linear",
        seed=42,
        output_dir="{output_dir}/checkpoints",
        report_to="none",
        dataloader_pin_memory=False,
    ),
)

print("Training started", flush=True)
trainer.train()
print("Training complete — saving LoRA", flush=True)

model.save_pretrained("{output_dir}/lora")
tokenizer.save_pretrained("{output_dir}/lora")
print("LoRA saved to {output_dir}/lora", flush=True)
"""


async def run_finetune_sse(
    job_id: str,
    model_path: str,
    pairs: list[dict],
    lora_rank: int,
    lora_alpha: int,
    target_modules: list[str],
    num_epochs: int,
    learning_rate: float,
    on_status: Callable[[str, str | None], None],
    max_seq_length: int = 512,
    per_device_train_batch_size: int = 1,
    gradient_accumulation_steps: int = 8,
    optim: str = "adamw_8bit",
    cpu_offload_gb: int = 0,
) -> AsyncIterator[str]:
    output_dir = str(get_user_data_dir() / "finetune" / job_id)
    os.makedirs(output_dir, exist_ok=True)

    dataset_path = os.path.join(output_dir, "dataset.json")
    with open(dataset_path, "w") as f:
        json.dump(pairs, f)

    script_path = os.path.join(output_dir, "train.py")
    script = _build_train_script(
        model_path=model_path,
        dataset_path=dataset_path,
        output_dir=output_dir,
        lora_rank=lora_rank,
        lora_alpha=lora_alpha,
        target_modules=target_modules,
        num_epochs=num_epochs,
        learning_rate=learning_rate,
        max_seq_length=max_seq_length,
        per_device_train_batch_size=per_device_train_batch_size,
        gradient_accumulation_steps=gradient_accumulation_steps,
        optim=optim,
        cpu_offload_gb=cpu_offload_gb,
    )
    with open(script_path, "w") as f:
        f.write(script)

    if is_cancelled(job_id):
        yield f"data: {json.dumps({'type': 'error', 'text': 'Job cancelled'})}\n\n"
        on_status("cancelled", None)
        return

    # Kill any orphan process for this job before starting a new one
    orphan = _active_jobs.pop(job_id, None)
    if orphan is not None:
        try:
            orphan.terminate()
            await asyncio.wait_for(orphan.wait(), timeout=5)
        except Exception:
            pass

    py = get_unsloth_python()
    yield f"data: {json.dumps({'type': 'start', 'output_dir': output_dir})}\n\n"
    on_status("running", None)

    proc = await asyncio.create_subprocess_exec(
        str(py), script_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    _active_jobs[job_id] = proc
    log_file_path = os.path.join(output_dir, "train.log")

    assert proc.stdout is not None
    with open(log_file_path, "w", buffering=1) as log_file:
        async for line_b in proc.stdout:
            line = line_b.decode(errors="replace").rstrip()
            if line:
                log_file.write(line + "\n")
                yield f"data: {json.dumps({'type': 'log', 'text': line})}\n\n"

    del _active_jobs[job_id]
    await proc.wait()

    lora_path = os.path.join(output_dir, "lora")
    lora_saved = os.path.exists(os.path.join(lora_path, "adapter_config.json"))

    if proc.returncode == 0 or lora_saved:
        if proc.returncode != 0:
            yield f"data: {json.dumps({'type': 'log', 'text': 'Process exited non-zero but LoRA was saved — marking done'})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'output_dir': output_dir})}\n\n"
        on_status("done", output_dir)
    else:
        # Only mark error if the current DB status is not already 'done'
        # (a previous run may have succeeded for the same job_id)
        from backend.services import db as _db
        current = _db.get_finetune_job(job_id)
        if current and current.get("status") == "done":
            yield f"data: {json.dumps({'type': 'done', 'output_dir': output_dir})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'error', 'text': f'Training failed (code {proc.returncode})'})}\n\n"
            on_status("error", None)


def cancel_finetune(job_id: str) -> bool:
    _cancelled_jobs.add(job_id)
    proc = _active_jobs.get(job_id)
    if proc is not None:
        proc.terminate()
    return True


def is_cancelled(job_id: str) -> bool:
    return job_id in _cancelled_jobs


def clear_cancelled(job_id: str) -> None:
    _cancelled_jobs.discard(job_id)


def is_pipeline_active(job_id: str) -> bool:
    return job_id in _active_pipelines


def register_pipeline(job_id: str) -> None:
    _active_pipelines.add(job_id)


def unregister_pipeline(job_id: str) -> None:
    _active_pipelines.discard(job_id)


_EXPORT_TIMEOUT_S = 1800  # 30 min max for merge+quantize on large models


async def export_gguf_sse(
    job_id: str,
    lora_path: str,
    on_done: Callable[[str], None],
) -> AsyncIterator[str]:
    """Export LoRA → GGUF Q4_K_M via Unsloth native. Subprocess tracked in _active_jobs."""
    output_dir = str(get_user_data_dir() / "finetune" / job_id)
    gguf_dir = os.path.join(output_dir, "gguf_export")
    cache_dir = str(Path.home() / ".cache" / "unsloth")
    py = get_unsloth_python()

    llama_cpp_dir = str(Path.home() / ".unsloth" / "llama.cpp")
    llama_quantize_bin = str(Path(llama_cpp_dir) / "build" / "bin" / "llama-quantize")
    convert_script_py = str(Path(llama_cpp_dir) / "convert_hf_to_gguf.py")
    gguf_bf16_path = os.path.join(gguf_dir, "model-BF16.gguf")
    gguf_q4_path = os.path.join(gguf_dir, "model-Q4_K_M.gguf")

    export_script = f"""
import os, sys, time, subprocess, psutil

os.makedirs("{gguf_dir}", exist_ok=True)
os.environ["UNSLOTH_COMPILE_LOCATION"] = "{cache_dir}"

def _ram():
    v = psutil.virtual_memory()
    return f"{{v.used/1024**3:.1f}}/{{v.total/1024**3:.1f}}GB RAM"

print("=== GGUF Export starting === " + _ram(), flush=True)

# Step 1: Merge LoRA into BF16 safetensors
print("Step 1/3: Merging LoRA into BF16 safetensors...", flush=True)
from unsloth import FastLanguageModel
model, tokenizer = FastLanguageModel.from_pretrained("{lora_path}", load_in_4bit=True)
print("  Loaded: " + _ram(), flush=True)
model.save_pretrained_merged("{gguf_dir}", tokenizer, save_method="merged_16bit")
print("Step 1/3 done — BF16 safetensors saved", flush=True)
del model, tokenizer
import gc, torch; gc.collect(); torch.cuda.empty_cache()
print("  After unload: " + _ram(), flush=True)

# Step 2: BF16 safetensors → GGUF BF16 (using llama.cpp convert_hf_to_gguf.py)
print("Step 2/3: Converting to GGUF BF16...", flush=True)
t0 = time.time()
r = subprocess.run([sys.executable, "{convert_script_py}", "{gguf_dir}", "--outtype", "bf16", "--outfile", "{gguf_bf16_path}"])
if r.returncode != 0:
    print(f"ERROR: convert_hf_to_gguf.py failed (code {{r.returncode}})", flush=True); sys.exit(1)
print(f"Step 2/3 done in {{time.time()-t0:.0f}}s", flush=True)

# Step 3: GGUF BF16 → Q4_K_M
print("Step 3/3: Quantizing to Q4_K_M...", flush=True)
t0 = time.time()
r = subprocess.run(["{llama_quantize_bin}", "{gguf_bf16_path}", "{gguf_q4_path}", "Q4_K_M"])
if r.returncode != 0:
    print(f"ERROR: llama-quantize failed (code {{r.returncode}})", flush=True); sys.exit(1)
print(f"Step 3/3 done in {{time.time()-t0:.0f}}s", flush=True)

try: os.remove("{gguf_bf16_path}")
except: pass

size_gb = os.path.getsize("{gguf_q4_path}") / 1024**3
print(f"GGUF_PATH:{gguf_q4_path}", flush=True)
print(f"=== Export complete: {{size_gb:.2f}} GB ===", flush=True)
"""
    export_script_path = os.path.join(output_dir, "export_gguf.py")
    with open(export_script_path, "w") as f:
        f.write(export_script)

    yield f"data: {json.dumps({'type': 'step', 'label': 'Exporting LoRA → GGUF Q4_K_M (5-15 min)…'})}\n\n"

    proc = await asyncio.create_subprocess_exec(
        str(py), export_script_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    # Track in _active_jobs so cancel works
    _active_jobs[f"{job_id}_export"] = proc

    detected_path: str | None = None
    try:
        assert proc.stdout is not None
        # Stream with timeout — heartbeat every 30s even if no output
        import time as _time
        start_time = _time.monotonic()
        last_log_time = start_time

        async def _read_with_heartbeat() -> AsyncIterator[str]:
            nonlocal last_log_time
            while True:
                try:
                    line_b = await asyncio.wait_for(proc.stdout.readline(), timeout=30.0)  # type: ignore[union-attr]
                except asyncio.TimeoutError:
                    elapsed = int(_time.monotonic() - start_time)
                    last_log_time = _time.monotonic()
                    yield f"data: {json.dumps({'type': 'log', 'text': f'  … still exporting ({elapsed}s elapsed — normal for large models)'})}\n\n"
                    continue
                if not line_b:
                    break
                last_log_time = _time.monotonic()
                yield line_b.decode(errors="replace").rstrip()

        deadline = start_time + _EXPORT_TIMEOUT_S
        async for item in _read_with_heartbeat():
            if _time.monotonic() > deadline:
                proc.terminate()
                yield f"data: {json.dumps({'type': 'error', 'text': f'Export timed out after {_EXPORT_TIMEOUT_S//60} min'})}\n\n"
                return
            if item.startswith("data: "):
                yield item  # heartbeat already formatted
            elif item.startswith("GGUF_PATH:"):
                detected_path = item[10:].strip()
            elif item:
                yield f"data: {json.dumps({'type': 'log', 'text': item})}\n\n"

    finally:
        _active_jobs.pop(f"{job_id}_export", None)

    await proc.wait()
    if proc.returncode != 0:
        yield f"data: {json.dumps({'type': 'error', 'text': f'GGUF export failed (code {proc.returncode})'})}\n\n"
        return

    final_path = detected_path or os.path.join(gguf_dir, "model-Q4_K_M.gguf")
    yield f"data: {json.dumps({'type': 'done', 'gguf_path': final_path})}\n\n"
    on_done(final_path)



async def _eval_pipeline_sse(
    job_id: str,
    profile_id: str,
    stage: str,
    gguf_model_id: str,
    gguf_file: str,
    delete_after: bool = True,
) -> AsyncIterator[str]:
    """Download GGUF (or use local path), load in llama.cpp, run eval prompts, unload, optionally delete."""
    import uuid as _uuid
    from backend.services import db as _db

    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    def _check_cancelled() -> bool:
        return is_cancelled(job_id)

    # ── Step 1: resolve GGUF path ──────────────────────────────────────────
    is_local_path = gguf_file.startswith("/")

    # For local paths, use the filename as model_id (avoids "None-finetuned" issue)
    if is_local_path:
        gguf_model_id = os.path.basename(gguf_file).replace(".gguf", "")

    if is_local_path:
        gguf_path: str | None = gguf_file
        yield _sse({"type": "log", "text": f"[Eval {stage}] Using local GGUF: {gguf_path}"})
    else:
        yield _sse({"type": "step", "label": f"[Eval {stage}] Downloading {gguf_file}…"})
        try:
            from huggingface_hub import hf_hub_download
            from backend.services.hf_service import _model_dir, _get_hf_token
            gguf_path = hf_hub_download(
                repo_id=gguf_model_id,
                filename=gguf_file,
                local_dir=str(_model_dir(gguf_model_id)),
                token=_get_hf_token(),
            )
            yield _sse({"type": "log", "text": f"[Eval {stage}] Downloaded: {gguf_path}"})
        except Exception as e:
            yield _sse({"type": "error", "text": f"[Eval {stage}] Download failed: {e}"})
            return

    if _check_cancelled():
        yield _sse({"type": "error", "text": "Job cancelled"})
        return

    # ── Step 2: fetch eval prompts ─────────────────────────────────────────
    pairs = _db.get_training_pairs_for_profile(profile_id)
    eval_prompts = [{"id": p["id"], "prompt": p["prompt"]} for p in pairs[:20]]
    yield _sse({"type": "step", "label": f"[Eval {stage}] Running {len(eval_prompts)} prompts…"})

    # ── Step 3: run prompts via llama-cli (compatible with Unsloth GGUFs) ──
    llama_cli = str(Path.home() / ".unsloth" / "llama.cpp" / "build" / "bin" / "llama-cli")
    use_llama_cli = is_local_path and Path(llama_cli).exists()

    if not use_llama_cli:
        # Fallback: use backend llama_service (only for HF-downloaded GGUFs)
        from backend.services import llama_service
        from backend.services.engine_router import detect_gpu, unload_model as _unload_first
        yield _sse({"type": "log", "text": f"[Eval {stage}] Loading via llama-cpp-python…"})
        try:
            _unload_first()
            await asyncio.sleep(1)
        except Exception:
            pass
        gpu = detect_gpu()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: llama_service.load_model_async(
            gguf_path=gguf_path, model_id=gguf_model_id, n_ctx=2048, gpu_type=gpu["type"],
        ))
        for _ in range(240):
            if _check_cancelled():
                yield _sse({"type": "error", "text": "Job cancelled"}); return
            state = llama_service.get_load_state()
            if state.get("loaded_model_id") == gguf_model_id: break
            if state.get("error"): raise RuntimeError(state["error"])
            await asyncio.sleep(0.5)
        else:
            yield _sse({"type": "error", "text": "[Eval] Model load timed out"}); return

    results: list[dict] = []
    for i, p in enumerate(eval_prompts):
        if _check_cancelled():
            yield _sse({"type": "error", "text": "Job cancelled"}); return
        try:
            if use_llama_cli:
                # Use llama-cli directly — compatible with all Unsloth GGUF versions
                r = await asyncio.create_subprocess_exec(
                    llama_cli, "--model", gguf_path,
                    "--n-gpu-layers", "-1", "--ctx-size", "2048",
                    "--temp", "0.0", "--n-predict", "512",
                    "--no-display-prompt", "--log-disable",
                    "--prompt", f"<|im_start|>user\n{p['prompt']}<|im_end|>\n<|im_start|>assistant\n",
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                )
                stdout, _ = await asyncio.wait_for(r.communicate(), timeout=120)
                response_text = stdout.decode(errors="replace").strip()
            else:
                response_text = ""
                async for chunk in llama_service.generate(
                    messages=[{"role": "user", "content": p["prompt"]}],
                    stream=False, temperature=0.0, max_tokens=512,
                ):
                    if isinstance(chunk, dict):
                        response_text = (chunk.get("choices") or [{}])[0].get("message", {}).get("content", "")
            results.append({"prompt_id": p["id"], "prompt": p["prompt"], "response": response_text, "score": None})
        except Exception as ex:
            results.append({"prompt_id": p["id"], "prompt": p["prompt"], "response": f"[Error: {ex}]", "score": None})
        yield _sse({"type": "progress", "eval_stage": stage, "current": i + 1, "total": len(eval_prompts)})

    # ── Step 5: unload (only needed for llama-cpp-python path) ────────────
    if not use_llama_cli:
        yield _sse({"type": "step", "label": f"[Eval {stage}] Unloading model…"})
        try:
            from backend.services import llama_service as _ls
            _ls.unload_model()
        except Exception:
            pass

    # ── Step 6: delete temp GGUF if requested ─────────────────────────────
    if delete_after and not is_local_path and gguf_path:
        try:
            os.remove(gguf_path)
            yield _sse({"type": "log", "text": f"[Eval {stage}] Temp GGUF deleted"})
        except Exception:
            pass

    # ── Step 7: score ──────────────────────────────────────────────────────
    try:
        from backend.services.quality_scorer import score_general
        for r in results:
            try:
                scored = score_general(r["prompt"], r["response"])
                r["score"] = scored.get("score") if isinstance(scored, dict) else float(scored)
            except Exception:
                pass
    except Exception:
        pass

    valid = [r["score"] for r in results if r["score"] is not None]
    score_avg = round(sum(valid) / len(valid), 2) if valid else None

    # ── Step 8: persist ────────────────────────────────────────────────────
    model_path_stored = gguf_path if not delete_after else gguf_file
    _db.create_finetune_eval(
        id=str(_uuid.uuid4()),
        job_id=job_id,
        profile_id=profile_id,
        stage=stage,
        model_path=model_path_stored,
        model_id=gguf_model_id,
        results=results,
        score_avg=score_avg,
    )
    yield _sse({"type": "eval_done", "stage": stage, "score_avg": score_avg})


def _find_llama_convert() -> Path | None:
    candidates = [
        Path(__file__).parents[2] / "vendor" / "llama.cpp" / "convert_hf_to_gguf.py",
        Path.home() / ".local" / "share" / "echohub" / "llama.cpp" / "convert_hf_to_gguf.py",
    ]
    for c in candidates:
        if c.exists():
            return c
    try:
        result = subprocess.run(
            ["find", str(Path.home()), "-name", "convert_hf_to_gguf.py", "-maxdepth", "6"],
            capture_output=True, text=True, timeout=5,
        )
        lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        if lines:
            return Path(lines[0])
    except Exception:
        pass
    return None
