# STATE — EchoHub
*Dernière mise à jour : 2026-05-17 (session 8)*

## Résumé de l'état actuel

Application Tauri v2 native pleinement fonctionnelle. Dual-engine llama-cpp + vLLM, multi-venv vLLM avec routing automatique par version, paths configurables avec migration assistée, installeur natif Tauri, système de mise à jour intégré (git pull + notification changelog). Chat streaming, conversations archivables, profils persistants, benchmark intégré.

## Ce qui a été fait — session du 2026-05-17

### UX / Chat
- Conversations archivables (filtres Active/Archived, hover delete/archive)
- GPU section dépliable dans la sidebar (VRAM + utilisation + température)
- Topbar chat : bouton Load supprimé (redondant), Eject rouge à droite
- Animations Framer Motion sur les messages (slide-up 0.18s)
- Avatars SVG (user + logo EchoHub), zero emoji dans tout l'app
- Footer messages assistant : nom du modèle + stats (avec fallback conv.model_id)
- ThinkingBlock dépliable pendant le streaming
- Toggle "Enable thinking" grisé avec label explicite si thinking natif non désactivable
- Toggle focus ring supprimé (outline-none)

### Settings
- Settings > Hardware : Resource limits (VRAM cap + GPU util% max)
- Settings > Benchmark : tok/s, TTFT, historique 20 runs, card partageable
- Settings > About : bouton "Check for updates" + statut
- HF Token : champ fonctionnel + validation API HF (username confirmé)
- Flash attention + Keep in memory toggles fonctionnels (persistés)

### Système
- InstallerApp Tauri natif : Welcome → Paths → Installing (logs SSE) → Done → Launch
- Système de mise à jour : UpdateBanner (30s après launch), git pull SSE, ChangelogNotification post-update
- Chat export markdown (bouton Export topbar)
- Badge engine (llama.cpp / vLLM) dans la topbar

### Bugs fixés
- Profils builtins : modifications perdues au restart → flag `userModified`
- Conversations vides au clic → sync `activeMessages` avec streaming guard
- CompatBanner crash `issues.map` (undefined) → `?? []`
- 422 search Discover sur query vide → min_length=0, skip si vide sans filtre
- LoadModelModal : suppression appel canLoadModel au mount (ouverture instantanée)
- installer.py : `yield from` invalide dans async → async generator
- installer stream : EventSource → fetch ReadableStream (Tauri webview compat)
- base.ts : health check avant cache port (évite /api fallback dans Tauri)
- footer model absent sans modèle chargé → fallback conv.model_id

## Décisions prises

| Décision | Raison | Date |
|---|---|---|
| InstallerApp dans même fenêtre Tauri | Plus simple que multi-window, cohérent visuellement | 2026-05-17 |
| fetch ReadableStream au lieu de EventSource | EventSource non fiable dans webview Tauri | 2026-05-17 |
| userModified flag sur builtins | Distingue "sauvegardé explicitement" vs "jamais modifié" | 2026-05-17 |
| Thinking natif → toggle grisé, pas filtré | Transparence : ne pas faire croire que thinking est off alors que le modèle pense | 2026-05-17 |
| Conversations archivées vs supprimées | Récupérabilité des conversations, UX plus propre | 2026-05-17 |

## Contexte non-évident

- InstallerApp : `install_complete` flag en DB `app_state`. Reset via `sqlite3 ~/.local/share/echohub/echohub.db "UPDATE app_state SET value='false' WHERE key='install_complete';"` pour tester.
- Thinking non contrôlable : Qwen3/QwQ = `/think`/`/no_think` tokens. Nemotron/DeepSeek-R1 = thinking natif, toggle grisé.
- Footer modèle : utilise `loadedModel?.name` en priorité, puis `conv.model_id.split('/').pop()` comme fallback.
- UpdateBanner : check git fetch 30s après launch, silencieux. Le push GitHub déclenche la notification au prochain lancement.
- docs/private/ : jamais pushé sur git (dans .gitignore). Contient stratégie marché, posts Reddit/HN, drafts.

## Prochaines étapes

1. **Stratégie marché** : créer compte Reddit, construction karma r/LocalLLaMA (participation genuïne, pas de promo)
2. **Préparer les assets** : screenshot benchmark EchoHub vs Ollama, GIF VRAM preview, GIF install Engine
3. **Tests end-to-end** : start.sh depuis un clone frais sur une machine vierge (pas encore testé)
4. **MCP server** : Phase 2 roadmap — Claude Code pilote les modèles locaux via EchoHub
5. **Packaging final** : .AppImage + .deb testés, validation sur machine propre

## Points en suspens

- start.sh jamais testé depuis un clone frais → potentiellement des bugs
- AMD ROCm et Apple Silicon : gpu_service codé mais non testé sur vrai hardware
- Installer : si l'utilisateur passe Paths et clique Install Now alors que le backend n'a pas encore démarré → race condition possible
- Old components dans src/components/*.tsx (héritage pré-refactor) : encore présents, inoffensifs mais à nettoyer

## Historique

### Session 7 (2026-05-17) — Multi-venv vLLM, paths, migration, docs
vllm_manager.py, Settings/Engines, config_service, migration_service, PathsTab, MigrationBanner, engine_router routing par version, CompatBanner, Dialog.tsx, Flash attention toggles, README grand public, docs/v0.1 + v0.2, start.sh universel, OnboardingWizard.

### Session 6 (2026-05-16) — Sidecar Python fonctionnel
Sidecar Python spawné par Rust, port dynamique, kill à fermeture. base.ts invoke. CORS dynamique. Tests avec modèles réels.

### Session 5 (2026-05-16) — Tauri init + componentisation React
cargo tauri init, composants React complets depuis mockup, tailwind tokens.

### Sessions 1-4 (2026-05-15/16)
Design, dual-engine GGUF/AWQ, SQLite, MSW, scaffold frontend, llama-cpp CUDA compilation.
