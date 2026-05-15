# EchoHub

Local LM Studio replacement. Search, download, and run AWQ/GPTQ models via vLLM. 100% local.

## Stack

- **Backend:** Python 3.11+ / FastAPI / uvicorn — port 8000
- **Frontend:** React 18 / TypeScript / Tailwind / Vite / Bun — port 5173
- **Inference:** vLLM (subprocess, OpenAI-compatible API on port 8001)
- **Models:** `/mnt/models/echohub/`

## First run

```bash
# One-shot start
./start.sh

# Or manually:
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # optionally add HF_TOKEN for gated models
PYTHONPATH=/mnt/projects/echohub .venv/bin/uvicorn backend.main:app --port 8000 --reload

cd ../frontend
bun install
bun run dev
```

Open http://localhost:5173

## Usage

1. **Browse** — search HuggingFace for AWQ/GPTQ models, filter by capability
2. **Download** — streams progress, saves to `/mnt/models/echohub/`
3. **Load** — spawns vLLM on port 8001, VRAM shown in sidebar
4. **Chat** — streaming responses via SSE
5. **Unload** — kills vLLM subprocess, VRAM freed and verified

## Ports

| Service | Port |
|---|---|
| FastAPI backend | 8000 |
| Vite frontend | 5173 |
| vLLM (internal) | 8001 |

## Stop

```bash
./stop.sh
```
