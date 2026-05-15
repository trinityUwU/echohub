# EchoHub — Arborescence

```
/mnt/projects/echohub/
├── backend/
│   ├── main.py                         # FastAPI entry + lifespan, routers
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── models.py                   # search (paginé), download (gguf_file), check-access, delete
│   │   ├── inference.py                # load (auto-unload), unload, chat SSE, summarize, /engine
│   │   ├── settings.py                 # HF token, GPU backend detection
│   │   └── system.py                   # GPU stats, engine log
│   ├── services/
│   │   ├── __init__.py
│   │   ├── engine_router.py            # détection format/GPU, dispatch llama/vLLM
│   │   ├── llama_service.py            # llama-cpp-python, GGUF, cross-platform
│   │   ├── vllm_service.py             # vLLM subprocess, AWQ/GPTQ, NVIDIA only
│   │   ├── hf_service.py               # HF search/download, variants GGUF, gated, description
│   │   ├── download_manager.py         # download queue, gguf_file spécifique, cancel
│   │   └── gpu_service.py              # nvidia-smi parser
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py                  # ModelInfo (gated, gguf_files, description...), ChatRequest...
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
│   └── src/
│       ├── main.tsx
│       ├── index.css
│       ├── App.tsx                     # layout, Tab type (browse/chat/settings), CpuOnlyBanner
│       ├── api/
│       │   └── client.ts               # tous les appels API + SSE helpers
│       ├── components/
│       │   ├── CapabilityBadges.tsx    # badges réutilisables (vision/thinking/code/tools/multilingual)
│       │   ├── ChatPanel.tsx           # chat UI, Vision/Thinking toggles, attachments
│       │   ├── ChatSettingsSidebar.tsx # chat settings (temp, top_p, system prompt, profils)
│       │   ├── CpuOnlyBanner.tsx       # bannière CPU-only avec instructions fix par plateforme
│       │   ├── DownloadPanel.tsx       # progress downloads sidebar
│       │   ├── GpuMonitor.tsx          # VRAM + GPU% bars
│       │   ├── LibrarySidebar.tsx      # modèles téléchargés + load/unload/delete
│       │   ├── LoadConfigModal.tsx     # config vLLM (ctx, GPU util, CUDA graph overhead)
│       │   ├── LoadedModel.tsx         # topbar modèle chargé + unload, "Unloading…" state
│       │   ├── MarkdownContent.tsx     # markdown renderer
│       │   ├── MessageContent.tsx      # message bubble
│       │   ├── ModelBrowser.tsx        # split panel LM Studio (liste+détail, GGUF dropdown)
│       │   ├── ModelCard.tsx           # carte modèle (download/load, VRAM badge)
│       │   ├── ModelDetailModal.tsx    # détail modèle en modal
│       │   ├── ModelPickerModal.tsx    # sélection modèle (arch tags, manual toggle)
│       │   ├── SettingsPage.tsx        # settings : HF token, models dir, about
│       │   ├── ThinkingBlock.tsx       # bloc thinking/reasoning collapsible
│       │   └── VramBadge.tsx           # badge VRAM inline
│       ├── hooks/
│       │   ├── useChat.ts              # chat SSE, buildUserContent (multimodal)
│       │   ├── useConversations.ts     # CRUD conversations localStorage
│       │   ├── useGpu.ts               # polling GPU stats
│       │   └── useModels.ts            # downloaded/loaded state, auto-unload avant load
│       └── types/
│           └── index.ts                # ModelInfo (gated, gguf_files...), Attachment, ContentPart...
├── logs/                               # créé par start.sh (gitignored)
│   ├── backend.log
│   ├── frontend.log
│   ├── vllm.log
│   └── llama.log
├── .echoforge.yml
├── .gitignore
├── start.sh                            # détecte hardware, installe llama-cpp avec bon backend
├── stop.sh
├── restart.sh
├── STATE.md
├── TODO.md
├── ARBORESCENCE.md
└── README.md
```
