# TODO — EchoHub
*Dernière mise à jour : 2026-05-22 (session 24)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — objectif 200 avant ~28 juin 2026, 1-2 commentaires/jour
- [ ] Rédiger post Reddit/HN avec Chris — /humanizer obligatoire avant publication
- [ ] Tester vLLM tool-use après reload avec `--enable-auto-tool-choice` (modèle actuel sans ces flags)

## À faire (priorité)

### P0 — Prochaine session

- [ ] **Types projets Dev/Docs/Research** — layouts fonctionnels, pas stubs
  - Dev : arborescence fichiers réelle + IDE-like (file tree, tabs)
  - Docs : injection contexte fichiers drag & drop
  - Research : gestion sources URL/documents
- [ ] **RAG natif dans les projets**
  - PDF (pdfplumber), DOCX (python-docx), PPTX, XLSX, MD, CSV, JSON
  - ChromaDB par projet, retrieval injecté dans contexte à chaque message
  - Chat normal = pas de RAG
- [ ] **Remote Access — Settings > Remote Access**
  - Cloudflare Tunnel toggle avec status badge
  - Telegram Bot API — premier adaptateur messaging
  - Session routing → modèle chargé + dernière conv < 5 min
- [ ] Supprimer `chroma.sqlite3` à la racine du projet (fichier parasite du bug CHROMA_DIR)

### P1 — Session suivante

- [ ] **Parallel models** — charger plusieurs modèles simultanément, VRAM bar combinée
- [ ] **Harness + sous-agents orchestrateur** — invoke_agent stable, valider flow complet
- [ ] **Logs MCP** dans la card skill — endpoint GET /skills/{id}/mcp/logs?lines=50
- [ ] **Scoring qualité benchmarks** — algo sans LLM juge, score 0-100 dans leaderboard
- [ ] **Profils benchmark conversation** — minimal/medium/long context avec scoring auto
- [ ] Investiguer : `useToolChat` ne sauvegarde pas message user dans certains cas
- [ ] Fix stats à zéro dans done event vLLM (path tool-chat sans text_chunk comptabilisé)
- [ ] Fix erreur TS pré-existante App.tsx:344 (type LoadConfig mismatch)

### P2 — Performance GPU (backlog actif)

- [ ] **Speculative MTP** — mesurer gain réel sur Qwen3 (têtes présentes vs gain effectif)
- [ ] **N-gram n_pred_tokens auto** — ajuster selon type de task (coding → 16, chat → 6)
- [ ] **EAGLE-3 via vLLM** — 4090/5090, ~6x speedup. vLLM only, nécessite modèle EAGLE3
- [ ] **ExLlamaV3 backend** — Ada Lovelace (4090/5090). Ampere encore second-class
- [ ] **Bandwidth-aware profils** — adapter calcul selon bandwidth GPU
- [ ] **LMDeploy backend optionnel** — benchmarker sur 4090
- [ ] **Blackwell/5090 compat** — PDL llama.cpp = Hopper+ only, surveiller

### P2 — Backlog actif

- [ ] Fix indicateur `~` après fin de stream (race condition liveTokens/streaming)
- [ ] web_search DDG sélecteurs brittle — fallback si DDG change layout
- [ ] OOM kernel SIGKILL non détectable — watchdog process
- [ ] run_command timeout configurable (tsc sur gros projets > 10s)

### Lancement

- [ ] Objectif karma Reddit : 200 commentaires avant ~28 juin 2026
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)

## Backlog — Roadmap long terme

- [ ] **Multi-node cluster** — Ray + vLLM distribué
- [ ] **Model routing autonome** — sub-agent choisit le meilleur modèle selon la tâche
- [ ] Remote Access : WhatsApp Business API, Signal via signal-cli (après Telegram validé)
- [ ] Tool calling natif vLLM dans generate_with_tools (natif OpenAI format)
- [ ] Scrapling MCP server natif
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux
- [ ] EchoForge ↔ EchoHub API locale
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune)
- [ ] Supprimer vieux composants héritage (ChatPanel.tsx, LoadConfigModal.tsx)
- [ ] Valider .AppImage + .deb

## Terminé ✅ (session 24 — 2026-05-22)

- [x] ConversationManager JSON — remplace SQLite pour chat + project convs
- [x] Migration one-shot SQLite→JSON au boot
- [x] Embedding service nomic-embed-text-v1.5 CPU-only + auto-download
- [x] Mutex llama.cpp global partagé (llama_lock.py) — résout "Memory is not initialized"
- [x] ChromaDB memory layer — store/search/delete/stats, scope conv/project/global
- [x] Routes `/memory/*` — POST store, search, GET list, stats, DELETE
- [x] Tools search_memory + store_memory + invoke_agent dans TOOLS[] + dispatch
- [x] invoke_agent — boucle tool-use isolée, 3 harness profiles (read_strict/write_validated/shell_safe)
- [x] Harness universel — language detection + syntax + lint + result normalizer
- [x] Settings > Memory tab (stats ChromaDB, liste, filtres, delete)
- [x] Toggle Memory par conversation dans ChatTopBar
- [x] System prompts dynamiques selon project_mode (Dev/Docs/Research/chat)
- [x] /lint command globale + scripts/lint_standards.py
- [x] Split vllm_service.py → vllm_generate + vllm_loader + vllm_process + vllm_vram
- [x] Split tool_service.py → tool_agent + tool_memory + tool_definitions
- [x] Fix GPTQ/AWQ "No model loaded" — vllm_generate._current_model stale (sys.modules fix)
- [x] Fix vLLM tool-use 400 — --enable-auto-tool-choice + --tool-call-parser au launch
- [x] Fix réponse vide vLLM tool-chat — generate_with_tools yields dicts structurés
- [x] Fix N-gram segfault — défaut 'off' dans useModels/App.tsx/LoadModelModal
- [x] Fix footer stats disparaissent — memo React comparait pas message.stats/loadConfig
- [x] Fix stats footer persistées après streaming (useToolChat done + onSaveMessage)
- [x] Fix bouton reload model — loadConfig sauvegardé dans messages
- [x] Fix regenerate/editUser en mode skills — sendFromHistory() dans useToolChat
- [x] Fix conv switch sans loader stats — stop() + setMessages() forcés sur activeId change
- [x] Fix delete conv archivée — filtrait pas archivedConversations[]
- [x] ctx adaptatif — auto-reload sans toast, ctxMode dans activeLoadConfig
- [x] Fix system prompt dev injecté en mode chat normal sans fs tools
- [x] vLLM generate (chat normal) — badge stale fixé, 404 detail lisible

## Terminé ✅ (session 23 — 2026-05-21)

- [x] 4 profils chargement (Performance/Balanced/Gaming/Minimal)
- [x] offload_kqv, n_batch, smart cap ctx, fix resolvedNGpuLayers null
- [x] Multi-GPU llama.cpp tensor_split + vLLM tensor_parallel_size
- [x] Speculative decoding ngram/MTP/draft model
- [x] n_threads adaptatif CPU-heavy, n_batch=512 Minimal
- [x] Notifications persistantes localStorage
