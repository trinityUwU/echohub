# EchoHub

**Run AI models on your own machine. No cloud. No subscription. No data leaving your computer.**

EchoHub is a local AI interface, like ChatGPT but everything runs on your GPU, completely offline. Search and download models from Hugging Face, load them in one click, and chat.

---

## One command to start

```bash
git clone https://github.com/trinityUwU/echohub
cd echohub
./start.sh
```

`start.sh` detects your system, installs what it needs, and opens the app. No manual configuration. After that, the terminal stays closed.

```bash
./stop.sh   # stop everything
```

---

## What it does

- Search thousands of open source AI models from Hugging Face
- Pick the variant that fits your GPU memory and download it in the background
- Load a model with one click — there's a live VRAM preview before you commit
- Chat with streaming responses, conversation history, and image attachments for vision models
- Install any MCP server from GitHub in one click — Python and Node, stdio and HTTP, auto-detected
- Agent mode with tool use: web search, file system, code execution, and any installed MCP tools
- Collect training pairs from real conversations, fine-tune locally with QLoRA, evaluate before and after, and export as GGUF
- Detects and preserves MTP (Multi-Token Prediction) — models like Qwen3 get 1.5–2x faster generation automatically, with a badge in Discover and Library
- Load profiles (Performance / Balanced / Gaming / Minimal) that configure all GPU parameters automatically
- Multi-GPU support: tensor split across N GPUs for llama.cpp, tensor parallel for vLLM — automatic detection, no config needed
- Speculative decoding: n-gram (zero cost), MTP self-speculative, and draft model — selectable per load
- Export any conversation as Markdown
- Once a model is downloaded, everything works offline

---

## What you need

- A GPU (NVIDIA recommended, AMD and Apple Silicon work too)
- 8 GB+ of GPU memory for most models
- 20–50 GB of disk space (models are large)
- Linux, macOS, or Windows (WSL2)

You don't need Python knowledge or configuration files. No terminal access after the first install.

---

## Multiple vLLM versions

Different models require different versions of the inference engine. EchoHub manages this automatically: each version lives in an isolated environment and the right one is selected per model. If a model needs a version you don't have yet, you can install it from Settings → Engines.

---

## Fine-tuning

EchoHub has a complete fine-tuning workflow, and it doesn't require Python knowledge.

In Chat, every assistant message has a bookmark button. Click it to open the pair editor, correct the response, and save the pair to a training profile (Dev, Reasoning, General, Analysis, or Debug). That's the data collection step — it happens during conversations you're already having.

When you have enough pairs, click Configure & Start. Defaults are auto-tuned to your GPU. You can optionally enable before/after eval. Unsloth QLoRA runs locally in an isolated environment, logs stream in real time, and the app auto-downloads the GGUF version of your base model for evaluation.

After training, you get a before/after score comparison using the exact prompts from your training profile. Then merge LoRA and quantize to GGUF Q4_K_M, ready to load back into EchoHub.

---

## Under the hood

A few things that aren't obvious from the UI:

- Two inference engines: llama-cpp for GGUF models (works on any hardware), vLLM for AWQ/GPTQ (NVIDIA, higher throughput)
- The app picks the engine based on model format — you don't choose
- Multiple vLLM versions in isolated environments, automatic routing, one-click install from Settings
- VRAM preview before loading (model weights + KV cache + CUDA overhead), with automatic retry if allocation fails by a small margin
- Compatibility check before download: fetches config.json from HF and warns if the model needs a different engine version
- Storage paths are configurable, and changing them triggers an automatic file migration
- Fine-tuning runs in its own isolated venv, separate from the backend
- MTP detection: scans GGUF binary for speculative decoding tensors, activates automatically in llama.cpp when present — see docs/v0.5-mtp.md
- Vision support for GGUF models: detects mmproj file at load time, selects the right chat handler automatically (Qwen2-VL, LLaVA, MiniCPM, Llama3-Vision…)
- Reload model from message footer: each message stores its exact load config, one click reloads the same model with the same parameters if it was ejected
- Capability badges everywhere: quant, MTP, MoE, thinking, vision in Discover, Library, LoadModal, ChatTopBar, ModelPicker
- Load profiles compute optimal `n_gpu_layers` dynamically from model params and available VRAM — Gaming mode targets 3 GB leaving ~8.5 GB free on a 12 GB card
- `offload_kqv`: moves the KV cache to system RAM, freeing its full VRAM footprint at a small PCIe latency cost
- Multi-GPU: `detect_all_gpus()` queries nvidia-smi/rocm-smi, `tensor_split` is computed proportional to each GPU's VRAM and injected at load time
- Speculative decoding in llama.cpp: n-gram lookup (zero cost), MTP self-speculative (auto-detected from GGUF metadata), and external draft model — slider for tokens per step

Full technical breakdown:
- [v0.1 — Foundation](docs/v0.1-foundation.md)
- [v0.2 — Multi-engine vLLM](docs/v0.2-multi-vllm.md)
- [v0.3 — UX & automation](docs/v0.3-ux-automation.md)
- [v0.4 — Fine-tuning & RLHF](docs/v0.4-finetune.md)
- [v0.5 — MTP support](docs/v0.5-mtp.md)
- [v0.6 — Vision, MTP, UX polish](docs/v0.6-vision-mtp-ux.md)
- [v0.7 — Projects workspace & tool calling](docs/v0.7-projects-workspace.md)
- [v0.8 — MCP Skills Intelligence & Agent Polish](docs/v0.8-mcp-skills-intelligence.md)
- [v0.9 — Perf, Multi-GPU & Speculative](docs/v0.9-perf-gpu-speculative.md)

---

## Releases

| Version | Status | What's in it |
|---|---|---|
| [v0.1 — Foundation](docs/v0.1-foundation.md) | ✅ Stable | Core app, dual-engine inference, VRAM management, model discovery |
| [v0.2 — Multi-engine](docs/v0.2-multi-vllm.md) | ✅ Stable | Multiple vLLM versions, automatic compatibility routing, onboarding, configurable paths |
| [v0.3 — UX & automation](docs/v0.3-ux-automation.md) | ✅ Stable | Benchmark suite, quality scoring, context bar, chat polish, installer |
| [v0.4 — Fine-tuning](docs/v0.4-finetune.md) | 🚧 In progress | QLoRA fine-tuning, RLHF pairs, eval before/after, GGUF export, download history |
| [v0.5 — MTP support](docs/v0.5-mtp.md) | ✅ Stable | MTP detection, badge in Discover/Library, fine-tune export preserves MTP tensors |
| [v0.6 — Vision, MTP, UX polish](docs/v0.6-vision-mtp-ux.md) | ✅ Stable | Vision for GGUF (mmproj auto-detect), capability badges everywhere, reload model from footer, image lightbox, Wayland clipboard paste, vLLM fixes |
| [v0.7 — Projects workspace](docs/v0.7-projects-workspace.md) | ✅ Stable | Projects hub (Dev/Docs/Research), per-project profiles, tool calling detection & filter, collapsible panels |
| [v0.8 — MCP Skills Intelligence](docs/v0.8-mcp-skills-intelligence.md) | ✅ Stable | stdio MCP transport (Python + Node), auto-install from GitHub, isolated venvs, context budget, synthesis on cap, 5 built-in chat profiles |
| [v0.9 — Perf, Multi-GPU & Speculative](docs/v0.9-perf-gpu-speculative.md) | ✅ Stable | Load profiles, offload_kqv, multi-GPU tensor split/parallel, speculative decoding |

---

## Stop

```bash
./stop.sh
```
