# ARBORESCENCE — EchoHub
*Dernière mise à jour : 2026-05-22 (session 24)*

## Backend

```
backend/
├── main.py                          ← FastAPI app, lifespan, routers, migrate_from_sqlite()
├── models/
│   └── schemas.py                   ← Pydantic models (ChatRequest, LoadRequest, ModelInfo, MessageStats...)
└── routers/
│   ├── conversations.py             ← CRUD conversations (branché sur conversation_manager)
│   ├── finetune.py                  ← Fine-tuning jobs, pairs, profiles, eval
│   ├── inference.py                 ← /chat, /tool-chat (system prompts dynamiques), /load, benchmarks
│   ├── installer.py                 ← Onboarding, dépendances système
│   ├── memory.py                    ← /memory/store, /memory/search, /memory/list, /memory/stats
│   ├── models.py                    ← Download, search HF, model info
│   ├── projects.py                  ← Project conversations (branché sur conversation_manager)
│   ├── settings.py                  ← Config app, benchmarks, GPU settings
│   ├── skills*.py                   ← MCP skills (discover, registry, mcp, helpers)
│   └── system.py                    ← Health, VRAM, GPU stats
└── services/
    ├── conversation_manager.py      ← CRUD JSON convs (chat + projets), sliding window, migration SQLite
    ├── db.py                        ← SQLite legacy (benchmarks, fine-tuning, MCP servers, app_state)
    ├── embedding_service.py         ← nomic-embed-text-v1.5 GGUF CPU-only, lazy init, 768 dims
    ├── engine_router.py             ← Route llama/vLLM selon format, get_status, generate, generate_with_tools
    ├── finetune_service.py          ← Pipeline fine-tuning LoRA/unsloth
    ├── gguf_utils.py                ← Parse metadata GGUF (MTP detection, quant type)
    ├── gpu_service.py               ← Polling nvidia-smi, VRAM samples
    ├── harness_service.py           ← Language detection, syntax/lint/types pipeline, result normalizer
    ├── hf_service.py                ← HuggingFace search, model info, download
    ├── llama_lock.py                ← Mutex global partagé tous appels llama.cpp (embedding + inférence)
    ├── llama_service.py             ← Inférence GGUF via llama-cpp-python, load/unload, streaming
    ├── mcp_client.py                ← Client MCP (tool calls vers servers MCP)
    ├── mcp_manager.py               ← Gestion lifecycle servers MCP
    ├── mcp_stdio_client.py          ← Client MCP stdio
    ├── memory_service.py            ← ChromaDB store/search/delete/stats, scope conv/project/global
    ├── migration_service.py         ← Migration modèles, gguf paths
    ├── multi_gpu.py                 ← Détection multi-GPU, tensor_split proportionnel
    ├── quality_scorer.py            ← Scoring benchmarks (compilation, keywords, format)
    ├── tool_agent.py                ← _invoke_agent(), harness profiles, boucle tool-use isolée
    ├── tool_definitions.py          ← TOOLS[] OpenAI format + get_tools()
    ├── tool_memory.py               ← _search_memory(), _store_memory()
    ├── tool_service.py              ← execute_tool() dispatcher, workspace helpers, _safe_path
    ├── user_data.py                 ← Paths OS-aware (~/.local/share/echohub/)
    ├── vllm_generate.py             ← generate() + generate_with_tools() — lecture _model() via sys.modules
    ├── vllm_loader.py               ← build_vllm_cmd(), parse_load_error(), resolve_active_version()
    ├── vllm_manager.py              ← Multi-venv vLLM, list_versions, get_python_for_version
    ├── vllm_process.py              ← PID file helpers, _kill_pid(), _log_vram_freed()
    ├── vllm_service.py              ← Lifecycle vLLM (load_model, unload, get_status, re-exports)
    └── vllm_vram.py                 ← record_vram_sample(), compute_safe_gpu_utilization(), _parse_suggested_max_len()
```

## Frontend

```
frontend/src/
├── App.tsx                          ← Root, routing pages, useModels, echohub:reload-ctx handler
├── api/
│   ├── base.ts                      ← apiRequest, resolveBase (Tauri port ou fallback)
│   ├── client.ts                    ← Toutes les API calls (conversations, models, inference, memory...)
│   └── engineTimings.ts             ← Store global timings llama.cpp (SSE → zustand-like)
├── components/
│   ├── chat/
│   │   ├── ChatPage.tsx             ← Page chat principale (useChat/useToolChat, conv switch, skills)
│   │   ├── ChatTopBar.tsx           ← Topbar modèle chargé + Memory toggle + Export/Clear
│   │   ├── DevPanel.tsx             ← Sidebar droite : tool calls status en temps réel
│   │   ├── InputBar.tsx             ← Zone de saisie, attachments, commandes slash
│   │   ├── MarkdownContent.tsx      ← Rendu markdown avec code highlighting
│   │   ├── MessageContent.tsx       ← Parse think/tool_call/tool_result, ToolResultBlock enrichi
│   │   ├── MessageRow.tsx           ← Message individuel, footer stats, bouton reload, memo
│   │   ├── ProjectsHub.tsx          ← Hub sélection projet
│   │   ├── ProjectsPanel.tsx        ← Panel projet actif (Dev/Docs/Research)
│   │   └── ThinkingBlock.tsx        ← Bloc <think> expandable
│   ├── modals/
│   │   ├── LoadModelModal.tsx       ← Modal chargement : profils, GPU layers, KV quant, ctx_mode
│   │   └── ModelPickerModal.tsx     ← Picker modèle chargé
│   ├── nav/
│   │   ├── ConvSidebar.tsx          ← Sidebar conversations (Active/Archived tabs, context menu)
│   │   └── NavRail.tsx              ← Navigation principale gauche
│   ├── settings/
│   │   ├── BenchmarkTab.tsx         ← Benchmarks, leaderboard, compare
│   │   ├── EnginesTab.tsx           ← vLLM versions, llama.cpp capabilities
│   │   ├── MemoryTab.tsx            ← ChromaDB stats, liste memories, filtres, delete
│   │   ├── PathsTab.tsx             ← MODELS_DIR, data dir
│   │   ├── RunBenchmarkModal.tsx    ← Config benchmark run
│   │   └── SettingsPage.tsx         ← Page settings avec nav (Setup/Engines/Benchmark/Hardware/Memory/About)
│   ├── shared/                      ← Composants UI partagés (Toggle, Modal, Toast, ContextMenu...)
│   └── skills/                      ← Skills/MCP UI (Discover, Installed, MCP section)
├── hooks/
│   ├── useChat.ts                   ← Chat normal (useChat, streaming, ctx_exceeded, loadConfig)
│   ├── useChatMode.ts               ← ProjectMode (dev/docs/research), vue (chat/projects)
│   ├── useConversations.ts          ← CRUD conversations, toggleMemory, chatMessageFromStored
│   ├── useModels.ts                 ← Load/unload modèle, polling, activeLoadConfig + ctxMode
│   ├── useProfiles.ts               ← Profils chat (paramètres température, etc.)
│   ├── useProjectConversations.ts   ← Conversations dans les projets
│   ├── useProjects.ts               ← CRUD projets
│   ├── useSkills.ts                 ← Skills actifs, enabledTools, awarenessBlock, hasToolSkills
│   ├── useToast.ts                  ← Toast notifications
│   └── useToolChat.ts               ← Tool-chat (streaming SSE, tool calls, sendFromHistory, stats persistées)
└── types/
    └── index.ts                     ← Types TS (ModelInfo, ChatMessage, LoadConfig+ctx_mode, MessageStats...)
```

## Docs & Scripts

```
docs/
├── agent-harness-architecture.md    ← Architecture multi-agents, harness, compound tools
├── roadmap.md                       ← v1.0–v1.3+ features planifiées
├── v1.1-memory-agents-architecture.md ← Architecture unifiée mémoire + agents + harness
├── v0.1–v0.9-*.md                   ← Historique features par version
└── private/                         ← Go-to-market, Reddit strategy, posts drafts

scripts/
├── lint_standards.py                ← Linter normes personnalisées (file/fn/line size, any, try/catch)
└── reddit_hunt.py                   ← Utilitaire Reddit

.claude/
└── commands/
    └── lint.md                      ← Slash command /lint

~/.local/share/echohub/
├── conversations/                   ← {id}.json + _index.json (chat convs)
├── project_conversations/           ← {id}.json + _index.json (project convs)
├── chromadb/echohub_memory/         ← Memories sémantiques (user_traits, decisions, facts...)
└── .conv_migrated                   ← Marqueur migration SQLite→JSON

/mnt/models/echohub/
├── {model_id}/                      ← Modèles téléchargés
└── _embeddings/
    └── nomic-embed-text-v1.5.Q4_K_M.gguf ← Modèle embedding CPU
```
