# EchoHub — Arborescence
*2026-05-16*

```
/mnt/projects/echohub/
├── backend/
│   ├── main.py                         # FastAPI entry + lifespan, db.init_db()
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── conversations.py            # CRUD conversations + messages (8 endpoints)
│   │   ├── inference.py                # load/unload/chat/summarize via engine_router
│   │   ├── models.py                   # search paginé, download gguf_file, check-access
│   │   ├── settings.py                 # HF token, GPU backend detection
│   │   └── system.py                   # GPU stats, engine log
│   ├── services/
│   │   ├── __init__.py
│   │   ├── db.py                       # SQLite WAL, thread-safe, conversations+messages
│   │   ├── download_manager.py         # queue + gguf_file spécifique + cancel
│   │   ├── engine_router.py            # détecte format/GPU, dispatch llama/vLLM
│   │   ├── gpu_service.py              # nvidia-smi parser
│   │   ├── hf_service.py               # HF search/download, variants GGUF, gated
│   │   ├── llama_service.py            # llama-cpp-python GGUF cross-platform (CUDA/ROCm/Metal/CPU)
│   │   ├── user_data.py                # OS-aware user data dir (~/.local/share/echohub etc.)
│   │   └── vllm_service.py             # vLLM subprocess AWQ/GPTQ (NVIDIA only)
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py                  # Pydantic: ModelInfo, ChatMessage, ConversationOut...
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── package.json
│   ├── bun.lock
│   ├── tsconfig.json
│   ├── vite.config.ts                  # port 37822, /api proxy → 37821
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   ├── .env.development                # VITE_MSW=true pour activer MSW
│   ├── public/
│   │   └── mockServiceWorker.js        # Service worker MSW
│   └── src/
│       ├── main.tsx                    # Bootstrap MSW si VITE_MSW=true
│       ├── App.tsx                     # Layout principal, routing tabs
│       ├── index.css                   # Reset, scrollbar, focus
│       ├── api/
│       │   └── client.ts               # Tous les appels API + SSE/WS helpers
│       ├── hooks/
│       │   ├── useChat.ts              # Chat SSE, AbortController stop, persist via addMessage
│       │   ├── useConversations.ts     # CRUD conversations via API (plus localStorage)
│       │   ├── useGpu.ts               # Polling GPU stats
│       │   └── useModels.ts            # Models state, auto-unload avant load
│       ├── mocks/
│       │   ├── browser.ts              # setupWorker MSW
│       │   ├── handlers.ts             # Tous les handlers API mockés
│       │   └── data.ts                 # Données réalistes (GPU, modèles, conversations)
│       ├── types/
│       │   └── index.ts                # Tous les types TS (ModelInfo, ChatMessage, etc.)
│       └── components/
│           ├── ui/                     # Composants layout de base
│           │   ├── TopBar.tsx          # Logo + nom (branding only)
│           │   ├── Sidebar.tsx         # Navigation + downloads + GPU monitor
│           │   ├── GpuMonitor.tsx      # VRAM + GPU% barres
│           │   ├── CpuOnlyBanner.tsx   # Bannière si llama-cpp sans GPU
│           │   ├── LoadConfigModal.tsx # Config load (context, GPU util, VRAM preview)
│           │   └── ModelPickerModal.tsx # Sélection modèle depuis chat
│           ├── discover/               # Browser de modèles HF
│           │   ├── DiscoverPage.tsx    # Split panel liste + détail
│           │   └── ModelDetail.tsx     # Panel droit (description, GGUF selector, download)
│           ├── chat/                   # Interface de chat
│           │   ├── ChatView.tsx        # Layout chat (conversations + messages + input)
│           │   ├── ThinkingBlock.tsx   # Bloc <think> collapsible Framer Motion
│           │   └── MessageContent.tsx  # Markdown parser + ContentPart[]
│           └── settings/
│               └── SettingsPage.tsx    # HF Token, GPU backend, About
│
│   NOTE: src/components/*.tsx (anciens composants à la racine) — obsolètes,
│         remplacés par les sous-dossiers ui/discover/chat/settings/
│         À supprimer quand le nouveau design sera validé.
│
├── .brainstorm/
│   ├── STATE.md                        # État brainstorm session design
│   └── tauri-architecture.md           # Plan migration Tauri v2
├── logs/                               # Gitignored, créés par start.sh
│   ├── backend.log
│   ├── frontend.log
│   ├── vllm.log
│   └── llama.log
├── .echoforge.yml
├── .gitignore
├── start.sh                            # Détecte hardware, installe llama-cpp avec bon backend
├── stop.sh
├── restart.sh
├── STATE.md
├── TODO.md
├── ARBORESCENCE.md
└── README.md
```

## Data dir (runtime, hors repo)
```
~/.local/share/echohub/          # Linux
%APPDATA%\echohub\               # Windows
~/Library/Application Support/echohub/  # macOS
  ├── echohub.db                  # SQLite WAL — conversations, messages, stats
  └── config.json                 # Futur : préférences utilisateur
```
