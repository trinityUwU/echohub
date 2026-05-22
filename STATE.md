# STATE — EchoHub
*Dernière mise à jour : 2026-05-22 (session 25)*

## Résumé de l'état actuel

Application Tauri v2 stable. Session 25 = deux blocs : (1) **Types projets Docs+Research fonctionnels** — tables DB `project_context_files`/`project_sources`, endpoints REST upload/list/delete, injection automatique dans system prompt selon mode, panels frontend drag-drop. (2) **invoke_agent débogué** — chaîne complète fonctionnelle (SIGSEGV→SIGABRT→deadlock→XML parsing), sous-agent exécute vraiment web_search+fetch_url, progress streaming implémenté côté backend+frontend. **Problème ouvert critique** : les steps du sous-agent ne s'affichent pas visuellement dans le ToolCallBlock pendant l'exécution — le bloc reste statique "running" sans feedback visible.

## Ce qui a été fait — session 25 (2026-05-22)

### Types projets Docs + Research
- DB : tables `project_context_files` + `project_sources` avec CRUD complet (`db.py`)
- Endpoints REST : `GET/POST/DELETE /{project_id}/context-files` + `/{project_id}/sources` + upload multipart (`projects.py`)
- Inférence : injection auto des fichiers/sources dans `combined_system` selon `project_mode` (docs/research) — `inference.py`
- Frontend : `DocsPanel` drag-drop + liste fichiers avec suppression, `ResearchPanel` input URL + drag-drop doc
- Hook `useProjectContext.ts` : `useContextFiles` + `useProjectSources` avec refresh auto
- `apiUpload()` ajouté dans `base.ts` pour multipart
- `ProjectsPanel.tsx` : helpers partagés `DropZone`, `UploadingRow`, icons

### invoke_agent — fix complet de la chaîne
- **Routing** : en mode docs/research/chat, le chat passait par `/inference/chat` sans tools. Fix : `isDevMode = true` pour tous les modes projet, `isDevOnlyMode` pour UI dev-only
- **web_search exposé direct** : le modèle appelait `web_search` lui-même au lieu d'`invoke_agent`. Fix : `web_search`+`fetch_url` retirés des tools du modèle principal — réservés sous-agents uniquement
- **invoke_agent absent** : toujours injecté dans `enabled_tools` même si pas dans la liste skills
- **SIGSEGV** : appel concurrent `_llm.create_chat_completion` depuis threads différents. Fix : `chat_completion_sync()` dans `llama_service` + `_generation_lock` mutex
- **SIGABRT** : `asyncio.run()` dans thread depuis event loop uvicorn. Fix : `chat_completion_sync` appel direct sans asyncio
- **Deadlock** : `execute_tool` bloquait l'event loop. Fix : `loop.run_in_executor(_tool_executor, ...)` avec executor dédié
- **XML tool_calls** : Qwen3 génère `<tool_call>` XML, `tool_agent.py` ne parsait que le format natif. Fix : `_parse_xml_tool_calls()` + `_strip_think()` dans tool_agent
- **harness web_research** : ajouté dans `_HARNESS_TOOLS` avec `[web_search, fetch_url]`
- **Research system prompt** : forcé `invoke_agent` only, interdit direct web_search

### Progress streaming invoke_agent
- `tool_agent.py` : `progress_cb` optionnel, émet `agent_tool_start/agent_tool_done/agent_thinking/agent_done`
- `inference.py` : interception `invoke_agent` dans `_execute_tool_with_intercept`, `_agent_sse_queue` + `_drain_agent_sse()`, events `agent_step` streamés en SSE
- `useToolChat.ts` : handler `agent_step`, accumulation dans `agentStepsBuf`, mise à jour `ToolCall.agentSteps`
- `types/index.ts` : `AgentStep` interface + `agentSteps?: AgentStep[]` dans `ToolCall`
- `DevPanel.tsx` : affichage steps sous chaque tool call (spinner/check/dots)
- `MessageContent.tsx` : `ToolCallBlock` reçoit `agentSteps`, affiche steps live (icons + texte)
- `MessageRow.tsx` : prop `agentStepsMap` passée depuis `ChatPage`
- `ChatPage.tsx` : `agentStepsMap` construit depuis `toolCalls`, `skillChatHook.toolCalls` (pas `[]`) en chat normal

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| `web_search`/`fetch_url` jamais exposés au modèle principal | Modèle choisit la voie directe — forcer invoke_agent | 2026-05-22 |
| `_generation_lock` mutex pour `_llm.create_chat_completion` | llama.cpp non thread-safe — SIGABRT si appel concurrent | 2026-05-22 |
| `_tool_executor` dédié pour `execute_tool` | Éviter deadlock event loop asyncio avec thread stream | 2026-05-22 |
| `chat_completion_sync()` appel direct sans asyncio | `asyncio.run()` dans thread depuis uvicorn = SIGSEGV/SIGABRT | 2026-05-22 |
| XML tool_call parsing dans tool_agent | Qwen3 génère `<tool_call>` XML, format natif pas toujours présent | 2026-05-22 |
| Docs/Research injèrent contexte dans system prompt (8K/fichier) | Pas de RAG complet encore, injection directe suffisante | 2026-05-22 |
| `isDevMode = true` pour tous les modes projet | Docs/Research doivent aussi utiliser tool-chat pour invoke_agent | 2026-05-22 |

## Problème ouvert CRITIQUE — À RÉSOUDRE EN PRIORITÉ

### invoke_agent : steps non visibles dans le ToolCallBlock

**Symptôme** : Quand `invoke_agent` tourne, le bloc reste statique "running" sans afficher les steps (web_search, fetch_url, etc.) en temps réel. L'utilisateur voit un spinner mais aucune progression.

**Ce qui a été implémenté** (côté backend OK, validé par logs) :
- `progress_cb` dans `tool_agent.py` émet les events
- `_agent_sse_queue` + `_drain_agent_sse()` dans `inference.py` streamé en SSE
- Events `agent_step` envoyés avant le `tool_result` SSE

**Ce qui est suspecté ne pas fonctionner** (côté frontend) :
- `_drain_agent_sse()` est appelé APRÈS que `run_in_executor` a terminé — les events sont donc drainés après coup, pas pendant l'exécution
- Le vrai bug : `await loop.run_in_executor(_tool_executor, _run_with_progress)` attend la fin avant de retourner, donc `_drain_agent_sse()` n'est jamais appelé pendant que le sous-agent tourne
- La queue se remplit pendant l'exécution mais personne ne la lit jusqu'à ce que `_execute_tool_with_intercept` retourne

**Solution à implémenter** :
- Lancer le sous-agent en background, lire la queue en concurrent pendant qu'il tourne, yield les events en SSE temps réel
- Pattern correct : `asyncio.create_task()` pour lancer l'agent, `asyncio.Queue` async (pas `queue.Queue` threading), loop `while not done: event = await async_queue.get(); yield sse`
- OU : thread séparé qui push dans queue, coroutine qui poll la queue en `asyncio.sleep(0)` loop et yield SSE tant que sentinel pas reçu

## Contexte non-évident

- `_generation_lock` dans llama_service : acquis par `_stream_sync` thread au début, relâché dans `finally`. `chat_completion_sync` attend ce lock — donc jamais concurrent avec le stream.
- `tool_agent.py` parse XML `<tool_call>` via `_TC_RE` regex + `_strip_think()` pour nettoyer le thinking Qwen3
- `_tool_executor = ThreadPoolExecutor(max_workers=4)` global dans inference.py — évite que execute_tool bloque l'event loop uvicorn
- `isDevOnlyMode = project.mode === 'dev'` — contrôle uniquement UI (conv sidebar, workspace files). `isDevMode = true` pour tous (tool-chat routing)
- `web_research` harness = `[web_search, fetch_url]` — seuls tools disponibles pour le sous-agent de recherche
- Fichiers context (Docs) tronqués à 8K chars par fichier dans system prompt — pas de RAG encore
- `chroma.sqlite3` à la racine = fichier parasite (bug CHROMA_DIR) — à supprimer

## Prochaines étapes (ordre prioritaire)

1. **CRITIQUE : Fixer l'affichage temps réel des steps invoke_agent** — voir section "Problème ouvert CRITIQUE" ci-dessus. Pattern async correct requis.
2. Scoring qualité algorithmique dans les benchmarks (sans LLM juge)
3. Nouveaux profils benchmark conversation
4. RAG natif complet dans les projets (PDF, DOCX, etc.)
5. Remote Access — Cloudflare Tunnel + Telegram
6. Parallel models

## Points en suspens

- Erreur TS pré-existante App.tsx:354 (type LoadConfig mismatch) — non bloquante
- Stats à zéro dans done event vLLM (path tool-chat sans text_chunk) — non bloquant
- `chroma.sqlite3` parasite à la racine — à supprimer
- invoke_agent progress visible uniquement après fin (drain post-exécution) — bug critique session 25

## Historique

### Session 24 (2026-05-22)
v1.1 mémoire sémantique + agents natifs livré (ConversationManager JSON, embedding nomic-embed, ChromaDB, tools search/store/invoke_agent, harness universel, Settings Memory UI, system prompts dynamiques). 35+ bugfixes vLLM/chat.

### Session 23 (2026-05-21)
Load profiles (Performance/Balanced/Gaming/Minimal), offload_kqv, multi-GPU, speculative decoding, n_threads adaptatif, notifications persistantes.

### Session 22 (2026-05-21)
Context bar, KV quant, throttle render, smart ctx initial, fix LOG_PATH, watchdog backend Tauri.

### Session 21 (2026-05-20)
Projects workspace (Dev/Docs/Research), tool calling natif, MCP/Skills intelligence, Discover filtres, benchmark leaderboard, streaming token counter.

### Sessions 1–20
Foundation Tauri → vLLM multi-venv → UX → automation → benchmarks → GPU → vision → fine-tuning → MCP skills.
