# STATE — EchoHub
*Dernière mise à jour : 2026-05-22 (session 24)*

## Résumé de l'état actuel

Application Tauri v2 stable. Session 24 = deux grands blocs : (1) **v1.1 mémoire sémantique + agents natifs** — ConversationManager JSON, embedding nomic-embed CPU, ChromaDB memory layer, tools search/store/invoke_agent, harness universel, Settings > Memory UI, system prompts conditionnels. (2) **Bugfixes vLLM + chat** — GPTQ/AWQ "No model loaded" (import stale), tool-use 400 (flags manquants), réponse vide vLLM, N-gram segfault, system prompts, footers, ctx adaptatif auto-reload. 35+ commits sur master.

## Ce qui a été fait — session 24 (2026-05-22)

### v1.1 — ConversationManager JSON (Step 1)
- `backend/services/conversation_manager.py` : CRUD chat + project convs sur JSON
- `~/.local/share/echohub/conversations/{id}.json` + `_index.json`
- Migration one-shot SQLite→JSON au boot, `to_context(max_tokens)` sliding window
- Routers `conversations.py` + `projects.py` branchés, `db.py` hors loop pour convs

### v1.1 — Embedding + ChromaDB + Tools (Steps 2–4)
- `embedding_service.py` : nomic-embed-text-v1.5 GGUF CPU-only, auto-download HF, 768 dims ~100ms
- `llama_lock.py` : mutex global partagé — résout "Memory is not initialized" (état C global llama.cpp)
- `memory_service.py` : ChromaDB cosine, scope conv_id/project_id, routes `/memory/*`
- `search_memory`, `store_memory`, `invoke_agent` dans TOOLS[] + `execute_tool()`
- `invoke_agent` : boucle tool-use isolée sur le modèle chargé, 3 harness profiles

### v1.1 — Harness + UI + System prompts (Steps 5–7)
- `harness_service.py` : language detection + syntax (ast/tsc) + lint (ruff) + result normalizer
- `MemoryTab.tsx` + toggle Memory dans ChatTopBar + `toggleMemory()` dans useConversations
- System prompts dynamiques : Dev→dev prompt, Docs→analyse, Research→web, Chat→helpful assistant
- `project_mode` dans `ToolChatRequest`, inject memories si `memory_enabled` sur la conv

### Refactoring modules (normes < 500L)
- `vllm_service.py` splitté : `vllm_generate` + `vllm_loader` + `vllm_process` + `vllm_vram`
- `tool_service.py` splitté : `tool_agent` + `tool_memory` + `tool_definitions`
- `/lint` command + `scripts/lint_standards.py` + copie globale `~/.claude/lint_standards.py`

### Bugfixes vLLM critiques
- **GPTQ/AWQ "No model loaded"** : `vllm_generate._current_model` stale (import = copy). Fix : `_model()` via `sys.modules`
- **Tool-use 400** : flags `--enable-auto-tool-choice --tool-call-parser` ajoutés au launch. `_detect_tool_parser()` auto selon famille
- **Réponse vide tool-chat vLLM** : `generate_with_tools` yieldait strings SSE brutes vs dicts attendus. Fix : `_stream_and_parse()` dans vllm_generate
- **Circular import** : `parse_load_error` dans vllm_loader ne dépend plus de vllm_service

### Bugfixes llama.cpp + chat UI
- **N-gram segfault** : défaut `'off'` dans useModels/App.tsx/LoadModelModal (était `'ngram'`)
- **Footer stats disparaissent** : memo React ne comparait pas `message.stats` ni `message.loadConfig`
- **Stats persistées** : `useToolChat done` attach stats au message state + DB via `onSaveMessage`
- **Bouton reload** : `loadConfig` sauvegardé dans messages depuis `useChat`/`useToolChat`
- **Regenerate/editUser mode skills** : `sendFromHistory()` ajouté dans `useToolChat`
- **Conv switch** : `stop()` + `setMessages()` forcés au changement de conv même si `streaming=true`
- **Delete conv archivée** : filtrait seulement `conversations[]`, pas `archivedConversations[]`
- **ctx adaptatif** : auto-reload sans toast si `ctx_mode='adaptive'`, `ctxMode` dans `activeLoadConfig`

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| ConversationManager JSON | SQLite non searchable sémantiquement, sliding window natif | 2026-05-22 |
| nomic-embed CPU-only | Zéro impact VRAM modèle principal | 2026-05-22 |
| Mutex llama.cpp global (llama_lock.py) | État C global — deux instances concurrentes = segfault | 2026-05-22 |
| ChromaDB = layer sémantique uniquement | Messages bruts dans JSON, jamais ChromaDB | 2026-05-22 |
| invoke_agent = même modèle, contexte isolé | Zéro reload VRAM, contexte parent jamais exposé | 2026-05-22 |
| N-gram OFF par défaut | Segfault numpy shape sur Qwen3 GGUF et autres | 2026-05-22 |
| vllm_generate._model() via sys.modules | Import direct = stale copy à None — accès live obligatoire | 2026-05-22 |
| --enable-auto-tool-choice au launch | vLLM 0.21 nécessite flag explicite, non-défaut | 2026-05-22 |
| ctx_mode='adaptive' → auto-reload sans modal | UX : user ne gère pas les limites de contexte | 2026-05-22 |

## Contexte non-évident

- `llama_lock.py` : mutex singleton — TOUT appel llama.cpp (inférence + embedding) passe par ce lock
- `vllm_generate.py` : lire `_current_model` via `sys.modules['backend.services.vllm_service']._current_model` — import direct = stale
- `Path(os.getenv("CHROMA_DIR", ""))` est bugué (`Path("")` truthy). Corrigé par `if os.getenv(...) else default`
- Convs migrées dans `~/.local/share/echohub/conversations/`. Marqueur `.conv_migrated` empêche double migration
- `ctx_mode` : snake_case dans `types/index.ts LoadConfig`, camelCase dans `useModels.LoadConfig` local — conversions fragiles
- `MessageRow` memo doit comparer `message.stats` et `message.loadConfig` — sinon re-render bloqué
- `streaming=true` bloquait `setMessages(activeMessages)` — `stop()` forcé au changement de conv
- `chroma.sqlite3` créé à la racine (bug CHROMA_DIR) — fichier parasite à supprimer

## Prochaines étapes (ordre prioritaire)

1. **Tester vLLM tool-use** après reload avec `--enable-auto-tool-choice` (modèle actuel chargé sans ces flags)
2. **Types projets Dev/Docs/Research** — layouts fonctionnels (file tree IDE-like, drag-drop docs, sources URL)
3. **RAG natif projets** — PDF/DOCX/MD → ChromaDB par projet, retrieval injecté
4. **Remote Access** — Cloudflare Tunnel toggle, Telegram adapter
5. **Parallel models** — load plusieurs modèles simultanément
6. **MCP logs dans card skill** — GET /skills/{id}/mcp/logs?lines=50
7. Supprimer `chroma.sqlite3` à la racine

## Points en suspens

- `useToolChat` ne sauvegarde pas message user dans certains cas (conv "ping" = 1 seul message assistant) — à investiguer
- Stats à zéro dans done event si `_total_text_len=0` (path vLLM tool-chat sans text_chunk comptabilisé)
- Erreur TS pré-existante App.tsx:344 (type LoadConfig mismatch) — non bloquante
- Violations lint dans nos propres fichiers (_invoke_agent 106L, _edit_file 48L) — acceptées, cohésion forte

## Historique

### Session 23 (2026-05-21)
Load profiles (Performance/Balanced/Gaming/Minimal), offload_kqv, n_batch, smart cap ctx, multi-GPU llama+vLLM, speculative decoding ngram/MTP/draft, n_threads adaptatif, notifications persistantes localStorage.

### Session 22 (2026-05-21)
Context bar 4 couleurs, toast ctx exceeded, KV quant Q4_0 défaut, throttle render 80ms, smart ctx initial 8K reasoning, fix LOG_PATH parents[2], watchdog backend Tauri.

### Session 21 (2026-05-20)
Projects workspace (Dev/Docs/Research), tool calling natif, MCP/Skills intelligence, Discover filtres avancés, benchmark leaderboard, streaming token counter.

### Sessions 1–20
Foundation Tauri → vLLM multi-venv → UX → automation → benchmarks → GPU → vision → fine-tuning → MCP skills.
