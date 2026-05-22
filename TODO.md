# TODO — EchoHub
*Dernière mise à jour : 2026-05-22 (session 25)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — objectif 200 avant ~28 juin 2026, 1-2 commentaires/jour

## À faire (priorité)

### 🔴 P0 — CRITIQUE — Prochaine session

- [ ] **Fixer affichage temps réel des steps invoke_agent dans ToolCallBlock**
  - **Symptôme** : bloc "running" statique, steps web_search/fetch_url invisibles pendant exécution
  - **Cause racine** : `_drain_agent_sse()` est appelé APRÈS `run_in_executor` → events drainés trop tard
  - **Solution** : lancer le sous-agent en concurrent avec lecture async de la queue
    - Utiliser `asyncio.Queue` (pas `queue.Queue`) pour thread-safe cross-loop
    - Pattern : `asyncio.create_task(run_agent)` + `while not done: event = await async_q.get(); yield SSE`
    - OU : thread push dans `threading.Queue`, coroutine poll avec `asyncio.sleep(0)` en boucle while sentinel
  - Fichiers concernés : `backend/routers/inference.py` (`_execute_tool_with_intercept`), `backend/services/tool_agent.py`

### P0 — Suite

- [ ] **Scoring qualité algorithmique dans benchmarks** — sans LLM juge
  - Code : compilation + présence éléments attendus
  - Raisonnement : réponse correcte extractible
  - Instruction : format respecté
  - Score 0-100 dans leaderboard à côté du tok/s
- [ ] **Nouveaux profils benchmark conversation**
  - minimal context (dialogue court, détection hallucination)
  - medium context (~10 échanges, questions de rappel)
  - long context (historique dense, vérification mémorisation)
  - Scoring automatique sur chaque profil

### P1 — Session suivante

- [ ] **RAG natif complet dans les projets**
  - PDF (pdfplumber), DOCX (python-docx), PPTX, XLSX, MD, CSV, JSON
  - ChromaDB par projet, retrieval injecté dans contexte à chaque message
  - Chat normal = pas de RAG. Exclure ZIP/TAR.GZ
- [ ] **Remote Access — Settings > Remote Access**
  - Cloudflare Tunnel toggle avec status badge
  - Telegram Bot API — premier adaptateur messaging
  - Session routing → modèle chargé + dernière conv < 5 min
- [ ] **Parallel models** — charger plusieurs modèles simultanément, VRAM bar combinée
- [ ] **Logs MCP** dans la card skill — endpoint GET /skills/{id}/mcp/logs?lines=50
- [ ] Supprimer `chroma.sqlite3` à la racine (fichier parasite du bug CHROMA_DIR)
- [ ] Rédiger post Reddit/HN avec Chris — /humanizer obligatoire avant publication

### P2 — Performance GPU (backlog actif)

- [ ] **EAGLE-3 via vLLM** — 4090/5090, ~6x speedup. vLLM only, nécessite modèle EAGLE3
- [ ] **ExLlamaV3 backend** — Ada Lovelace (4090/5090). Ampere encore second-class
- [ ] **Bandwidth-aware profils** — adapter calcul selon bandwidth GPU
- [ ] **LMDeploy backend optionnel** — benchmarker sur 4090
- [ ] **Blackwell/5090 compat** — PDL llama.cpp = Hopper+ only, surveiller
- [ ] **Speculative MTP** — mesurer gain réel sur Qwen3
- [ ] **N-gram n_pred_tokens auto** — ajuster selon type de task

### P2 — Backlog actif

- [ ] Fix indicateur `~` après fin de stream (race condition liveTokens/streaming)
- [ ] web_search DDG sélecteurs brittle — fallback si DDG change layout
- [ ] OOM kernel SIGKILL non détectable — watchdog process
- [ ] run_command timeout configurable (tsc sur gros projets > 10s)
- [ ] Investiguer : useToolChat ne sauvegarde pas message user dans certains cas
- [ ] Fix stats à zéro dans done event vLLM (path tool-chat sans text_chunk)
- [ ] Fix erreur TS pré-existante App.tsx:354 (type LoadConfig mismatch)

### Lancement

- [ ] Objectif karma Reddit : 200 commentaires avant ~28 juin 2026
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)

## Backlog — Roadmap long terme

- [ ] **Multi-node cluster** — Ray + vLLM distribué
- [ ] **Model routing autonome** — sub-agent choisit le meilleur modèle selon la tâche
- [ ] **Agent session longue durée** — objectif + durée, agent tourne autonome, rapport final
- [ ] **Dynamic KV cache + auto-compact** — smart initial ctx, compaction à 75%, reload-on-resize
- [ ] Remote Access : WhatsApp Business API, Signal via signal-cli (après Telegram validé)
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux
- [ ] EchoForge ↔ EchoHub API locale
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune)
- [ ] Multi-modèles en parallèle avec routing tâche→modèle
- [ ] Valider .AppImage + .deb

## Terminé ✅ (session 25 — 2026-05-22)

- [x] DocsPanel — drag-drop fichiers texte, liste avec suppression, persistance DB
- [x] ResearchPanel — input URL + drag-drop doc, liste sources, persistance DB
- [x] Tables DB `project_context_files` + `project_sources` + CRUD
- [x] Endpoints REST context-files + sources (upload multipart, list, delete)
- [x] Injection context files dans system prompt (mode docs, 8K/fichier)
- [x] Injection sources dans system prompt (mode research)
- [x] Hook `useProjectContext.ts` (useContextFiles + useProjectSources)
- [x] `apiUpload()` dans base.ts pour multipart
- [x] Fix routing : tous modes projet → tool-chat (isDevMode=true, isDevOnlyMode=dev only)
- [x] Fix invoke_agent absent des tools → toujours injecté dans enabled_tools
- [x] Fix web_search/fetch_url retirés du modèle principal (réservés sous-agents)
- [x] Fix SIGSEGV : `chat_completion_sync()` + `_generation_lock` mutex dans llama_service
- [x] Fix SIGABRT : sans asyncio, appel direct `_llm.create_chat_completion` synchrone
- [x] Fix deadlock : `_tool_executor` ThreadPoolExecutor dédié pour execute_tool
- [x] Fix XML tool_calls : `_parse_xml_tool_calls()` + `_strip_think()` dans tool_agent
- [x] harness `web_research` ajouté (web_search + fetch_url)
- [x] Research system prompt force invoke_agent, interdit direct web_search
- [x] Progress streaming backend : `progress_cb` + `_agent_sse_queue` + `_drain_agent_sse()`
- [x] `AgentStep` type + `agentSteps` dans ToolCall
- [x] DevPanel : affichage steps sous-agents (spinner/check/dots)
- [x] invoke_agent exécute réellement web_search + fetch_url (validé avec benchmarks réels)
- [x] Conv sidebar visible dans tous les modes projet (pas seulement dev)

## Terminé ✅ (session 24 — 2026-05-22)

- [x] ConversationManager JSON, embedding nomic-embed, ChromaDB memory layer
- [x] Tools search_memory + store_memory + invoke_agent
- [x] Harness universel, Settings Memory UI, system prompts dynamiques
- [x] /lint command globale
- [x] Split vllm_service + tool_service
- [x] 20+ bugfixes vLLM + chat UI (N-gram, footer stats, conv switch, ctx adaptatif, etc.)
