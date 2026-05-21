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

## v1.1 — Semantic Memory & Conversation Architecture

### Why this comes before parallel models

The current storage (SQLite) doesn't scale — it's heavy, unsearchable semantically, and locks the agent into a flat view of history. This needs to be fixed before adding more complexity on top.

No framework (no LangChain, no LangGraph). A clean `ConversationManager` in ~150 lines of Python handles everything. LangGraph stays on the table for the sub-agent harness only.

---

### Step 1 — ConversationManager (JSON + sliding window)

Replace SQLite message storage with one JSON file per conversation.

```
conversations/
  {conv_id}.json        ← ordered messages, ~10KB per conv
  _index.json           ← lightweight metadata (id, title, date, model, project)
```

`ConversationManager` handles:
- `load(conv_id)` / `save(conv_id)` — read/write JSON
- `add_message(role, content)`
- `to_context(max_tokens)` → sliding window → OpenAI `[{role, content}]` array
- `summarize_if_needed()` — calls the loaded model if conversation exceeds threshold

Context injection format (unchanged — pure OpenAI):
```
[system]    identity + memory instructions (if memory enabled)
[system]    top 3-5 ChromaDB memories (if memory enabled)
[...]       sliding window of last N messages
[user]      current message
```

**Migration:** one-shot export SQLite → JSON files on first launch after upgrade. Irreversible. Existing conversations preserved.

---

### Step 2 — Embedding service

- Model: `nomic-embed-text-v1.5` GGUF — 137MB, multilingual, CPU-only (`n_gpu_layers=0`)
- Separate llama.cpp instance from the inference model — zero GPU impact
- ~10ms per embedding
- Installed automatically by `start.sh`, documented in onboarding

```python
# backend/services/embedding_service.py
class EmbeddingService:
    def encode(self, text: str) -> list[float]: ...
    def encode_batch(self, texts: list[str]) -> list[list[float]]: ...
```

---

### Step 3 — ChromaDB memory layer

ChromaDB stores **semantic chunks only** — not raw messages. What gets vectorized:
- Key facts and decisions from conversations
- User traits and preferences
- Project context
- Conversation summaries

```
chromadb/
  echohub_memory/
    user_traits        ← personality, preferences, habits
    conversation_facts ← decisions, facts, context per conv
    global_context     ← cross-conversation knowledge
```

**Toggle per conversation** — off means no ChromaDB read/write, pure JSON history, classic prompt.

---

### Step 4 — Settings > Memory

New tab in Settings:
- Global on/off toggle
- Schemas: user traits, ideas, project context, decisions — all configurable
- View all stored memories, delete individual entries
- Per-conversation memory toggle (also available from chat header)
- Storage stats (ChromaDB size, number of memories)

---

### Step 5 — System prompts

Two variants injected conditionally:

**With memory:**
> You have access to a semantic memory system. This is your persistent brain — all knowledge about the user, past decisions, preferences, and project context flows from here. Use `search_memory(query)` to retrieve relevant memories before answering. Use `store_memory(content, type)` to save important new information. You are not limited to the current conversation — if the user asks you to search other conversations, use `search_memory` with a broad query.

**Without memory:**
> Standard prompt, no memory mention.

The agent navigates memory autonomously — no hardcoded permission rules. If the user asks "search other conversations for X", the model understands it should call `search_memory` with cross-conversation scope.

---

## v1.2 — Parallel Models & Model Routing

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

## v1.3+ — Long-term backlog

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

## Implementation order summary

```
v1.0  Agent Harness + Remote Access (Telegram)
v1.1  ConversationManager JSON → Embedding service → ChromaDB → Settings/Memory → Prompts
v1.2  Parallel models → Model routing in sub-agents
v1.3+ Fine-tuning automation, cluster, tooling
```

**Rule:** don't touch ChromaDB until `ConversationManager` is clean and tested. Don't add memory until the embedding service runs stably on CPU. Each step is a hard prerequisite for the next.

---

## Principles that don't change

Every feature on this roadmap follows the same rules as everything already built:

- **Local by default** — cloud dependencies are opt-in, never required
- **No manual config** — everything configurable from the UI
- **Sequential before parallel** — parallel model loading comes before model routing. Don't build the routing until there's something to route between.
- **One active session** — until parallel loading is stable, all remote messages go to the single active session
- **No framework for conversation management** — no LangChain, no LangGraph for the ConversationManager. Plain Python, plain OpenAI format. LangGraph only if sub-agent harness complexity genuinely requires it.
- **ChromaDB = semantic layer only** — raw messages stay in JSON files. Never store message arrays in ChromaDB.
