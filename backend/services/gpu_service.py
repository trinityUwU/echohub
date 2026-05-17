import platform
import subprocess
from loguru import logger
from backend.models.schemas import GpuStats


def get_gpu_stats() -> GpuStats:
    """Return GPU stats — tries NVIDIA, AMD ROCm, Apple Metal, then CPU fallback."""
    # NVIDIA
    try:
        return _nvidia_stats()
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.debug(f"nvidia-smi failed: {e}")

    # AMD ROCm
    try:
        return _amd_stats()
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.debug(f"rocm-smi failed: {e}")

    # Apple Silicon (macOS)
    if platform.system() == "Darwin":
        try:
            return _apple_stats()
        except Exception as e:
            logger.debug(f"powermetrics failed: {e}")

    return GpuStats(
        name="No GPU detected (CPU inference)",
        vram_used_mb=0, vram_total_mb=0, vram_free_mb=0,
        gpu_utilization_pct=0, temperature_c=None,
    )


def _nvidia_stats() -> GpuStats:
    result = subprocess.run(
        ["nvidia-smi",
         "--query-gpu=name,memory.used,memory.total,memory.free,utilization.gpu,temperature.gpu",
         "--format=csv,noheader,nounits"],
        capture_output=True, text=True, timeout=5,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())

    parts = [p.strip() for p in result.stdout.strip().split("\n")[0].split(",")]
    name, vram_used, vram_total, vram_free, gpu_util = parts[0], int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4])
    temp = int(parts[5]) if parts[5] not in ("", "[N/A]") else None

    stats = GpuStats(name=name, vram_used_mb=vram_used, vram_total_mb=vram_total,
                     vram_free_mb=vram_free, gpu_utilization_pct=gpu_util, temperature_c=temp)
    _feed_vllm_sample(vram_used)
    return stats


def _amd_stats() -> GpuStats:
    """AMD ROCm via rocm-smi."""
    # rocm-smi --showmeminfo vram --showuse --showtemp --json
    result = subprocess.run(
        ["rocm-smi", "--showmeminfo", "vram", "--showuse", "--json"],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())

    import json
    data = json.loads(result.stdout)
    # rocm-smi JSON has card keys like "card0"
    card = next(iter(data.values()))
    vram_total_b = int(card.get("VRAM Total Memory (B)", 0))
    vram_used_b  = int(card.get("VRAM Total Used Memory (B)", 0))
    vram_total_mb = vram_total_b // (1024 * 1024)
    vram_used_mb  = vram_used_b  // (1024 * 1024)
    gpu_util = int(card.get("GPU use (%)", 0))
    name = card.get("Card series", "AMD GPU")

    return GpuStats(name=name, vram_used_mb=vram_used_mb, vram_total_mb=vram_total_mb,
                    vram_free_mb=max(0, vram_total_mb - vram_used_mb),
                    gpu_utilization_pct=gpu_util, temperature_c=None)


def _apple_stats() -> GpuStats:
    """Apple Silicon unified memory via sysctl + powermetrics."""
    import re

    # Total unified memory from sysctl
    mem_result = subprocess.run(
        ["sysctl", "hw.memsize"], capture_output=True, text=True, timeout=3
    )
    total_bytes = int(mem_result.stdout.split(":")[1].strip()) if mem_result.returncode == 0 else 0
    total_mb = total_bytes // (1024 * 1024)

    # GPU usage from powermetrics (requires sudo on macOS — skip util if unavailable)
    gpu_util = 0
    try:
        pm = subprocess.run(
            ["powermetrics", "--samplers", "gpu_power", "-n", "1", "--format", "plist"],
            capture_output=True, text=True, timeout=8,
        )
        m = re.search(r'<key>GPU Active residency</key>\s*<real>([\d.]+)</real>', pm.stdout)
        if m:
            gpu_util = int(float(m.group(1)) * 100)
    except Exception:
        pass

    # Approximate VRAM: Apple Silicon shares RAM — report total/2 as "GPU budget"
    vram_total_mb = total_mb // 2
    return GpuStats(
        name="Apple Silicon (unified memory)",
        vram_used_mb=0, vram_total_mb=vram_total_mb,
        vram_free_mb=vram_total_mb, gpu_utilization_pct=gpu_util, temperature_c=None,
    )


def _feed_vllm_sample(vram_used_mb: int) -> None:
    try:
        from backend.services.vllm_service import _vram_samples
        _vram_samples.append(vram_used_mb)
        if len(_vram_samples) > 10:
            _vram_samples.pop(0)
    except Exception:
        pass
