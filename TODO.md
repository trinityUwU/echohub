# TODO — EchoHub
*Dernière mise à jour : 2026-05-22 (session 26)*

## En cours

- [ ] **Réinstaller vLLM 0.21.0 en Python 3.11** — `pip install` en background, vérifier avec `/home/trinity/.local/share/echohub/vllm-envs/0.21.0/bin/pip show vllm` puis Settings → Engines → confirm
- [ ] **Construction karma Reddit** (r/LocalLLaMA) — objectif 200 avant ~28 juin 2026, 1-2 commentaires/jour

## À faire (priorité)

### P0 — Fonctionnalités bloquantes

- [ ] **Scoring qualité algorithmique dans benchmarks** — sans LLM juge
  - Code : compilation + présence éléments attendus
  - Raisonnement : réponse correcte extractible
  - Instruction : format respecté
  - Score 0-100 dans leaderboard à côté du tok/s
- [ ] **Nouveaux profils benchmark conversation**
  - minimal context (dialogue court, détection hallucination)
  - medium context (~10 échanges, questions de rappel)
  - long context (historique dense, vérification mémorisation)

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
- [ ] **Dynamic KV cache + auto-compact** — smart initial ctx, compaction à 75%, reload-on-resize
- [ ] **Agent session longue durée** — user donne objectif + durée, agent tourne autonome, rapport final

### P2 — Backlog actif

- [ ] Logs MCP dans card skill — endpoint `GET /skills/{id}/mcp/logs?lines=50`
- [ ] Supprimer `chroma.sqlite3` à la racine (fichier parasite)
- [ ] Fix TS pré-existant App.tsx:354 (type LoadConfig `kvQuant null` mismatch)
- [ ] Fix indicateur `~` après fin de stream (race condition liveTokens/streaming)
- [ ] web_search DDG sélecteurs brittle — fallback si DDG change layout
- [ ] OOM kernel SIGKILL non détectable — watchdog process
- [ ] run_command timeout configurable (tsc sur gros projets > 10s)
- [ ] Fix stats à zéro dans done event vLLM (path tool-chat sans text_chunk)
- [ ] Re-télécharger DeepSeek R1 AWQ 7B (poids manquants, seules métadonnées présentes)

### P2 — Performance GPU

- [ ] **EAGLE-3 via vLLM** — 4090/5090, ~6x speedup. vLLM only, nécessite modèle EAGLE3
- [ ] **ExLlamaV3 backend** — Ada Lovelace (4090/5090). Ampere encore second-class
- [ ] **Bandwidth-aware profils** — adapter calcul selon bandwidth GPU
- [ ] **Speculative MTP** — mesurer gain réel sur Qwen3

### Lancement

- [ ] Objectif karma Reddit : 200 commentaires avant ~28 juin 2026
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)
- [ ] Rédiger post Reddit/HN avec Chris — /humanizer obligatoire avant publication

## Backlog — Roadmap long terme

- [ ] **Mémoire sémantique native** — ChromaDB vectorisé, toggle par discussion, tools mémoire agent
- [ ] **Multi-node cluster** — Ray + vLLM distribué
- [ ] **Model routing autonome** — sub-agent choisit le meilleur modèle selon la tâche
- [ ] Remote Access : WhatsApp Business API, Signal via signal-cli (après Telegram validé)
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux

## Terminé — session 26

- [x] invoke_agent streaming end-to-end — tokens sous-agent en temps réel via agent_runner.py async generator
- [x] _parse_tool_call_json robuste — JSON tronqué GGUF géré par regex fallback 3 niveaux
- [x] agentSteps dupliqués entre blocs invoke_agent — keyed par "invoke_agent:N"
- [x] Orphan `</tool_call>` affiché entre blocs — stripé dans parseSegments
- [x] Orphan `</think>` Qwen3 — détecté et mis en ThinkingBlock collapsé
- [x] Conversations projets sauvegardées pour tous les modes (plus seulement Dev)
- [x] Archive conversations projets — backend + hook + UI onglets Active/Archived
- [x] ReAct framework natif dans prompts sous-agent et orchestrateur Research
- [x] Brief invoke_agent collapsible live (contenu task en temps réel, s'ouvre auto, se replie à l'exécution)
- [x] Code streaming structuré (create_file/edit_file) — header fichier + hljs live + extraction regex JSON partiel
- [x] Auto-scroll toggle pendant génération — bouton pill animé, AutoScrollContext React, scroll interne containers
- [x] start.sh : vide __pycache__ + reset logs à chaque lancement
- [x] lib.rs : find_python() dynamique (venv→python3.11→python3) + clear pycache au spawn
- [x] App.tsx : détection restart backend via started_at polling 5s + toast + refresh
- [x] vllm_manager.py : force python3.11 pour nouveaux venvs vLLM
- [x] Fix hooks React Rules dans ToolCallBody (Fewer hooks than expected)
- [x] useToolChat throttle 50ms hors boucle for-await (fix persistance timer)
