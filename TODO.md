# TODO — EchoHub
*Dernière mise à jour : 2026-05-16*

## En cours
- [x] **Maquette HTML complète** — tous les états, modals, accordéons
- [x] **Intégration Tauri v2** — init, composants React, sidecar Python, port dynamique

## À faire (priorité)

### Maquette HTML (P1 — session en cours)
- [x] Modal "Load model" — sliders GPU util + context len, preview VRAM, log vLLM live
- [x] Banner CPU-only — affiché si pas de GPU détecté
- [x] État loading modèle dans topbar — progress bar heuristique + eject
- [x] Modal "Model picker" — changer de modèle depuis le chat

### Tauri v2 (P1)
- [x] `cargo tauri init` dans le repo
- [x] `tauri.conf.json` : CSP, window size, identifiers (agency.echo.echohub)
- [x] Componentiser en React depuis la maquette (NavRail, ConvSidebar, ChatPage, RightPanel, InputBar, LibraryPage, DiscoverPage, DownloadsPage, SettingsPage, LoadModelModal, ModelPickerModal)
- [x] Build TypeScript propre — 0 erreur
- [x] `bun tauri dev` qui tourne — validé visuellement avec vrai backend
- [x] Python sidecar — Rust spawne uvicorn, port dynamique, kill à la fermeture
- [x] Port injecté via invoke('get_backend_port')
- [ ] Packaging binaire .AppImage / .deb / .dmg

### Backend (P2)
- [ ] Test load GGUF réel avec llama-cpp CUDA (après restart backend)
- [ ] Badge engine dans l'UI (llama/vLLM visible sur modèle chargé)
- [ ] LoadConfigModal : afficher engine détecté (GGUF→llama, AWQ→vLLM)
- [ ] GPU service : fallback AMD (rocm-smi) et Mac (powermetrics)
- [ ] Context window depuis metadata GGUF (gguf-reader)

### UX/Setup (P2)
- [ ] Page Setup dans l'UI — installation deps depuis interface
  - Détection hardware auto
  - Installation llama-cpp avec bon backend (CUDA/ROCm/Metal/CPU)
  - Logs temps réel + progress bar
- [ ] Onboarding tutoriel premier lancement (fausses données, walkthrough)

### Features (P3)
- [ ] HF_TOKEN : feedback si token invalide
- [ ] Chat export (markdown)
- [ ] Multi-GPU support vLLM (tensor_parallel_size)
- [ ] Model card README preview dans ModelBrowser
- [ ] Port conflict detection avant de lancer un engine

## Backlog
- [ ] MCP server EchoHub → Claude Code pilote les modèles locaux
- [ ] EchoForge ↔ EchoHub API locale
- [ ] Orchestrateur cloud (Groq/Mistral) qui pilote agents locaux

## Terminé ✅
- [x] Maquette HTML `mockup/index.html` — design complet 5 pages + accordéons right panel
- [x] Scaffold complet backend + frontend
- [x] vLLM subprocess manager (eject, VRAM cleanup, OOM auto-retry)
- [x] engine_router + llama_service (dual-engine GGUF/vLLM)
- [x] llama-cpp-python compilé CUDA 13 + gcc-15 (RTX 3060 arch 86)
- [x] Download manager + gguf_file spécifique + fix total_gb
- [x] SQLite user data dir (conversations + messages + stats)
- [x] useConversations migré localStorage → API REST
- [x] useChat persist messages + stats via addMessage
- [x] Stop génération (AbortController + bouton stop)
- [x] Auto-unload avant load nouveau modèle
- [x] Thinking toggle universel (Qwen3 /think, autres natif)
- [x] MSW installé et fonctionnel
- [x] HF Token settings + check gated avant download
- [x] fix refresh loop SSE downloads
- [x] CUDA graph overhead (+1.1GB) dans LoadConfigModal
- [x] GitHub public : https://github.com/trinityUwU/echohub
