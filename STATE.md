# EchoHub — State
*Dernière mise à jour : 2026-05-17*

## Stack
- **Shell** : Rust · Tauri v2 (`frontend/src-tauri/`)
- **Frontend** : React 18 + TypeScript + Tailwind · Bun · Vite — port 37822
- **Backend** : Python 3.11 + FastAPI + uvicorn — port dynamique (Rust le spawne)
- **Inference** : llama-cpp-python CUDA (GGUF) + vLLM 0.21 (AWQ/GPTQ) — port 37823
- **DB** : SQLite WAL → `~/.local/share/echohub/echohub.db`
- **Config** : `~/.local/share/echohub/config.json` (paths, inference settings)
- **vLLM envs** : `~/.local/share/echohub/vllm-envs/{version}/` (legacy : `.venv-vllm/`)
- **Models** : configurable, défaut `/mnt/models/echohub/`

## Ports
| Service | Port |
|---|---|
| FastAPI backend | dynamique (37821 si libre) |
| Vite dev server | 37822 |
| vLLM interne | 37823 |

## Architecture clé
- `lib.rs` : spawn uvicorn au démarrage Tauri, kill à la fermeture
- `engine_router.py` : GGUF → llama, AWQ/GPTQ → vLLM (version sélectionnée)
- `vllm_manager.py` : gestion multi-venv vLLM, install SSE
- `vllm_service.py` : subprocess vLLM, python_override, OOM retry
- `config_service.py` : models_dir, vllm_envs_dir, inference settings
- `migration_service.py` : state machine migration fichiers avec resume
- `base.ts` : invoke('get_backend_port') en Tauri, /api proxy en browser

## Prochaine étape
Onboarding wizard + start.sh universel

## Lancement dev
```bash
cd frontend && ./tauri-dev.sh
```

## GPU / CUDA
- RTX 3060 12GB, CUDA 13.0, torch 2.11.0+cu130
- llama-cpp compilé : /opt/cuda, gcc-15, CUDA arch 86
- vLLM 0.21.0 dans `.venv-vllm/` (legacy) — migration vers `vllm-envs/` prévue
