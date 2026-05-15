# EchoHub — STATE

**Status:** Fonctionnel — dual-engine GGUF+vLLM — llama-cpp CUDA recompilation en cours
**Last session:** 2026-05-16
**License cible:** MIT open source — cross-platform (NVIDIA, AMD, Mac, CPU)

## What is this

Local LM Studio replacement. Manage locally-served LLMs via HuggingFace search + download + load/unload UI. Pure local stack, no cloud. Objectif perfs : niveau LM Studio (~60 tok/s sur 4B), pas Ollama.

## Stack

| Layer | Tech |
|---|---|
| Backend | Python FastAPI + uvicorn, port **37821** |
| Frontend | React 18 + TypeScript + Tailwind + Vite + Bun, port **37822** |
| Inference défaut | llama-cpp-python (GGUF, cross-platform) |
| Inference optionnel | vLLM subprocess, port **37823** (AWQ/GPTQ, NVIDIA only) |
| Models dir | `/mnt/models/echohub/` |
| Backend venv | `backend/.venv` (Python 3.11) |
| vLLM venv | `/mnt/projects/echohub/.venv-vllm` (NVIDIA uniquement) |

## Architecture dual-engine

```
hf_service → détecte format (GGUF/AWQ/GPTQ/FP8/EXL2)
                  ↓
          engine_router.py
         /              \
llama_service.py    vllm_service.py
(GGUF — défaut)     (AWQ/GPTQ — NVIDIA opt.)
```

Paramètres llama.cpp performance-critiques :
- `n_gpu_layers=-1` (full GPU offload)
- `n_batch=512`
- `flash_attn=True`
- `n_threads=auto`

## Fonctionnalités implémentées

- HF search avec filtres GGUF/AWQ/GPTQ/FP8/EXL2 + scroll infini
- Download fichier GGUF spécifique (pas snapshot complet)
- Sélection variante Q4_K_M/Q5_K_M/etc. dans dropdown
- HF Token dans Settings → accès gated models
- Check accès avant download → badge 🔒 + lien HF si gated
- Auto-unload si modèle déjà chargé lors d'un nouveau load
- Bannière CPU-only si llama-cpp sans support GPU
- ModelBrowser split-panel (liste gauche + détail droit) style LM Studio
- VRAM bars inline dans les items de liste
- "More from author" cliquable
- ChatPanel : Vision/Thinking toggles, attachments images+fichiers
- Profils de chat avec modal save stylisée
- Page Settings : HF Token + GPU backend status

## Fichiers clés

- `backend/services/engine_router.py` — détection format/GPU, dispatch
- `backend/services/llama_service.py` — GGUF via llama-cpp-python
- `backend/services/vllm_service.py` — AWQ/GPTQ via vLLM subprocess
- `backend/services/hf_service.py` — HF search/download, GGUF variants, gated detection
- `backend/services/download_manager.py` — download queue, gguf_file spécifique
- `backend/routers/settings.py` — HF token, GPU backend detection
- `frontend/src/components/ModelBrowser.tsx` — split panel complet
- `frontend/src/components/SettingsPage.tsx` — settings UI
- `frontend/src/components/CpuOnlyBanner.tsx` — bannière CPU-only
- `frontend/src/hooks/useModels.ts` — auto-unload avant load

## API endpoints notables

| Method | Path | Description |
|---|---|---|
| GET | `/models/search?q=...&filters=gguf,awq,gptq&page=0` | HF search paginé |
| POST | `/models/check-access` | Vérifie accès gated |
| POST | `/models/download` | Start download (gguf_file optionnel) |
| POST | `/inference/load` | Load model (auto-unload si besoin) |
| GET | `/inference/engine` | Engine actif (llama/vllm) |
| GET | `/settings/gpu-backend` | Backend GPU + CPU-only detection |
| GET/POST | `/settings/hf-token` | HF Token management |

## Install llama-cpp-python avec CUDA (Arch Linux)

```bash
# 1. CUDA toolkit
sudo pacman -S cuda

# 2. Compiler llama-cpp-python
cd /mnt/projects/echohub/backend
CUDA_PATH=/opt/cuda PATH="/opt/cuda/bin:$PATH" NVCC_CCBIN=/usr/bin/gcc-15 \
CMAKE_ARGS="-DGGML_CUDA=on -DCMAKE_CUDA_ARCHITECTURES=86 -DCMAKE_CUDA_FLAGS=--allow-unsupported-compiler -DCMAKE_CUDA_HOST_COMPILER=/usr/bin/gcc-15" \
.venv/bin/pip install llama-cpp-python --force-reinstall --no-cache-dir
```

RTX 3060 = architecture 86 (Ampere). GCC 16 incompatible avec CUDA 13 → utiliser gcc-15.

## Known constraints

- vLLM venv hardcodé à `/mnt/projects/echohub/.venv-vllm`
- Conversation history en localStorage (pas SQLite)
- HF_TOKEN dans `.env` + runtime env
- Context par défaut 4096 si non spécifié
