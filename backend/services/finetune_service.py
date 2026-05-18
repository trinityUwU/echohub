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

    assert proc.stdout is not None
    async for line_b in proc.stdout:
        line = line_b.decode(errors="replace").rstrip()
        if line:
            yield f"data: {json.dumps({'type': 'log', 'text': line})}\n\n"

    del _active_jobs[job_id]
    await proc.wait()

    lora_path = os.path.join(output_dir, "lora")
    lora_saved = os.path.exists(os.path.join(lora_path, "adapter_config.json"))

    if proc.returncode == 0 or lora_saved:
        # Success: either clean exit or LoRA was actually saved despite warnings
        if proc.returncode != 0:
            yield f"data: {json.dumps({'type': 'log', 'text': f'Process exited {proc.returncode} but LoRA was saved — treating as success'})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'output_dir': output_dir})}\n\n"
        on_status("done", output_dir)
    else:
        yield f"data: {json.dumps({'type': 'error', 'text': f'Training failed (code {proc.returncode})'})}\n\n"
        on_status("error", None)


def cancel_finetune(job_id: str) -> bool:
    proc = _active_jobs.get(job_id)
    if proc is None:
        return False
    proc.terminate()
    return True


async def export_gguf_sse(
    job_id: str,
    lora_path: str,
    on_done: Callable[[str], None],
) -> AsyncIterator[str]:
    output_dir = str(get_user_data_dir() / "finetune" / job_id)
    merged_path = os.path.join(output_dir, "merged")
    gguf_path = os.path.join(output_dir, "model.Q4_K_M.gguf")

    py = get_unsloth_python()

    merge_script = f"""
from unsloth import FastLanguageModel
model, tokenizer = FastLanguageModel.from_pretrained("{lora_path}", load_in_4bit=True)
model.save_pretrained_merged("{merged_path}", tokenizer, save_method="merged_16bit")
print("Merge complete", flush=True)
"""
    merge_path = os.path.join(output_dir, "merge.py")
    with open(merge_path, "w") as f:
        f.write(merge_script)

    yield f"data: {json.dumps({'type': 'step', 'label': 'Merging LoRA into base model'})}\n\n"
    proc = await asyncio.create_subprocess_exec(
        str(py), merge_path,
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
        yield f"data: {json.dumps({'type': 'error', 'text': 'Merge failed'})}\n\n"
        return

    llama_cpp = _find_llama_convert()
    if llama_cpp is None:
        yield f"data: {json.dumps({'type': 'error', 'text': 'llama.cpp convert script not found'})}\n\n"
        return

    yield f"data: {json.dumps({'type': 'step', 'label': 'Quantizing to GGUF Q4_K_M'})}\n\n"
    convert_cmd = [
        sys.executable, str(llama_cpp),
        merged_path, "--outfile", gguf_path, "--outtype", "q4_k_m",
    ]
    proc2 = await asyncio.create_subprocess_exec(
        *convert_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert proc2.stdout is not None
    async for line_b in proc2.stdout:
        line = line_b.decode(errors="replace").rstrip()
        if line:
            yield f"data: {json.dumps({'type': 'log', 'text': line})}\n\n"
    await proc2.wait()
    if proc2.returncode != 0:
        yield f"data: {json.dumps({'type': 'error', 'text': 'Quantization failed'})}\n\n"
        return

    yield f"data: {json.dumps({'type': 'done', 'gguf_path': gguf_path})}\n\n"
    on_done(gguf_path)


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
