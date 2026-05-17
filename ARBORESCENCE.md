# ARBORESCENCE — EchoHub
*Dernière mise à jour : 2026-05-17*

## Backend (`backend/`)
```
backend/
├── main.py                        # FastAPI app, lifespan, CORS, routers
├── models/
│   ├── schemas.py                 # Pydantic : ModelInfo, LoadRequest, ChatRequest, GpuStats…
├── routers/
│   ├── conversations.py           # CRUD conversations + messages + archive/unarchive
│   ├── inference.py               # load/unload/chat/benchmark/ws endpoints
│   ├── installer.py               # SSE installation stream (venv, llama-cpp, vLLM)
│   ├── models.py                  # search HF, download, compatibility check, readme
│   ├── settings.py                # HF token, GPU backend, paths, engines, update check
│   ├── system.py                  # GPU stats endpoint
└── services/
    ├── config_service.py          # models_dir, vllm_envs_dir, inference settings (config.json)
    ├── db.py                      # SQLite WAL, conversations, messages, app_state
    ├── download_manager.py        # HF download jobs, progress, cancel
    ├── engine_router.py           # Format detection, GPU detect, route llama/vLLM
    ├── gpu_service.py             # NVIDIA/AMD/Apple stats cascade
    ├── hf_service.py              # Search HF, download, list local, compatibility
    ├── llama_service.py           # llama-cpp-python CUDA/ROCm/Metal/CPU
    ├── migration_service.py       # State machine migration paths (resume crash)
    ├── user_data.py               # Platform paths (~/.local/share/echohub)
    ├── vllm_manager.py            # Multi-venv vLLM, install SSE, delete guard
    └── vllm_service.py            # vLLM subprocess, OOM retry, python_override
```

## Frontend (`frontend/src/`)
```
src/
├── App.tsx                        # Root : pages, modals, UpdateBanner, ChangelogNotification
├── main.tsx                       # Bootstrap : check install_complete → InstallerApp ou App
├── index.css                      # Reset global, scrollbar, input[range]
├── api/
│   ├── base.ts                    # resolveBase() : invoke Tauri ou /api proxy, health check
│   └── client.ts                  # Tous les appels API typés
├── hooks/
│   ├── useChat.ts                 # Streaming chat, compaction, persist messages
│   ├── useConversations.ts        # CRUD conversations + archive + archivedConversations
│   ├── useFavorites.ts            # Favoris modèles (localStorage)
│   ├── useGpu.ts                  # Poll GPU stats toutes les 2s
│   ├── useModels.ts               # Downloaded models, load/unload, polling état
│   └── useProfiles.ts             # Profils chat, userModified flag, persistence
├── types/index.ts                 # Tous les types TypeScript
├── installer/
│   └── InstallerApp.tsx           # Setup natif Tauri (Welcome, Paths, Installing, Done)
├── components/
│   ├── chat/
│   │   ├── ChatPage.tsx           # Page chat principale, orchestration
│   │   ├── ChatTopBar.tsx         # Topbar : model picker, Eject rouge, Export, Clear
│   │   ├── CpuBanner.tsx          # Warning si pas de GPU NVIDIA
│   │   ├── InputBar.tsx           # Input texte + attachements images (vision)
│   │   ├── MarkdownContent.tsx    # Rendu markdown avec code highlighting
│   │   ├── MessageRow.tsx         # Bulle message (Framer Motion slide-up)
│   │   ├── RightPanel.tsx         # Profils, system prompt, paramètres, toggles
│   │   └── ThinkingBlock.tsx      # Bloc thinking dépliable (streaming aware)
│   ├── discover/
│   │   ├── DiscoverPage.tsx       # Search HF, filtres, favoris
│   │   ├── ModelCard.tsx          # Carte modèle (favori, compat)
│   │   └── ModelDetailPanel.tsx   # Panel détail : Info/README, GGUF variants, CompatBanner
│   ├── downloads/
│   │   └── DownloadsPage.tsx      # Jobs download actifs
│   ├── library/
│   │   └── LibraryPage.tsx        # Modèles téléchargés (delete only)
│   ├── modals/
│   │   ├── LoadModelModal.tsx     # VRAM preview réactive, CUDA graphs, GPU limits
│   │   └── ModelPickerModal.tsx   # Sélecteur modèle depuis chat
│   ├── nav/
│   │   ├── ConvSidebar.tsx        # Sidebar conversations (Active/Archived, hover delete/archive, GPU dépliable)
│   │   └── NavRail.tsx            # Navigation rail gauche (icônes)
│   ├── onboarding/
│   │   └── OnboardingWizard.tsx   # Wizard 6 étapes premier lancement (SVG, pas d'emojis)
│   ├── settings/
│   │   ├── BenchmarkTab.tsx       # Benchmark tok/s, TTFT, historique, share card
│   │   ├── EnginesTab.tsx         # Multi-venv vLLM : liste, install SSE, delete
│   │   ├── PathsTab.tsx           # Paths configurables + migration panel
│   │   └── SettingsPage.tsx       # Setup, Engines, Paths, Hardware, Benchmark, About
│   └── shared/
│       ├── Accordion.tsx          # Accordéon générique
│       ├── Badge.tsx              # Badges colorés (quant, think, vision…)
│       ├── Btn.tsx                # Bouton primary/ghost/danger
│       ├── ChangelogNotification.tsx # Toast post-update avec changelog
│       ├── Dialog.tsx             # Dialog custom (remplace alert/confirm natif)
│       ├── MigrationBanner.tsx    # Banner si migration path pending
│       ├── Modal.tsx              # Modal générique
│       ├── Slider.tsx             # Slider avec label/value
│       ├── Toggle.tsx             # Toggle switch (outline-none)
│       └── UpdateBanner.tsx       # Notification update dispo + git pull SSE
```

## Infra
```
frontend/src-tauri/
├── src/lib.rs                     # Rust : spawn backend, kill, get_backend_port command
├── tauri.conf.json                # App config : AppImage+deb, CSP 127.0.0.1:*, 1280x800
└── capabilities/default.json     # shell:spawn, shell:kill

docs/
├── v0.1-foundation.md             # Technique : dual-engine, VRAM, compat check
├── v0.2-multi-vllm.md             # Technique : multi-venv vLLM, paths, installeur
└── private/                       # ⚠ LOCAL ONLY (gitignored) — stratégie marché

mockup/index.html                  # Maquette HTML statique (référence design)
start.sh / stop.sh / restart.sh   # Scripts OS (Arch/Debian/Fedora/macOS)
build.sh                           # Build packages (.AppImage, .deb)
```
