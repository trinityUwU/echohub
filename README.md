# EchoHub

**Run AI models on your own machine. No cloud. No subscription. No data leaving your computer.**

EchoHub is a local AI interface — think ChatGPT, but everything runs on your GPU, completely offline. Search and download models from Hugging Face, load them in one click, and chat.

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
- **Chat** — streaming responses, conversation history, image attachments for vision models
- **Fine-tune** — collect training pairs from real conversations, fine-tune locally with QLoRA, evaluate before and after, export as GGUF
- **Export** — export any conversation as Markdown
- **Works offline** — once a model is downloaded, no internet needed

---

## What you need

- A computer with a GPU (NVIDIA recommended, AMD and Apple Silicon work too)
- 8 GB+ of GPU memory for most models
- 20–50 GB of disk space (models are large)
- Linux, macOS, or Windows (WSL2)

No Python knowledge. No configuration files. No command line after the first install.

---

## Multiple vLLM versions

Different AI models require different versions of the inference engine. EchoHub handles this automatically — each version lives in an isolated environment, the right one is selected per model. You can install new versions from Settings → Engines if a model needs one you don't have yet.

---

## Fine-tuning

EchoHub includes a complete fine-tuning workflow — no Python knowledge required.

**Collect** — use any conversation in Chat to collect training pairs. Click the bookmark on any assistant response to open the pair editor, correct the response, and save it to a profile (Dev, Reasoning, General, Analysis, Debug).

**Configure** — click Configure & Start, choose your parameters (defaults auto-tuned to your GPU), optionally enable before/after eval.

**Train** — Unsloth QLoRA runs locally in an isolated environment. Live logs stream in real time. The app auto-downloads the GGUF version of your base model for evaluation.

**Evaluate** — automatic before/after comparison using the prompts from your training profile. Same prompts, same profile, reproducible scores.

**Export** — merge LoRA + quantize to GGUF Q4_K_M, ready to load back into EchoHub.

---

## Under the hood (for the curious)

EchoHub handles a lot of complexity so you don't have to:

- **Two inference engines** — llama-cpp for GGUF models (works everywhere), vLLM for AWQ/GPTQ (NVIDIA, higher performance)
- **Automatic engine selection** — the app picks the right engine for each model
- **Multiple vLLM versions** — isolated environments per version, automatic routing, one-click install
- **VRAM management** — real-time preview before loading, automatic retry if allocation fails
- **Model compatibility checking** — warns you before downloading if a model needs a newer engine version
- **Configurable paths** — move model storage anywhere, migration handled automatically
- **Fine-tuning pipeline** — Unsloth QLoRA in an isolated venv, hardware-aware defaults, eval before/after, GGUF export

See the full technical breakdown:
- [v0.1 — Foundation](docs/v0.1-foundation.md)
- [v0.2 — Multi-engine vLLM](docs/v0.2-multi-vllm.md)
- [v0.3 — UX & automation](docs/v0.3-ux-automation.md)
- [v0.4 — Fine-tuning & RLHF](docs/v0.4-finetune.md)

---

## Releases

| Version | Status | What's in it |
|---|---|---|
| [v0.1 — Foundation](docs/v0.1-foundation.md) | ✅ Stable | Core app, dual-engine inference, VRAM management, model discovery |
| [v0.2 — Multi-engine](docs/v0.2-multi-vllm.md) | ✅ Stable | Multiple vLLM versions, automatic compatibility routing, onboarding, configurable paths |
| [v0.3 — UX & automation](docs/v0.3-ux-automation.md) | ✅ Stable | Benchmark suite, quality scoring, context bar, chat polish, installer |
| [v0.4 — Fine-tuning](docs/v0.4-finetune.md) | 🚧 In progress | QLoRA fine-tuning, RLHF pairs, eval before/after, GGUF export, download history |

---

## Stop

```bash
./stop.sh
```
