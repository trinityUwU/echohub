"""
multi_gpu — détection et configuration multi-GPU pour llama-cpp-python.
Supporte NVIDIA (nvidia-smi), AMD ROCm (rocm-smi), CPU fallback.
"""
from __future__ import annotations
import subprocess
from typing import Optional
from loguru import logger


def detect_all_gpus() -> list[dict]:
    """
    Retourne la liste de tous les GPUs disponibles.
    Chaque dict : {"index": int, "name": str, "vram_total_mb": int, "type": "nvidia"|"amd"}
    """
    gpus = _detect_nvidia_gpus()
    if gpus:
        return gpus
    gpus = _detect_amd_gpus()
    return gpus


def _detect_nvidia_gpus() -> list[dict]:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return []
        gpus = []
        for line in result.stdout.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 3:
                gpus.append({
                    "index": int(parts[0]),
                    "name": parts[1],
                    "vram_total_mb": int(parts[2]),
                    "type": "nvidia",
                })
        return gpus
    except Exception:
        return []


def _detect_amd_gpus() -> list[dict]:
    try:
        result = subprocess.run(
            ["rocm-smi", "--showproductname", "--showmeminfo", "vram", "--noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return []
        # Parse rocm-smi output — retourner au moins 1 GPU AMD si présent
        if "GPU" in result.stdout:
            return [{"index": 0, "name": "AMD GPU", "vram_total_mb": 0, "type": "amd"}]
    except Exception:
        pass
    return []


def compute_tensor_split(gpus: list[dict]) -> Optional[list[float]]:
    """
    Calcule tensor_split proportionnel à la VRAM de chaque GPU.
    Retourne None si 1 seul GPU (pas de split nécessaire).
    Retourne split égal si VRAMs toutes à 0 (AMD — VRAM inconnue).
    """
    if len(gpus) <= 1:
        return None
    total_vram = sum(g["vram_total_mb"] for g in gpus)
    if total_vram == 0:
        # AMD ou VRAM inconnue — split égal
        equal = round(1.0 / len(gpus), 4)
        return [equal] * len(gpus)
    split = [round(g["vram_total_mb"] / total_vram, 4) for g in gpus]
    # Normaliser pour que la somme = 1.0 exactement
    diff = 1.0 - sum(split)
    split[-1] = round(split[-1] + diff, 4)
    return split


def get_multi_gpu_config() -> dict:
    """
    Retourne la config multi-GPU complète.
    {
        "gpu_count": int,
        "gpus": [...],
        "tensor_split": list[float] | None,
        "total_vram_mb": int,
    }
    """
    gpus = detect_all_gpus()
    tensor_split = compute_tensor_split(gpus)
    return {
        "gpu_count": len(gpus),
        "gpus": gpus,
        "tensor_split": tensor_split,
        "total_vram_mb": sum(g["vram_total_mb"] for g in gpus),
    }
