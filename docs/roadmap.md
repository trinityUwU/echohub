# EchoHub — Roadmap

This document covers the planned features beyond v0.9. Everything here is decided but not yet implemented.

---

## v1.0 — Agent Harness & Remote Access

### Sub-agent orchestration

The orchestrator model stays conversational and delegates tasks to sub-agents. A sub-agent is not a new process — it is a new inference call on the same loaded model, with an isolated context and a strict tool set.

Full architecture: see [agent-harness-architecture.md](agent-harness-architecture.md)

**What gets built:**
- `invoke_agent` tool — orchestrator calls it with a brief, gets back a structured result
- Universal validation harness — syntax → lint → types → tests, intercepts every file mutation
- Result normalizer — sub-agent sees `"line 42: TypeError"`, not raw tool output
- `.harness.yml` per-project config (severity thresholds, timeout, diff-aware)

**Current constraint:** sequential model only. With one model loaded, all sub-agents use that model. Model routing comes after parallel loading is implemented.

---

### Remote Access

Use EchoHub from anywhere — phone, another PC, WhatsApp, Telegram, Signal — without leaving the app's philosophy: everything configured from the UI, no manual config files.

**Core principle:** fully local by default. Remote services are optional toggles. Credentials are entered in the app, never in config files.

**Architecture:**
- Cloudflare Tunnel — already in the stack, zero-config, toggleable from Settings > Remote Access
- Messaging adapters — each is a separate service with start/stop controls
- Session routing — incoming message routes to the active session (loaded model + last conversation updated < 5 min ago)
- Auth token — generated once in the app, validated on every inbound request

**Session model (current):** one active session at a time, tied to the single loaded model. Parallel sessions come with parallel model loading.

**Adapters — implementation order:**
1. **Telegram Bot API** — simplest, no approval needed, available on phone and PC, webhook-based
2. WhatsApp Business API — requires Meta verification, more friction
3. Signal — via signal-cli, heavier setup

**What gets built for v1.0:**
- Settings > Remote Access tab
- Cloudflare Tunnel toggle with status badge
- Telegram adapter: bot token field, webhook setup, incoming message → active session routing
- Start/stop per adapter

---

## v1.1 — Parallel Models & Model Routing

### Parallel model loading

Load multiple models simultaneously. Each model runs in its own inference context.

- Load modal gets a "load alongside current" option
- Model switcher in topbar becomes a list
- Conversations can pin a specific model
- VRAM bar shows combined allocation across all loaded models

### Model routing in sub-agents

Once multiple models are loaded, sub-agents can choose the best one for their task autonomously.

**Routing criteria:**
- Task type: coding → code-capable model (e.g. Qwen2.5-Coder), reasoning → reasoning model, quick lookup → small fast model
- Model capabilities: detected at load time (vision, tools, thinking, context length)
- VRAM availability: if a model is at capacity, route to the next best

**Implementation:**
- `model_registry` service — tracks loaded models with their capabilities and current load
- `route_model(task_type, requirements)` — returns the best available model ID
- `invoke_agent` extended with optional `model_hint` — orchestrator can suggest, sub-agent decides

**Current constraint:** not useful until at least 2 models are loaded. Implement after parallel loading is stable.

---

## v1.2+ — Long-term backlog

### Fine-tuning automation

Automate the finetune → eval → finetune loop. Requires a reliable judge model first.

Order:
1. Manual fine-tuning UI (done in v0.4)
2. Post-fine-tune requantization (GGUF/AWQ)
3. Dataset generation by AI, HF import, manual creation
4. Automated finetune → test → finetune cycle
5. Judge model emerges from the process (end goal)

### Multi-node cluster

Distribute inference across multiple machines via Ray + vLLM.

See [cluster-integration-plan.md](cluster-integration-plan.md) for the full plan.

### Other

- Tool calling native vLLM in `generate_with_tools`
- MCP server: EchoHub exposes a server so Claude Code can drive local models
- EchoForge ↔ EchoHub local API
- `.AppImage` and `.deb` release packages
- Scrapling as a native MCP server

---

## Principles that don't change

Every feature on this roadmap follows the same rules as everything already built:

- **Local by default** — cloud dependencies are opt-in, never required
- **No manual config** — everything configurable from the UI
- **Sequential before parallel** — parallel model loading comes before model routing. Don't build the routing until there's something to route between.
- **One active session** — until parallel loading is stable, all remote messages go to the single active session
