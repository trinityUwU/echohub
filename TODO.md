# TODO — EchoHub
*Dernière mise à jour : 2026-05-17*

## En cours
- [ ] **Onboarding wizard** — premier lancement, wizard multi-étapes
- [ ] **start.sh universel** — depuis clone, détection OS, build complet

## Terminé cette session ✅ (v0.2 en cours)
- [x] vllm_manager.py — scan, taille, validation, install SSE, delete guard
- [x] Settings/Engines — liste versions, install, delete, coverage warning
- [x] config_service.py — models_dir, vllm_envs_dir, inference settings persistés
- [x] migration_service.py — state machine, resume crash, copy+verify
- [x] PathsTab.tsx — edit paths, migration panel logs live
- [x] MigrationBanner — popup chat si migration pending
- [x] engine_router — vllm_version param, routing par version
- [x] CompatBanner — bouton Install vLLM X.Y si version requise absente
- [x] Dialog.tsx — remplace alert/confirm natifs
- [x] Flash attention + keep_model_in_memory toggles
- [x] README grand public, docs/v0.1-foundation, docs/v0.2-multi-vllm

## À faire (priorité)

### Onboarding (P1 — en cours)
- [ ] DB flag `onboarding_complete` — premier lancement détecté
- [ ] Wizard 6 étapes : Welcome → Storage → Hardware → Engines → Compatibility → Done
- [ ] Transparent sur espace disque (~5-8 GB par vLLM env, ~2-70 GB par modèle)
- [ ] Opt-in install vLLM supplémentaires depuis l'onboarding
- [ ] Backend `/settings/onboarding` GET/POST

### start.sh universel (P1 — en cours)
- [ ] Détection OS : Debian/Ubuntu, Arch, Fedora, macOS
- [ ] Install deps système par OS (webkit2gtk, gcc, cmake, python3, etc.)
- [ ] Vérifie/installe Rust (rustup) + Bun
- [ ] Crée backend/.venv + compile llama-cpp selon GPU (CUDA/ROCm/Metal/CPU)
- [ ] Init vllm-envs/0.21.0 ou migration depuis legacy .venv-vllm
- [ ] `cargo tauri build` ou `tauri dev` selon flag
- [ ] Ouvre l'app → premier lancement = onboarding automatique

### Backend (P2)
- [x] DB : vllm_version + engine persistés par modèle chargé
- [x] Badge engine dans l'UI (fait avec engine field)
- [x] GPU service : fallback AMD (rocm-smi) et Mac (powermetrics + sysctl)

### Features (P2)
- [x] HF Token : feedback + validation contre API HF (username confirmé)
- [x] Chat export markdown (bouton Export dans topbar)

### Packaging (P3)
- [x] Packaging : tauri.conf.json AppImage + .deb, build.sh
- [x] WebSocket endpoint /inference/chat/ws (SSE conservé, WS disponible)

## Backlog
- [ ] MCP server EchoHub → Claude Code pilote les modèles locaux
- [ ] EchoForge ↔ EchoHub API locale
- [ ] Multi-GPU support vLLM (tensor_parallel_size)

## Terminé ✅ (v0.1 stable)
- [x] App Tauri native + sidecar Python port dynamique
- [x] Dual-engine GGUF/AWQ, SQLite conversations, profils chat
- [x] Discover : search HF, download, favorites, compat check
- [x] Library, Downloads, Settings
- [x] LoadModal VRAM preview réactive, CUDA graphs control
- [x] Support images vision models
- [x] Pages persistent entre navigations
- [x] GitHub public : https://github.com/trinityUwU/echohub
