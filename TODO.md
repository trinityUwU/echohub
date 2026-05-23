# TODO — EchoHub
*Dernière mise à jour : 2026-05-23 (session 27)*

## En cours

- [ ] **Construction karma Reddit** (r/LocalLLaMA) — objectif 200 avant ~28 juin 2026, 1-2 commentaires/jour
- [ ] **Test Discord web_search** — envoyer une question qui nécessite info fraîche, valider que le modèle utilise le tool

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
  - Telegram Bot API — deuxième connecteur (après Discord validé)
  - Session routing → modèle chargé + dernière conv < 5 min
- [ ] **Parallel models** — charger plusieurs modèles simultanément, VRAM bar combinée
- [ ] **Dynamic KV cache + auto-compact** — smart initial ctx, compaction à 75%, reload-on-resize
- [ ] **Agent session longue durée** — user donne objectif + durée, agent tourne autonome, rapport final

### P2 — Backlog actif

- [ ] Logs MCP dans card skill — endpoint `GET /skills/{id}/mcp/logs?lines=50`
- [ ] Supprimer `chroma_data/` et `chroma.sqlite3` à la racine (fichiers parasites)
- [ ] Fix TS pré-existant App.tsx:354 (type LoadConfig `kvQuant null` mismatch)
- [ ] Fix indicateur `~` après fin de stream (race condition liveTokens/streaming)
- [ ] web_search DDG sélecteurs brittle — fallback si DDG change layout
- [ ] OOM kernel SIGKILL non détectable — watchdog process
- [ ] run_command timeout configurable (tsc sur gros projets > 10s)
- [ ] Fix stats à zéro dans done event vLLM (path tool-chat sans text_chunk)
- [ ] Re-télécharger DeepSeek R1 AWQ 7B (poids manquants, seules métadonnées présentes)
- [ ] Vérifier vLLM venv 0.21.0 — `/home/trinity/.local/share/echohub/vllm-envs/0.21.0/bin/pip show vllm`

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

## Terminé — session 27

- [x] **Discord connector — Settings > Connectors > Discord** — config bot_token/client_id/authorized_user_id
- [x] **Bot discord.js (Bun)** — sidecar géré par FastAPI, start/stop depuis Settings
- [x] **Streaming SSE via http.request** — stable (Bun fetch+ReadableStream crash socket)
- [x] **Embeds Discord** — streaming live curseur ▍, throttle 800ms, couleur blurple at done
- [x] **Strip `<think>` → séparateur ---** — plus affiché dans les embeds
- [x] **Strip `<tool_call>`/`<tool_response>`** → indicateurs 🔧/📥
- [x] **Conversations EchoHub partagées** — même SQLite, même API REST
- [x] **State machine bot** : idle/chatting/menu/conv_list
- [x] **Select menu conversations** — liste des convs EchoHub, rebuild historique depuis DB
- [x] **Profils de chat** : Default/Precise/Creative/Balanced/Coder — select menu ⚙️
- [x] **Boutons contextuels** sur chaque embed (règle zéro embed sans boutons)
- [x] **Tool calls log** — bouton ⚡, 5 derniers appels avec timestamp/input/output
- [x] **web_search activé par défaut** dans discord/chat via generate_with_tools
- [x] **Fix token sentinel** — bot_token="" ne réécrit plus le token en DB
- [x] **Fix Partials.Message+User** — interactions bouton DM reçues
- [x] **Fix interaction.update()+message.edit()** — séquence correcte après debug timeout
- [x] **Fix double socket error** — flag settled dans handleSSEResponse
- [x] **Fix emoji ← invalide** → ↩️
- [x] **ConnectorsTab UI** — inputs bg-elevated border-transparent, cohérent dark theme

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
