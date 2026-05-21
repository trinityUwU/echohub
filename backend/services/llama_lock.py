"""
Global mutex for all llama.cpp operations.
llama.cpp shares global C state — concurrent calls from separate Llama instances
cause "Memory is not initialized" / segfaults. Serialize everything through this lock.
"""
from __future__ import annotations

import threading

_llama_lock = threading.Lock()


def get_lock() -> threading.Lock:
    return _llama_lock
