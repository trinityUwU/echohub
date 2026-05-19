"""Utilities for reading GGUF binary metadata without loading the full model."""
import re
import struct
from pathlib import Path
from typing import Optional


# Maps model name patterns to llama_cpp chat handler class names
_VISION_HANDLERS: list[tuple[str, str]] = [
    ("qwen2-vl", "Qwen25VLChatHandler"),
    ("qwen2.5-vl", "Qwen25VLChatHandler"),
    ("qwen25vl", "Qwen25VLChatHandler"),
    ("llava-1.5", "Llava15ChatHandler"),
    ("llava-v1.5", "Llava15ChatHandler"),
    ("llava-1.6", "Llava16ChatHandler"),
    ("llava-v1.6", "Llava16ChatHandler"),
    ("llava", "Llava15ChatHandler"),
    ("minicpm-v-2_6", "MiniCPMv26ChatHandler"),
    ("minicpm", "MiniCPMv26ChatHandler"),
    ("moondream", "MoondreamChatHandler"),
    ("llama-3.2", "Llama3VisionAlphaChatHandler"),
    ("llama3.2", "Llama3VisionAlphaChatHandler"),
]


def find_mmproj(model_dir: str) -> Optional[str]:
    """Return path to the multimodal projector GGUF in model_dir, or None."""
    p = Path(model_dir)
    for candidate in p.glob("*.gguf"):
        name = candidate.name.lower()
        if "mmproj" in name or "projector" in name or "clip" in name:
            return str(candidate)
    return None


def detect_vision_handler(model_id: str) -> Optional[str]:
    """Return llama_cpp chat handler class name for vision models, or None."""
    name = model_id.lower()
    for pattern, handler in _VISION_HANDLERS:
        if pattern in name:
            return handler
    return None


def detect_mtp(gguf_path: str) -> bool:
    """Return True if the GGUF file contains MTP (Multi-Token Prediction) tensors.

    MTP tensors are named blk.N.nextn.* — they appear when the model was exported
    with MTP heads included. llama.cpp activates MTP automatically when present.

    Args:
        gguf_path: Absolute path to the GGUF file.

    Returns:
        True if any tensor name contains "nextn", False otherwise or on error.
    """
    try:
        return _scan_gguf_tensors(gguf_path)
    except Exception:
        return False


def _scan_gguf_tensors(gguf_path: str) -> bool:
    _MAGIC = b"GGUF"
    _MTP_PATTERN = re.compile(r"blk\.\d+\.nextn")

    with open(gguf_path, "rb") as f:
        magic = f.read(4)
        if magic != _MAGIC:
            return False

        version = struct.unpack("<I", f.read(4))[0]
        if version not in (2, 3):
            return False

        n_tensors = struct.unpack("<Q", f.read(8))[0]
        n_kv = struct.unpack("<Q", f.read(8))[0]

        # Skip KV pairs — each KV: key_len(u64) + key(bytes) + type(u32) + value(variable)
        for _ in range(n_kv):
            _skip_kv(f)

        # Read tensor name list — stop early if MTP found
        for _ in range(n_tensors):
            name_len = struct.unpack("<Q", f.read(8))[0]
            name = f.read(name_len).decode("utf-8", errors="replace")

            if "nextn" in name or _MTP_PATTERN.search(name):
                return True

            # Skip remaining tensor info: n_dims(u32) + dims(n_dims*u64) + type(u32) + offset(u64)
            n_dims = struct.unpack("<I", f.read(4))[0]
            f.read(n_dims * 8 + 4 + 8)

    return False


def _skip_kv(f) -> None:  # type: ignore[no-untyped-def]
    """Skip one KV entry in a GGUF file. Raises on unknown type."""
    _GGUF_TYPES = {
        0: 1,   # uint8
        1: 1,   # int8
        2: 2,   # uint16
        3: 2,   # int16
        4: 4,   # uint32
        5: 4,   # int32
        6: 4,   # float32
        7: 1,   # bool
        10: 8,  # uint64
        11: 8,  # int64
        12: 8,  # float64
    }
    key_len = struct.unpack("<Q", f.read(8))[0]
    f.read(key_len)
    val_type = struct.unpack("<I", f.read(4))[0]

    if val_type == 8:  # string
        str_len = struct.unpack("<Q", f.read(8))[0]
        f.read(str_len)
    elif val_type == 9:  # array
        elem_type = struct.unpack("<I", f.read(4))[0]
        arr_len = struct.unpack("<Q", f.read(8))[0]
        if elem_type == 8:  # array of strings
            for _ in range(arr_len):
                s_len = struct.unpack("<Q", f.read(8))[0]
                f.read(s_len)
        else:
            elem_size = _GGUF_TYPES.get(elem_type, 4)
            f.read(arr_len * elem_size)
    else:
        size = _GGUF_TYPES.get(val_type, 4)
        f.read(size)
