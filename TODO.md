# TODO — EchoHub
*Dernière mise à jour : 2026-05-17 (session 9)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — participation genuïne, pas de promo avant 3-4 semaines
- [ ] Préparer assets lancement : benchmark screenshot, GIF VRAM preview, GIF Engine install

## À faire (priorité)

### Lancement (P1)
- [ ] Créer compte Reddit (maintenant pour karma)
- [ ] Finaliser posts avec Chris (docs/private/posts-drafts.md — réécrire ensemble)
- [ ] Préparer Show HN (timing : mardi-jeudi 14h-16h Paris)

### Nettoyage (P1)
- [ ] Supprimer vieux composants héritage pré-refactor : `src/components/ChatPanel.tsx`, `LoadConfigModal.tsx`, `MarkdownContent.tsx`, `ModelCard.tsx`, `ModelPickerModal.tsx`, `ThinkingBlock.tsx`, `SettingsPage.tsx`, `ui/`, etc.

### Backend (P2)
- [ ] GPU service : tester fallback AMD (rocm-smi) et Mac (powermetrics) sur vrai hardware
- [ ] Installer : gérer race condition si backend pas encore démarré lors du clic "Install Now"

### Packaging (P2)
- [ ] Valider `.AppImage` sur machine propre (installer linuxdeploy, tester `cargo tauri build`)
- [ ] Valider `.deb` package

### Backlog
- [ ] MCP server EchoHub → Claude Code pilote les modèles locaux (Phase 2 roadmap)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Multi-GPU support vLLM (tensor_parallel_size)
- [ ] Python sidecar WebSocket (remplacer SSE pour streaming — SSE fonctionne, pas urgent)
- [ ] DB : persister vllm_version utilisée par modèle chargé

## Terminé ✅ (session 9 — 2026-05-17)
- [x] Fresh install E2E — locate_project_root, start.sh cargo tauri dev, splash + retry backend
- [x] InstallerApp : log box scroll interne, timer elapsed compilation
- [x] Installer vLLM par défaut si NVIDIA (fresh clone sans .venv-vllm)
- [x] Tous les paths hardcodés /mnt/projects/echohub supprimés des services backend
- [x] import datetime manquant → archive conversations 500 fixé
- [x] Migration DB archived column (ALTER TABLE si absente)
- [x] CORS headers sur 500 (global exception handler)
- [x] Footer messages toujours visible + stats hydratées en mémoire après stream
- [x] Actions footer : Copy (vert 1.5s), Edit user (textarea inline), Regenerate
- [x] sendFromHistory() dans useChat pour regenerate/edit
- [x] Toast erreur load : croix dismiss + auto-close 60s
- [x] Markdown atom-one-dark, badge langue corrigé, texte 0.92rem
- [x] Context menu clic droit conversations (rename/archive/delete)
- [x] ContextMenuProvider global — menu natif bloqué, "No actions available"
- [x] HMR fix : useContextMenu séparé, createRoot unique
- [x] Settings > About : bouton "Update now" direct, logs inline
- [x] Engines tab : badge "default", LEGACY_VENV relatif, cache _is_operational, bouton refresh
- [x] Migration cancel & rollback pendant in_progress
- [x] Redesign complet (composants from scratch, design system propre)

## Terminé ✅ (sessions précédentes)
- [x] App Tauri native + sidecar Python port dynamique
- [x] Dual-engine GGUF/AWQ, SQLite conversations, profils chat
- [x] Multi-venv vLLM + routing automatique par version
- [x] Paths configurables + migration assistée
- [x] Settings/Engines avec install SSE live
- [x] CompatBanner avec redirect Settings
- [x] OnboardingWizard 6 étapes
- [x] start.sh universel (Arch/Debian/Fedora/macOS)
- [x] README grand public + docs/v0.1 + docs/v0.2
- [x] Benchmark intégré Settings
- [x] InstallerApp natif Tauri
- [x] Système mise à jour git pull SSE + ChangelogNotification
- [x] GitHub public : https://github.com/trinityUwU/echohub
