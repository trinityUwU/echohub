# STATE — EchoHub
*Dernière mise à jour : 2026-05-17 (session 9)*

## Résumé de l'état actuel

Application Tauri v2 native pleinement fonctionnelle. Dual-engine llama-cpp-python (GGUF, cross-platform) + vLLM (AWQ/GPTQ, NVIDIA). Multi-venv vLLM avec routing automatique par version. InstalleurApp natif, système de mise à jour git pull SSE. Chat streaming avec markdown riche, actions messages (copy/edit/regenerate), context menu conversations (rename/archive/delete). Tests E2E réalisés depuis un clone frais — majorité des bugs de fresh install corrigés.

## Ce qui a été fait — session du 2026-05-17 (session 9)

### Fresh install E2E — bugs corrigés
- `locate_project_root` en release utilisait `resource_dir()` → corrigé avec `current_exe().nth(5)`
- `start.sh` faisait `cargo tauri build` (AppImage, nécessitait linuxdeploy) → remplacé par `cargo tauri dev`
- `start.sh` compilait llama-cpp en CLI → délégué à l'InstallerApp
- `main.tsx` : splash screen + retry loop 30×1s avant d'attendre le backend (évite l'app principale si backend pas prêt)
- `InstallerApp` : log box `min-h-0` pour scroll interne dans flex column
- Compilation llama-cpp : "still running..." spam → timer elapsed toutes 5 occurrences
- Installer vLLM par défaut si NVIDIA détecté (fresh clone = pas de .venv-vllm)
- Tous les paths hardcodés `/mnt/projects/echohub` supprimés des services backend
- `import datetime` manquant dans conversations.py → archive 500 fixé
- Migration DB `archived` column : `ALTER TABLE IF MISSING` au démarrage
- CORS headers sur les 500 (global exception handler + logging)

### UX Chat
- Footer messages toujours visible (plus au hover uniquement) — stats hydratées en mémoire après stream
- Actions footer : **Copy** (check vert 1.5s), **Edit** (user, textarea inline Enter/Esc), **Regenerate**
- `sendFromHistory()` dans useChat — stream sans ajouter de user message (pour regenerate/edit)
- Toast erreur load : croix dismiss + auto-close 60s

### Markdown
- `atom-one-dark` highlight.js importé — syntax highlighting couleurs par langage
- Badge langue corrigé (retiré préfixe `hljs `)
- Texte 0.92rem, line-height 1.7, borders réduites
- Code blocks fond `#282c34` assorti au thème

### Conversations sidebar
- Context menu clic droit : Rename / Archive / Delete (menu positionné, ajustement auto bord d'écran)
- Rename inline (input dans la sidebar, Enter=confirm, blur=confirm, Esc=cancel)
- Boutons hover : rename + archive + delete

### Context menu global
- `ContextMenuProvider` au root : bloque le menu natif partout
- Clic droit hors zone configurée → "No actions available"
- Fichiers séparés pour compatibilité Vite Fast Refresh (useContextMenu.ts séparé)
- `createRoot` unique au module level (plus de recréation au HMR)

### Settings > About
- Bouton "Update now" intégré directement (plus de dépendance au UpdateBanner)
- Logs git pull inline dans la section About
- Bouton "Restart now" après succès

### Engines tab
- Badge "default" sur le venv legacy/builtin (non supprimable)
- `LEGACY_VENV` chemin relatif au projet (était hardcodé)
- Cache `_is_operational` TTL 120s (import vLLM prenait 30-60s)
- Bouton Refresh dans le header de la liste
- `is_builtin: True` sur le venv par défaut, suppression bloquée

### Migration paths
- Cancel & rollback pendant la copie (flag `_cancel_requested`, suppression des fichiers copiés, restauration config)
- Bouton "Cancel & rollback" rouge visible pendant `in_progress`

## Décisions prises

| Décision | Raison | Date |
|---|---|---|
| `cargo tauri dev` dans start.sh (pas build) | `cargo tauri build` nécessite linuxdeploy pour AppImage — absent sur fresh install | 2026-05-17 |
| InstallerApp installe vLLM par défaut si NVIDIA | Sans ça, modèles AWQ/GPTQ impossibles sur fresh clone | 2026-05-17 |
| Cache _is_operational 120s | Import vLLM en subprocess = 30-60s bloquant, inacceptable au refresh | 2026-05-17 |
| ContextMenuProvider global + "No actions" | Menu natif bloqué partout — cohérence UX, pas de comportement surprenant | 2026-05-17 |
| sendFromHistory() dans useChat | Regenerate/edit nécessite stream sans ajouter user message — send() ne couvre pas ce cas | 2026-05-17 |
| LoadingSplash fichier séparé | Vite Fast Refresh interdit composant + hook/fonction dans le même fichier | 2026-05-17 |

## Contexte non-évident

- `start.sh` lance `cargo tauri dev` → frontend Vite HMR actif. Pour un binaire release : `cargo tauri build --no-bundle` dans `frontend/`.
- Installer flag : `sqlite3 ~/.local/share/echohub/echohub.db "UPDATE app_state SET value='false' WHERE key='install_complete';"` pour re-tester l'installer.
- `_is_operational` cache : invalider avec `invalidate_operational_cache(version)` après install vLLM.
- Context menu : `useContextMenu` doit être importé depuis `@/components/shared/useContextMenu` (fichier séparé), pas depuis `ContextMenu.tsx`.
- `sendFromHistory(history)` envoie l'historique directement sans ajouter de user message — utilisé pour regenerate et edit user.
- CORS 500 : le middleware Starlette n'ajoute pas les headers CORS sur les exceptions non catchées → global_exception_handler dans main.py les ajoute manuellement.
- Vieux composants dans `src/components/*.tsx` (héritage pré-refactor) : encore présents, inoffensifs, à nettoyer.

## Prochaines étapes

1. **Stratégie marché** : créer compte Reddit, construction karma r/LocalLLaMA (participation genuïne, 3-4 semaines avant toute promo)
2. **Assets lancement** : screenshot benchmark EchoHub vs Ollama, GIF VRAM preview, GIF Engine install
3. **Nettoyer old components** : `src/components/*.tsx` héritage pré-refactor (ChatPanel.tsx, LoadConfigModal.tsx, etc.)
4. **Packaging** : valider `.AppImage` et `.deb` sur machine propre (linuxdeploy à installer)
5. **MCP server** : Phase 2 roadmap — Claude Code pilote modèles locaux via EchoHub

## Points en suspens

- Vieux composants `src/components/*.tsx` : encore présents, inoffensifs mais à nettoyer
- AMD ROCm et Apple Silicon : code présent, non testé sur vrai hardware
- Installer race condition : si backend pas encore démarré lors du clic "Install Now"
- `.AppImage` : nécessite `linuxdeploy` — pas testé depuis ce refactoring start.sh

## Historique

### Session 8 (2026-05-17) — UX polish, installeur natif, système MAJ
Conversations archivables, GPU sidebar, ThinkingBlock, Framer Motion, InstallerApp, UpdateBanner, benchmark, resource limits, HF token, export markdown, badge engine.

### Session 7 (2026-05-17) — Multi-venv vLLM, paths, migration, docs
vllm_manager.py, Settings/Engines, config_service, migration_service, PathsTab, MigrationBanner, engine_router routing par version, CompatBanner, Dialog.tsx, start.sh universel, OnboardingWizard.

### Session 6 (2026-05-16) — Sidecar Python fonctionnel
Sidecar Python spawné par Rust, port dynamique, kill à fermeture. base.ts invoke. CORS dynamique.

### Session 5 (2026-05-16) — Tauri init + componentisation React
cargo tauri init, composants React complets depuis mockup, tailwind tokens.

### Sessions 1-4 (2026-05-15/16)
Design, dual-engine GGUF/AWQ, SQLite, MSW, scaffold frontend, llama-cpp CUDA compilation.
