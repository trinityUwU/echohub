# TODO — EchoHub
*Dernière mise à jour : 2026-05-17*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — participation genuïne, pas de promo avant 3-4 semaines
- [ ] Préparer assets lancement : benchmark screenshot, GIF VRAM preview, GIF Engine install

## À faire (priorité)

### Lancement (P1)
- [ ] Créer compte Reddit (maintenant pour karma)
- [ ] Finaliser posts avec Chris (docs/private/posts-drafts.md — retravailler ensemble)
- [ ] Préparer Show HN (timing : mardi-jeudi 14h-16h Paris)
- [ ] Test start.sh depuis clone frais sur machine vierge

### Backend (P2)
- [ ] DB : persister vllm_version utilisée par modèle chargé (partiellement fait)
- [ ] GPU service : tester fallback AMD (rocm-smi) et Mac (powermetrics) sur vrai hardware
- [ ] Nettoyer old components src/components/*.tsx héritage pré-refactor

### Features (P2)
- [ ] Installer : gérer race condition si backend pas encore démarré lors du clic Install Now
- [ ] Packaging : valider .AppImage et .deb sur machine propre

### Backlog
- [ ] MCP server EchoHub → Claude Code pilote les modèles locaux (Phase 2 roadmap)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Multi-GPU support vLLM (tensor_parallel_size)
- [ ] Python sidecar WebSocket (remplacer SSE pour streaming — SSE fonctionne, pas urgent)

## Terminé ✅ (session 8 — 2026-05-17)
- [x] Conversations archivables (filtres Active/Archived, hover delete/archive)
- [x] GPU section dépliable dans sidebar (VRAM + utilisation + température)
- [x] Topbar chat propre (Load supprimé, Eject rouge à droite)
- [x] Animations Framer Motion messages (slide-up)
- [x] Avatars SVG, zero emoji dans tout l'app
- [x] Footer messages : nom modèle + stats + fallback conv.model_id
- [x] ThinkingBlock dépliable pendant streaming
- [x] Toggle thinking grisé si natif non désactivable
- [x] Settings > Resource limits (VRAM cap + GPU util%)
- [x] Settings > Benchmark (tok/s, TTFT, historique, share card)
- [x] Settings > About : Check for updates + Replay tutorial
- [x] HF Token validation API (username confirmé)
- [x] Chat export markdown
- [x] Badge engine (llama.cpp / vLLM) topbar
- [x] InstallerApp natif Tauri (Welcome → Paths → Installing → Done)
- [x] Système mise à jour : UpdateBanner + git pull SSE + ChangelogNotification
- [x] Fix profils builtins persistants (userModified flag)
- [x] Fix conversations vides (streaming guard + sync activeMessages)
- [x] Fix 422 search Discover
- [x] LoadModelModal ouverture instantanée (suppression canLoadModel call)
- [x] Fix installer.py async/yield

## Terminé ✅ (sessions précédentes)
- [x] App Tauri native + sidecar Python port dynamique
- [x] Dual-engine GGUF/AWQ, SQLite conversations, profils chat
- [x] Multi-venv vLLM + routing automatique par version
- [x] Paths configurables + migration assistée
- [x] Settings/Engines avec install SSE live
- [x] CompatBanner avec redirect Settings + action claire
- [x] OnboardingWizard 6 étapes
- [x] start.sh universel (Arch/Debian/Fedora/macOS)
- [x] README grand public + docs/v0.1 + docs/v0.2
- [x] Benchmark intégré Settings
- [x] GPU fallback AMD/Mac
- [x] WebSocket endpoint /inference/chat/ws
- [x] Flash attention + Keep in memory toggles
- [x] GitHub public : https://github.com/trinityUwU/echohub
