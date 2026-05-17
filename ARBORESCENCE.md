# ARBORESCENCE — EchoHub
*Dernière mise à jour : 2026-05-17 (session 9)*

```
echohub/
├── start.sh                          # Lance cargo tauri dev (setup + launch)
├── stop.sh                           # Arrête les processus
├── restart.sh                        # Stop + start
├── STATE.md / TODO.md / ARBORESCENCE.md / README.md
├── .echoforge.yml
│
├── backend/
│   ├── main.py                       # FastAPI app, CORS, lifespan, global exception handler
│   ├── models/schemas.py             # Pydantic models
│   ├── routers/
│   │   ├── conversations.py          # CRUD + archive/rename/delete
│   │   ├── inference.py              # Load/unload/stream
│   │   ├── installer.py              # SSE install (llama-cpp + vLLM par défaut si NVIDIA)
│   │   ├── models.py                 # Browse HF, download
│   │   ├── settings.py               # Paths, engines, hardware, update
│   │   └── system.py                 # GPU stats
│   └── services/
│       ├── config_service.py         # models_dir, vllm_envs_dir
│       ├── db.py                     # SQLite WAL + migrations ALTER TABLE auto
│       ├── download_manager.py       # Download HF + cancel
│       ├── engine_router.py          # GGUF→llama / AWQ→vllm routing
│       ├── gpu_service.py            # nvidia-smi polling
│       ├── hf_service.py             # Search HF, token validation
│       ├── llama_service.py          # llama-cpp-python GGUF
│       ├── migration_service.py      # Migration fichiers cancel+rollback
│       ├── user_data.py              # ~/.local/share/echohub/
│       ├── vllm_manager.py           # Multi-venv vLLM, cache operational TTL 120s
│       └── vllm_service.py           # vLLM subprocess AWQ/GPTQ
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx                  # createRoot unique module-level, ContextMenuProvider
│   │   ├── App.tsx                   # Pages routing
│   │   ├── api/base.ts               # resolveBase() Tauri/proxy
│   │   ├── api/client.ts             # Fonctions API typées
│   │   ├── hooks/
│   │   │   ├── useChat.ts            # Stream + sendFromHistory() pour regenerate/edit
│   │   │   ├── useConversations.ts   # CRUD conversations + rename
│   │   │   ├── useGpu.ts / useModels.ts / useProfiles.ts / useFavorites.ts
│   │   ├── installer/InstallerApp.tsx # Welcome→Paths→Installing→Done
│   │   ├── mocks/                    # MSW handlers
│   │   └── components/
│   │       ├── nav/
│   │       │   ├── NavRail.tsx
│   │       │   └── ConvSidebar.tsx   # Context menu clic droit (rename/archive/delete)
│   │       ├── chat/
│   │       │   ├── ChatPage.tsx      # Orchestration + handleRegenerate + handleEditUser
│   │       │   ├── ChatTopBar.tsx
│   │       │   ├── InputBar.tsx
│   │       │   ├── MarkdownContent.tsx # atom-one-dark, h1-h4, tables, inline code
│   │       │   ├── MessageRow.tsx    # Footer copy/edit/regenerate toujours visible
│   │       │   ├── RightPanel.tsx
│   │       │   └── ThinkingBlock.tsx
│   │       ├── discover/ (DiscoverPage, ModelCard, ModelDetailPanel)
│   │       ├── downloads/ (DownloadsPage)
│   │       ├── library/ (LibraryPage)
│   │       ├── modals/ (LoadModelModal, ModelPickerModal)
│   │       ├── onboarding/ (OnboardingWizard)
│   │       ├── settings/
│   │       │   ├── BenchmarkTab.tsx
│   │       │   ├── EnginesTab.tsx    # badge default, cache operational, refresh
│   │       │   ├── PathsTab.tsx      # migration cancel/rollback
│   │       │   └── SettingsPage.tsx  # About avec Update now inline
│   │       └── shared/
│   │           ├── ContextMenu.tsx   # Provider global, bloque menu natif
│   │           ├── useContextMenu.ts # Hook séparé (Vite HMR compat)
│   │           ├── LoadingSplash.tsx # Splash backend wait
│   │           ├── UpdateBanner.tsx
│   │           ├── ChangelogNotification.tsx
│   │           ├── MigrationBanner.tsx
│   │           ├── Dialog.tsx / Toggle.tsx / Slider.tsx / Modal.tsx / Badge.tsx / Btn.tsx / Accordion.tsx
│   └── src-tauri/
│       ├── src/lib.rs                # spawn_backend, locate_project_root nth(5)
│       ├── tauri.conf.json
│       └── capabilities/default.json
│
├── docs/
│   ├── v0.1-foundation.md
│   ├── v0.2-multi-vllm.md
│   └── private/ (gitignore — market-research, reddit-strategy, posts-drafts…)
└── mockup/index.html
```

## ⚠️ Fichiers héritage pré-refactor (à supprimer — non importés)

```
frontend/src/components/ChatPanel.tsx
frontend/src/components/ChatSettingsSidebar.tsx
frontend/src/components/CapabilityBadges.tsx
frontend/src/components/DownloadPanel.tsx
frontend/src/components/GpuMonitor.tsx / LibrarySidebar.tsx / LoadConfigModal.tsx
frontend/src/components/LoadedModel.tsx / MarkdownContent.tsx / MessageContent.tsx
frontend/src/components/ModelBrowser.tsx / ModelCard.tsx / ModelDetailModal.tsx / ModelPickerModal.tsx
frontend/src/components/SettingsPage.tsx / ThinkingBlock.tsx / VramBadge.tsx / CpuOnlyBanner.tsx
frontend/src/components/ui/  (tout le dossier)
```
