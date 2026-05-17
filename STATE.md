# EchoHub — State
*Dernière mise à jour : 2026-05-17*

## Stack
- **Shell** : Rust · Tauri v2 (`frontend/src-tauri/`)
- **Frontend** : React 18 + TypeScript + Tailwind · Bun · Vite — port 37822
- **Backend** : Python 3.11 + FastAPI + uvicorn — port dynamique (Rust le spawne)
- **Inference** : llama-cpp-python CUDA (GGUF) + vLLM 0.21 (AWQ/GPTQ) — port 37823
- **DB** : SQLite WAL → `~/.local/share/echohub/echohub.db`
- **Models** : `/mnt/models/echohub/`
- **vLLM venv** : `/mnt/projects/echohub/.venv-vllm/` (0.21.0)

## Ports
| Service | Port |
|---|---|
| FastAPI backend | dynamique (37821 si libre) |
| Vite dev server | 37822 |
| vLLM interne | 37823 |

## Architecture clé
- `frontend/src-tauri/src/lib.rs` : spawn uvicorn au démarrage Tauri, kill à la fermeture
- `backend/services/engine_router.py` : GGUF → llama, AWQ/GPTQ → vLLM
- `backend/services/vllm_service.py` : subprocess vLLM, OOM retry auto, logs SSE
- `backend/services/llama_service.py` : llama-cpp-python, CUDA/ROCm/Metal/CPU
- `backend/routers/models.py` : search HF, download, compatibility check
- `frontend/src/api/base.ts` : `invoke('get_backend_port')` en Tauri, `/api` proxy en browser

## État actuel
- App Tauri native fonctionnelle avec backend sidecar Python
- Chat (streaming vLLM/llama), conversations persistées SQLite
- Discover : search HF, download, favorites, compatibility check AWQ
- Library : liste modèles locaux, delete
- Settings : setup deps, GPU info, HF token, model storage
- Profils chat : Default/Coder/Creative + customs, persistence localStorage

## Prochaine étape majeure
Multi-venv vLLM : venvs isolés par version dans `~/.local/share/echohub/vllm-envs/`,
Settings/Engines UI, install SSE live, routing engine par version requise.

## Lancement dev
```bash
cd frontend && ./tauri-dev.sh
# → détecte Wayland/X11, spawn backend Python, ouvre fenêtre Tauri
```

## GPU / CUDA
- RTX 3060 12GB (arch 86), CUDA 13.0, torch 2.11.0+cu130
- llama-cpp compilé avec CUDA : CUDA_PATH=/opt/cuda, gcc-15, CMAKE_ARGS="-DGGML_CUDA=on -DCMAKE_CUDA_ARCHITECTURES=86"
- vLLM 0.21.0 dans `.venv-vllm/` (séparé du backend principal)
