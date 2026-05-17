# EchoHub

**Run AI models on your own machine. No cloud. No subscription. No data leaving your computer.**

EchoHub is a local AI interface — think ChatGPT, but everything runs on your GPU, completely offline. Search and download models from Hugging Face, load them in one click, and chat. That's it.

---

## One command to start

```bash
git clone https://github.com/trinityUwU/echohub
cd echohub
./start.sh
```

`start.sh` detects your system, installs everything it needs, and opens the app. No manual configuration. No terminal commands after that.

```bash
./stop.sh   # stop everything
```

---

## What it does

- **Search** — browse thousands of open-source AI models from Hugging Face
- **Download** — pick the version that fits your GPU memory, download in the background
- **Load** — one click to load a model into memory, with a live VRAM preview so you know it'll fit
- **Chat** — streaming responses, conversation history, attachments for vision models
- **Works offline** — once a model is downloaded, no internet needed

---

## What you need

- A computer with a GPU (NVIDIA recommended, AMD and Apple Silicon work too)
- 8 GB+ of GPU memory for most models
- 20–50 GB of disk space (models are large)
- Linux, macOS, or Windows (WSL2)

No Python knowledge. No configuration files. No command line after the first install.

---

## Under the hood (for the curious)

EchoHub handles a lot of complexity so you don't have to:

- **Two inference engines** — llama-cpp for GGUF models (works everywhere), vLLM for AWQ/GPTQ (NVIDIA, higher performance)
- **Automatic engine selection** — the app picks the right engine for each model
- **VRAM management** — real-time preview before loading, automatic retry if allocation fails
- **Model compatibility checking** — warns you before downloading if a model needs a newer engine version
- **Isolated environments** — each vLLM version lives in its own environment, nothing interferes

See [docs/v0.1-foundation.md](docs/v0.1-foundation.md) for the full technical breakdown.

---

## Releases

| Version | Status | What's in it |
|---|---|---|
| [v0.1 — Foundation](docs/v0.1-foundation.md) | ✅ Stable | Core app, dual-engine inference, VRAM management, model discovery |
| [v0.2 — Multi-engine](docs/v0.2-multi-vllm.md) | 🔧 In progress | Multiple vLLM versions, automatic compatibility routing, one-click engine install |

---

## Stop

```bash
./stop.sh
```
