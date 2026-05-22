"""
vllm_vram.py — VRAM sampling and safe GPU utilization computation for vLLM.
"""
import subprocess
from pathlib import Path
from typing import Optional

from loguru import logger

VRAM_SAFETY_MARGIN = 0.03         # 3% of total reserved
VRAM_FIXED_OVERHEAD_MB = 1536     # 1.5GB fixed: vLLM process startup, NCCL, CUDA graphs
VRAM_SAMPLE_WINDOW = 10           # last N nvidia-smi samples for baseline

_vram_samples: list[int] = []     # used MB samples (rolling window)


def record_vram_sample() -> None:
    """Called periodically by gpu_service to track baseline VRAM usage."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode == 0:
            used_mb, total_mb = [int(x.strip()) for x in result.stdout.strip().split(",")]
            _vram_samples.append(used_mb)
            if len(_vram_samples) > VRAM_SAMPLE_WINDOW:
                _vram_samples.pop(0)
    except Exception:
        pass


def compute_safe_gpu_utilization() -> tuple[float, int, int]:
    """
    Returns (gpu_memory_utilization, baseline_used_mb, total_mb).
    Uses average of recent VRAM samples as baseline, reserves 2% margin.
    """
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode != 0:
            return 0.70, 0, 0
        current_used_mb, total_mb = [int(x.strip()) for x in result.stdout.strip().split(",")]

        # Use max of recent samples + current to avoid underestimating
        baseline_mb = max(_vram_samples + [current_used_mb]) if _vram_samples else current_used_mb
        free_mb = total_mb - baseline_mb
        # Apply 2% margin + 1GB fixed overhead for vLLM process startup
        safe_mb = free_mb - int(total_mb * VRAM_SAFETY_MARGIN) - VRAM_FIXED_OVERHEAD_MB
        utilization = round(safe_mb / total_mb, 3)
        utilization = max(0.50, min(utilization, 0.95))  # clamp 50%-95%

        logger.info(
            f"VRAM baseline: {baseline_mb} MB used / {total_mb} MB total — "
            f"safe allocation: {safe_mb} MB ({utilization:.1%})"
        )
        return utilization, baseline_mb, total_mb
    except Exception as e:
        logger.warning(f"compute_safe_gpu_utilization failed: {e} — using 0.70 fallback")
        return 0.70, 0, 0


def _parse_suggested_max_len(log_content: str = "", project_root: Optional[Path] = None) -> Optional[int]:
    """Parse vLLM log for 'estimated maximum model length is X' after a KV cache OOM."""
    import re
    if not log_content:
        try:
            root = project_root or Path(__file__).resolve().parents[2]
            log_content = (root / "logs" / "vllm.log").read_text(errors="replace")
        except Exception:
            return None
    m = re.search(r'estimated maximum model length is (\d+)', log_content)
    if m:
        suggested = int(m.group(1))
        # Round down to nearest power of 2 for clean context sizes
        p2 = 1
        while p2 * 2 <= suggested:
            p2 *= 2
        return p2
    return None
