import subprocess
from loguru import logger
from backend.models.schemas import GpuStats


def get_gpu_stats() -> GpuStats:
    """Parse nvidia-smi output and return GPU stats."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.used,memory.total,memory.free,utilization.gpu,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            raise RuntimeError(f"nvidia-smi failed: {result.stderr.strip()}")

        line = result.stdout.strip().split("\n")[0]
        parts = [p.strip() for p in line.split(",")]

        name = parts[0]
        vram_used = int(parts[1])
        vram_total = int(parts[2])
        vram_free = int(parts[3])
        gpu_util = int(parts[4])
        temp = int(parts[5]) if parts[5] not in ("", "[N/A]") else None

        stats = GpuStats(
            name=name,
            vram_used_mb=vram_used,
            vram_total_mb=vram_total,
            vram_free_mb=vram_free,
            gpu_utilization_pct=gpu_util,
            temperature_c=temp,
        )
        # Feed sample to vllm_service baseline tracker (lazy import avoids circular)
        try:
            from backend.services.vllm_service import _vram_samples
            _vram_samples.append(vram_used)
            if len(_vram_samples) > 10:
                _vram_samples.pop(0)
        except Exception:
            pass
        return stats

    except FileNotFoundError:
        logger.warning("nvidia-smi not found — returning mock GPU stats")
        return GpuStats(
            name="No GPU detected",
            vram_used_mb=0,
            vram_total_mb=0,
            vram_free_mb=0,
            gpu_utilization_pct=0,
        )
    except Exception as e:
        logger.error(f"gpu_service.get_gpu_stats error: {e}")
        raise
