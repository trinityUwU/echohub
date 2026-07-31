# TODO — EchoHub
*Dernière mise à jour : 2026-07-31 (session 29)*

## En cours

- [ ] **Construction karma Reddit** (r/LocalLLaMA) — objectif 200 avant ~28 juin 2026, 1-2 commentaires/jour
- [ ] **Valider streaming après relance tauri dev** — envoyer message chat normal + message mode projet Dev pour confirmer que WS/XHR fonctionnent

## À faire (priorité)

### P0 — Suite du backend `llama_server` (session 29)

- [ ] **Re-télécharger Qwen3.6-35B-A3B-UD-Q4_K_M.gguf sur un disque sain** — le fichier local est corrompu (sha256 `c009b443…` vs `ac0e2c11…` attendu), il génère du bruit sur tous les chemins. Le disque sda perd son lien SATA : ne pas re-télécharger dessus.
- [ ] **Exposer le choix de moteur dans le frontend** — `POST /inference/load` accepte `engine: "llama_server"` et `n_cpu_moe`/`threads`/`cache_type_k`/`cache_type_v`, mais aucun contrôle UI ne les envoie encore. Aujourd'hui seule la case `is_moe` déclenche l'auto-route.
- [ ] **`ARCHITECTURE.md` manquant** — exigé par les standards, absent du projet. Non créé dans le mandat session 29 (hors périmètre), à faire.
- [ ] **Vérifier `models.py:44`** — `gguf_files[0]` peut être un `mmproj` sur un modèle vision ; la détection MTP scannerait alors le mauvais fichier.


### P0 — Validation streaming (next immédiat)

- [ ] **Relancer tauri dev** : `cd /mnt/projects/echohub && cargo tauri dev` — charger les nouveaux fichiers frontend + backend
- [ ] **Test chatStream WS** : envoyer un message dans le chat normal → vérifier que les tokens arrivent en temps réel
- [ ] **Test toolChat XHR** : ouvrir un projet Dev, envoyer une tâche → vérifier que les tool calls et le texte streament

### P0 — Discord (next)

- [ ] **Isolation MCP discord/chat** — discord/chat ne doit pas hériter des MCP servers actifs dans EchoHub. `engine_router.generate()` plante si skills MCP actifs. Fix : bypass MCP injection dans l'endpoint `/connectors/discord/chat`
- [ ] **web_search conditionnel dans Discord** :
  - GGUF chargé → utiliser `/inference/tool-chat` avec `enabled_tools=["web_search"]`
  - vLLM chargé → utiliser `generate()` sans tools (vLLM ne supporte pas tool calling XML)
  - Détecter `engine_router.get_active_engine()` dans discord_chat endpoint

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
  - ChromaDB par projet, retrieval injecté dans contexte
  - Chat normal = pas de RAG. Exclure ZIP/TAR.GZ
- [ ] **Remote Access — Settings > Remote Access**
  - Cloudflare Tunnel toggle
  - Telegram Bot API — deuxième connecteur (après Discord validé)
- [ ] **Parallel models** — charger plusieurs modèles simultanément
- [ ] **Dynamic KV cache + auto-compact** — smart initial ctx, compaction à 75%
- [ ] **Agent session longue durée** — objectif + durée, rapport final

### P2 — Backlog actif

- [ ] Logs MCP dans card skill — `GET /skills/{id}/mcp/logs?lines=50`
- [ ] Supprimer `chroma_data/` à la racine
- [ ] Fix TS pré-existant App.tsx:354 (non bloquant)
- [ ] Re-télécharger DeepSeek R1 AWQ 7B (poids manquants)
- [ ] Vérifier vLLM venv 0.21.0 — `/home/trinity/.local/share/echohub/vllm-envs/0.21.0/bin/pip show vllm`
- [ ] web_search DDG sélecteurs brittle
- [ ] OOM kernel SIGKILL non détectable — watchdog
- [ ] run_command timeout configurable

### P2 — Performance GPU

- [ ] EAGLE-3 via vLLM — 4090/5090
- [ ] ExLlamaV3 backend — Ada Lovelace
- [ ] Bandwidth-aware profils

### Lancement

- [ ] Objectif karma Reddit : 200 avant ~28 juin 2026
- [ ] Préparer Show HN
- [ ] Rédiger post Reddit/HN avec Chris — /humanizer obligatoire

## Backlog — Roadmap long terme

- [ ] Mémoire sémantique native EchoHub (ChromaDB vectorisé)
- [ ] Multi-node cluster — Ray + vLLM
- [ ] Model routing autonome
- [ ] Remote Access : Telegram, WhatsApp, Signal
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux

## Terminé — session 28 (2026-05-25)

- [x] Fix root cause streaming : WebKit2GTK 4.1 bufférise fetch ReadableStream — switch WS + XHR
- [x] chatStream → WebSocket `/inference/chat/ws` dans Tauri, fetch SSE hors Tauri
- [x] toolChat → XHR onprogress + queue async dans Tauri, fetch SSE hors Tauri
- [x] Backend WebSocket normalisé (dict chunks → JSON, stats + done:true)
- [x] Fix boucle tool call natif : content="" → None pour assistant, None → "" pour tool
- [x] Fix double sentinel dans generate_with_tools (flag _sentinel_sent)
- [x] Fix route echo-passthrough — _passthrough_router sans prefix dans main.py
- [x] EchoCode — port fallback 37823 → 37821 dans vllmToolsBridge.ts
- [x] EchoCode — EchoHubModelDialog /v1/models → /inference/load-state

## Terminé — session 27 continued (archivé)

- [x] Bug "(no response)" — parseInt(url.port)
- [x] Error propagation backend — yield discord_error
- [x] extractDiscordError() côté bot
- [x] system_prompt injecté avant generate()
- [x] Back button echohub_back
- [x] Double message menu — interaction.update()
- [x] Parser SSE — support text_chunk + choices.delta.content
- [x] showMenuViaUpdate extrait

## Terminé — sessions précédentes (archivé)

- [x] Discord connector complet — session 27
- [x] invoke_agent streaming, archive convs projets, auto-scroll, ReAct — session 26
- [x] Projects system, Skills/MCP, Notifications, Auto-compact — sessions 18-25
- [x] Fine-tuning QLoRA, Vision, MTP, KV cache — sessions 13-17
- [x] Scaffolding, vLLM+llama.cpp, Tauri v2, Benchmarks — sessions 1-12
