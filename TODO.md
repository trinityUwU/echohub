# TODO — EchoHub
*Dernière mise à jour : 2026-05-20 (session 21)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — 1-2 commentaires/jour, sujets perfs/vLLM/GGUF/CUDA
- [ ] Rédiger post Reddit/HN avec Chris (matériel prêt — démo Skills/MCP + Projects + agent)

## À faire (priorité)

### P0 — Prochaine session

- [ ] **Types de projets Dev/Docs/Research** — layouts fonctionnels, pas stubs
  - Dev : arborescence fichiers réelle + IDE-like (file tree, tabs)
  - Docs : injection contexte fichiers drag & drop
  - Research : gestion sources URL/documents
- [ ] **RAG natif dans les projets**
  - PDF (pdfplumber), DOCX (python-docx), PPTX, XLSX, MD, CSV, JSON
  - ChromaDB par projet, retrieval injecté dans contexte à chaque message
  - Chat normal = pas de RAG

### P1 — Session suivante

- [ ] **Logs MCP** dans la card skill — last session logs, endpoint GET /skills/{id}/mcp/logs?lines=50
- [ ] **Scoring qualité benchmarks** — algo sans LLM juge, score 0-100 dans leaderboard
  - Code : compilation OK, présence éléments attendus
  - Raisonnement : réponse correcte
  - Instruction : format
  - Résumé : couverture mots-clés
- [ ] **Profils benchmark conversation** — minimal/medium/long context avec scoring auto

### P2 — Backlog actif

- [ ] MTP — détection GGUF + badge Discover + export fine-tune préservant tenseurs MTP
- [ ] Fix indicateur `~` après fin de stream (race condition liveTokens/streaming)
- [ ] web_search DDG sélecteurs brittle — fallback si DDG change layout
- [ ] OOM kernel SIGKILL non détectable — watchdog process
- [ ] Tester Qwen2.5-Coder-14B Q4_K_M pour Dev mode (tool calling natif probable)
- [ ] run_command timeout configurable (tsc sur gros projets peut dépasser 10s)

### Lancement

- [ ] Objectif karma Reddit : 200 commentaires avant ~28 juin 2026
- [ ] Finaliser posts avec Chris — /humanizer obligatoire avant publication
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)

## Backlog

- [ ] Tool calling natif vLLM dans generate_with_tools
- [ ] Scrapling MCP server natif (alternative aux tools custom)
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux (Phase 2)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune)
- [ ] Modèle juge fiable (après fine-tuning + évaluation itérative)
- [ ] Multi-GPU support vLLM
- [ ] Valider .AppImage + .deb
- [ ] Supprimer vieux composants héritage (ChatPanel.tsx, LoadConfigModal.tsx)

## Terminé ✅ (session 21 — 2026-05-20)

- [x] MCP stdio transport — McpStdioClient, pool, JSON-RPC 2.0 over stdin/stdout
- [x] Venv isolé par skill Python (plus de contamination du backend venv)
- [x] detect_mcp_server : smithery.yaml, StdioServerTransport Node, monorepos exclus
- [x] Auto-redetect transport manquant au start + patch registry.json
- [x] Context budget awareness dans tool results (75% warn, 92% hard stop)
- [x] Synthesis on tool cap (plus de coupure mid-response)
- [x] Cap warning → set_tool_limit explicite
- [x] Timeout 60s call_mcp_tool (plus de deadlock LLM)
- [x] Persistance messages MCP (onSaveMessage sur skillChatHook)
- [x] Context bar projets (usedTokens depuis historique)
- [x] Déduplication messages (deduplicateMessages)
- [x] Tool call blocks animés (Framer Motion, ouvert pendant exec, fermé done)
- [x] 5 profils chat avec vrais system prompts + permanent rules + langue mirroring
- [x] Testé end-to-end : paper-search-mcp (57 tools) + mcp-fetch-server (6 tools)

## Terminé ✅ (session 20 — 2026-05-20)

- [x] Native skills : Web Search, Code Runner, File System, Calculator
- [x] Community skills installables depuis GitHub (clone + install + toggle)
- [x] Awareness blocks injectés dans system prompt selon skills actifs
- [x] MCP HTTP servers fonctionnels
- [x] Notifications SSE (toasts temps réel)
- [x] Modularisation backend routers/services

## Terminé ✅ (session 19 — 2026-05-20)
- [x] Streaming interleaved tool execution (stop_event, mid-stream tool call)
- [x] Parser MessageContent à état (think/tool_call/tool_result imbriqués)
- [x] Auto-compact 98% + set_tool_limit
- [x] fetch_url + web_search via Scrapling
- [x] Slash commands /clear /compact /tokens /model /files /limit
- [x] Capabilities détectées au load modèle

## Terminé ✅ (sessions 1-18)
- [x] Dual-engine inference (llama.cpp + vLLM), VRAM management, model discovery
- [x] Multi-vLLM versions, benchmark suite, fine-tuning QLoRA complet
- [x] MTP support, vision GGUF, Projects workspace + tool calling
