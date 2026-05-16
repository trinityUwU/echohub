# STATE — EchoHub
*Dernière mise à jour : 2026-05-16*

## Résumé de l'état actuel

App fonctionnelle en mode dev (Vite + FastAPI). Backend dual-engine opérationnel (llama-cpp CUDA + vLLM). Conversations persistées en SQLite. MSW en place. Scaffold frontend existant mais design à refaire complètement. GitHub public créé.

## Ce qui a été fait — session du 2026-05-16

**Backend**
- `engine_router.py` — détection format/GPU, dispatch llama/vLLM
- `llama_service.py` — GGUF cross-platform, params LM Studio (n_gpu_layers=-1, n_batch=512, flash_attn=True)
- llama-cpp-python recompilé avec CUDA 13 + gcc-15 (arch 86, RTX 3060) → libggml-cuda.so confirmé
- `user_data.py` + `db.py` — SQLite dans ~/.local/share/echohub/echohub.db
- `routers/conversations.py` — CRUD complet (8 endpoints)
- `routers/settings.py` — HF Token + GPU backend detection
- Fix uvicorn --reload : supprimé (watchfiles boucle sur .venv)

**Frontend**
- MSW installé et fonctionnel (VITE_MSW=true dans .env.development)
- `useConversations` migré localStorage → API REST
- `useChat` — persist messages + stats (tokens, tok/s, temps) via addMessage API
- Stop génération (AbortController + bouton carré rouge)
- Auto-unload avant load d'un nouveau modèle
- Bouton Thinking universel (Qwen3 → /think prefix, autres → natif)
- Scaffold design nouveau (composants ui/, discover/, chat/, settings/) — **à refaire**
- GitHub : https://github.com/trinityUwU/echohub (public, MIT)

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| Migration Tauri v2 | Binaire natif, zero-install, cross-platform | 2026-05-16 |
| MSW avant design | Développer le design sans dépendre du backend | 2026-05-16 |
| Design refusé × 2 | Résultats inacceptables (même design recycled) | 2026-05-16 |
| Docs design supprimés | Repartir de zéro, nouvelle session dédiée | 2026-05-16 |
| llama-cpp > vLLM comme défaut | vLLM exclut Mac/AMD, llama.cpp cross-platform | 2026-05-16 |
| SQLite user data dir | Données persistées entre sessions, cross-platform | 2026-05-16 |

## Contexte non-évident

- **llama-cpp CUDA** : compiler avec `gcc-15` (pas gcc 16 — incompatible CUDA 13). Commande exacte dans TODO.md.
- **uvicorn sans --reload** : watchfiles surveille .venv et boucle — utiliser uvicorn sans --reload en dev.
- **Thinking universel** : Qwen3 = /think prefix. Autres modèles = pensent nativement, pas de prefix. Le toggle UI est toujours disponible.
- **vLLM venv hardcodé** : `/mnt/projects/echohub/.venv-vllm/bin/python` dans vllm_service.py.
- **Ports critiques** : 37821 backend, 37822 frontend, 37823 vLLM — ne jamais changer.

## Prochaines étapes

1. **REFAIRE TOUT LE DESIGN** — nouvelle identité visuelle from scratch, nouvelle session dédiée
2. **Init Tauri v2** — `cargo tauri init`, CSP strict, webview autour du frontend existant
3. **Python sidecar WebSocket** — remplacer SSE par WS, sidecar 127.0.0.1 only
4. **Page Setup/Onboarding** — installation deps depuis l'UI, tutoriel premier lancement

## Points en suspens

- Design : deux tentatives ratées — approche à revoir complètement en prochaine session
- Test load GGUF réel (llama-cpp CUDA) : à valider après restart backend
- Badge engine dans l'UI (llama/vLLM) : pas encore implémenté
- HF_TOKEN : pas de feedback si token invalide

## Historique

### Session 2026-05-15 (session 1-2)
- Scaffold complet backend + frontend
- vLLM subprocess manager avec eject, VRAM cleanup, OOM auto-retry
- Download manager avec progress SSE + gguf_file spécifique
- ModelBrowser split-panel LM Studio style
- HF Token + check gated
- Conversations localStorage (remplacé SQLite en session 2)

### Session 2026-05-16 (session 3-4)
Voir "Ce qui a été fait" ci-dessus.
