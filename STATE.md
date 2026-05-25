# STATE — EchoHub
*Dernière mise à jour : 2026-05-25 (session 28)*

## Résumé de l'état actuel

Application Tauri v2. Backend FastAPI port 37821 (systemd) ou port dynamique (tauri dev). Discord connector fonctionnel. **Session 28 : fixes critiques streaming** — la vraie root cause du non-streaming dans Tauri était WebKit2GTK 4.1 qui bufférise `fetch()` ReadableStream. Fix : WebSocket pour chatStream, XHR pour toolChat. **Attente de validation** : tauri dev doit être relancé pour que les changements prennent effet.

## Ce qui a été fait — session 28 (2026-05-25)

### Root cause streaming — WebKit2GTK 4.1

**La vraie cause** : WebKit2GTK 4.1 (moteur WebView de Tauri sur Linux) bufférise les `fetch()` + `ReadableStream`. Tous les chunks SSE arrivent d'un bloc à la fin. Les headers `Cache-Control: no-cache` et `X-Accel-Buffering: no` n'ont aucun effet sur ce comportement — c'est une limitation de WebKit2GTK elle-même.

**Fix chatStream (useChat normal) :**
- Détection `window.__TAURI_INTERNALS__` → utilise WebSocket `/inference/chat/ws`
- WebSocket n'est pas bufférisé par WebKit
- Navigateurs standards (non-Tauri) : fetch SSE conservé inchangé
- Fichier : `frontend/src/api/client.ts`

**Fix toolChat (mode Projects/Dev) :**
- XHR `onprogress` → queue async → `AsyncGenerator` avec `notify` pattern race-condition-safe
- XHR progress events ne sont pas bufférisés dans WebKit2GTK
- Fichier : `frontend/src/api/client.ts`

**Fix WebSocket backend (`inference.py` `/inference/chat/ws`) :**
- `ws.send_text(chunk)` plantait : llama-cpp yield des dicts Python, pas des strings
- Fix : normalisation → dict sérialisé en JSON string, string SSE strippée du prefix `data: `
- Ajout stats `echohub_stats` et signal `{"done": true}` pour que le client puisse finalize()

**Fix outil call natif → boucle stop après premier tool call :**
- `content=""` pour rôle assistant (doit être `None`) + `content=None` pour rôle tool (doit être string vide)
- llama-cpp interprète mal `assistant+content=""` avec `tool_calls` → génère réponse invalide
- Fix double sentinel `None` dans `generate_with_tools` via flag `_sentinel_sent`
- Fichiers : `backend/routers/inference.py`, `backend/services/llama_service.py`

**Fix route echo-passthrough (pour EchoCode) :**
- Router `openai_compat` prefix `/v1` → route réelle `/v1/echo-passthrough/v1/messages`
- SDK Anthropic appelle `{ANTHROPIC_BASE_URL}/v1/messages` = `/echo-passthrough/v1/messages` → 404
- Fix : `_passthrough_router` sans prefix dans `openai_compat.py`, enregistré avant le router `/v1` dans `main.py`

### État du streaming maintenant

**Code en place (commits 4e555aee, c299e909, 561506c5) :**
- chatStream → WS dans Tauri / fetch SSE dans navigateur
- toolChat → XHR onprogress dans Tauri / fetch SSE dans navigateur
- WebSocket backend normalisé
- Route echo-passthrough fonctionnelle (curl testé sur systemd :37821)

**Attente validation :**
- `tauri dev` doit être relancé pour charger les nouveaux fichiers
- Test WS direct non possible cette session (VRAM occupée par instance dev)

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| WebSocket pour chatStream dans Tauri | WebKit2GTK 4.1 bufférise fetch ReadableStream — pas de workaround côté server headers | 2026-05-25 |
| XHR onprogress pour toolChat dans Tauri | AsyncGenerator incompatible avec callback XHR → queue async comme bridge. XHR non bufférisé dans WebKit | 2026-05-25 |
| `_passthrough_router` sans prefix pour echo-passthrough | Evite le double `/v1/` dû au prefix du router openai_compat | 2026-05-25 |
| Normalisation chunks WebSocket | llama-cpp yield des dicts, pas des strings — WS.send_text() exige une string | 2026-05-25 |
| `content=None` (pas `""`) pour assistant avec tool_calls | llama-cpp interprète `content=""` + `tool_calls` comme réponse invalide → loop cassée | 2026-05-25 |
| parseInt(url.port) obligatoire | url.port = string en JS Web URL API, http.request ignore silencieusement | 2026-05-23 |
| generate() au lieu de generate_with_tools | generate_with_tools signature incompatible vLLM | 2026-05-23 |

## Contexte non-évident

- **WebKit2GTK 4.1 ne supporte pas fetch ReadableStream** : CRITIQUE pour Tauri Linux. Les chunks SSE n'arrivent pas en temps réel — tout bufférisé jusqu'à la fin de la connexion. Seules solutions viables : WebSocket ou XHR onprogress. EventSource (SSE natif) n'est pas utilisable ici car on a besoin de POST avec body.

- **Instance dev vs service systemd** : `tauri dev` lance son propre backend Python sur un port dynamique (ex: 43937). Le service systemd tourne sur 37821. Les deux sont indépendants. Les changements de code n'affectent l'instance dev qu'après redémarrage.

- **VRAM RTX 3060** : 11.8 GB / 12 GB utilisés quand l'instance dev a un modèle chargé. CodeIndex sur GPU impossible dans ce cas — utiliser `device="cpu"`.

- **url.port string** : En JavaScript, `new URL("http://localhost:37821").port` retourne `"37821"` (string). `http.request` Node/Bun ignore silencieusement une string et utilise port 80. Toujours `parseInt(url.port)`.

- **Skills MCP actifs = discord/chat planté** : MCP servers injectent des tools qui peuvent faire exploser le contexte. L'isolation propre reste à faire.

- **generate_with_tools vLLM** : signature différente — attend les définitions d'outils complètes, pas `enabled_tools: list[str]`.

## Prochaines étapes

1. **Valider streaming** — relancer `tauri dev` et envoyer un message dans le chat normal + un message en mode projet Dev
2. **Isolation MCP dans discord/chat** — discord/chat ne doit pas hériter des MCP servers actifs
3. **web_search conditionnel** — GGUF → tool-chat avec web_search, vLLM → generate() sans tools
4. **Scoring qualité algorithmique dans benchmarks** (P0 reporté depuis session 25)
5. **RAG natif projets** — PDF/DOCX/MD drag-drop, ChromaDB par projet
6. **Remote Access** — Cloudflare Tunnel + Telegram

## Points en suspens

- **Streaming non validé** : code en place mais tauri dev n'a pas été relancé cette session
- web_search non intégré Discord
- Isolation skills MCP dans discord/chat
- vLLM venv 0.21.0 : vérifier `/home/trinity/.local/share/echohub/vllm-envs/0.21.0/bin/pip show vllm`
- Fix TS pré-existant `App.tsx:354` (non bloquant)
- `chroma_data/` à la racine — à supprimer ou gitignore

## Historique

### Session 28 (2026-05-25) — Fix streaming WebKit2GTK + EchoCode connexion
Root cause streaming découverte : WebKit2GTK 4.1 bufférise fetch ReadableStream. Fix WS + XHR. Fix boucle tool call natif (content="" vs None). Fix route echo-passthrough. Fix port fallback EchoCode 37823→37821. Fix EchoHubModelDialog (/v1/models → /inference/load-state).

### Session 27 (2026-05-23) — Discord connector
Discord connector complet end-to-end. Bot discord.js (Bun) 4 fichiers. Conversations EchoHub partagées. State machine idle/chatting/menu/conv_list. Boutons contextuels partout. Profils de chat. strip think/tool_call. Error propagation. Nombreux fixes d'interactions Discord.

### Session 26 (2026-05-22)
invoke_agent streaming end-to-end. _parse_tool_call_json regex fallback 3 niveaux. Conversations projets sauvegardées tous modes. Archive conversations projets. Auto-scroll toggle animé. ReAct framework natif. hljs live streaming code.

### Sessions 18-25 (2026-05-20 à 2026-05-22)
Projects system (Dev/Docs/Research). Tool use streaming interleaved. Auto-compact 98%. Skills/MCP system. Notifications. Awareness conditionnelle. invoke_agent chaîne complète.

### Sessions 13-17 (2026-05-19)
Fine-tuning pipeline Unsloth QLoRA. GGUF export. Vision llama.cpp. MTP detection. KV cache Q8_0. Reload model. Wayland clipboard.

### Sessions 1-12 (2026-05-15 à 2026-05-17)
Scaffolding complet. vLLM + llama.cpp dual engine. Multi-venv vLLM. Tauri v2 migration. Installer. Benchmarks qualité. Discover multi-filtres.
