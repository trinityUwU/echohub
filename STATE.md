# STATE — EchoHub
*Dernière mise à jour : 2026-05-23 (session 27)*

## Résumé de l'état actuel

Application Tauri v2 stable. **Session 27 = Discord connector complet end-to-end.** Bot discord.js (Bun) intégré dans Settings > Connectors > Discord. Conversations EchoHub partagées (même SQLite). Streaming SSE via http.request (stable), embeds Discord, profils de chat, boutons contextuels, web_search actif par défaut. Toutes les interactions bouton DM fonctionnelles (Conversations, Profile, Menu, New Chat).

## Ce qui a été fait — session 27 (2026-05-23)

### Discord Connector — livraison complète

**Backend :**
- `backend/routers/connectors.py` :
  - `POST /connectors/discord/chat` : génère via `generate_with_tools` + persiste user/assistant en SQLite
  - `web_search` activé par défaut (`enabled_tools=["web_search"]`)
  - `system_prompt` injectable (pour les profils de chat)
- `backend/services/db.py` : table `connectors` (config, status, error)
- Fix token sentinel : `bot_token=""` ne réécrit plus le token existant en DB

**Bot Bun — 4 fichiers (`connectors/discord/`) :**
- `discord-dm-bot.ts` (497L) : state machine complète, routing messages/commands/interactions
- `discord-api-helpers.ts` (179L) : BotSession, CHAT_PROFILES, buildActionRow centralisé, apiGet/apiPost
- `discord-stream-helpers.ts` (255L) : SSE via http.request, parse OpenAI format, strip artifacts, tool events
- `discord-embed-helpers.ts` (94L) : buildHistoryEmbed, buildToolsEmbed, showProfileSelector

**Features Discord :**
- State machine : `idle` → `chatting` → `menu` → `conv_list`
- Init au démarrage : charge la dernière conv EchoHub depuis `GET /conversations`
- Streaming live : embed édité toutes les 800ms avec curseur `▍`
- Strip `<think>` → séparateur `---`, `<tool_call>` → `🔧 Tool call`, `<tool_response>` → `📥 Tool result`
- Conversations EchoHub intégrées : select menu avec toutes les convs, rebuild historique depuis DB
- Profils de chat : Default/Precise/Creative/Balanced/Coder — system_prompt + temperature injectés
- Boutons contextuels sur CHAQUE embed (règle : zéro embed sans boutons)
- Historique mémoire : 40 messages max, push user avant / assistant après chaque échange
- Commandes texte : `!clear` `!help` `!menu` `!resume`
- Tool calls log : bouton `⚡` → 5 derniers appels avec timestamp/input/output

**Fixes critiques :**
- SSE Bun : `fetch` + `ReadableStream` instable → `http.request` Node-compat (stable)
- WebSocket : incompatible uvicorn CORS (403) → SSE non-stream puis http.request stream
- Discord interactions timeout (3s) : `interaction.update()` immédiat → `interaction.message.edit()` ensuite
- Double socket error : flag `settled` dans handleSSEResponse
- Boutons Conversations/Profile silencieux : Partials.Message+User manquants (interactions DM)
- Emoji `←` invalide Discord → `↩️`
- `bot_token` écrasé par sentinel vide → backend préserve token existant si body `bot_token=""`

**Frontend :**
- `frontend/src/components/settings/ConnectorsTab.tsx` : inputs `bg-elevated border-transparent`
- `frontend/src/components/settings/SettingsPage.tsx` : onglet Connectors ajouté

### Divers
- vLLM zombie (pid 288991) killéé manuellement

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| discord.js Bun (pas discord.py) | discord.py quasi-abandonné, discord.js = standard officiel | 2026-05-23 |
| DM-only — pas de Guild ID | Config réduite à 3 champs, conversation privée par défaut | 2026-05-23 |
| SSE via http.request Node-compat | Bun fetch+ReadableStream crash socket sur connexions longues | 2026-05-23 |
| WebSocket abandonné | uvicorn CORS bloque le WS handshake (403 → 101 fail) | 2026-05-23 |
| interaction.update() → message.edit() | deferUpdate+editReply incompatibles, update+message.edit() correct | 2026-05-23 |
| Partials.Message+User dans createClient() | Sans eux, les interactions bouton en DM ne sont pas reçues | 2026-05-23 |
| generate_with_tools pour discord/chat | web_search accessible, même loop que le frontend | 2026-05-23 |
| Conversations partagées (même SQLite) | Pas d'interface parallèle — Discord = vrai frontend EchoHub | 2026-05-23 |

## Contexte non-évident

- **SSE streaming Discord** : http.request Node events `data` → stable. Bun `fetch()` + `getReader()` → "socket closed unexpectedly" après quelques secondes. WebSocket → uvicorn retourne 403 (CORS) même avec bon Origin header.
- **Discord interactions en DM** : nécessite `Partials.Channel + Partials.Message + Partials.User` dans createClient(). Sans Message+User, les boutons cliqués en DM n'arrivent jamais dans `Events.InteractionCreate`.
- **interaction.update() vs deferReply** : `update()` acknowledge l'interaction immédiatement (modifie le message original). Pour un suivi via `message.edit()` c'est la bonne séquence. `deferReply()` + `editReply()` sont incompatibles avec `update()`.
- **Bot token sentinel** : frontend envoie `""` quand le champ affiche `"***"`. Backend garde le token existant si `bot_token == ""`. Token perdu = champ vide → warning jaune.
- **Emojis Discord** : `←` (flèche Unicode text) = invalide. Utiliser uniquement des emojis Unicode réels (ex: `↩️`, `📋`, `⚙`, `🗑`). Les variation selectors `️` (U+FE0F) peuvent aussi poser problème sur certains emojis.
- **vLLM venv 0.21.0** : créé avec Python 3.14 (bug). Recréer via Settings → Engines si nécessaire.

## Prochaines étapes

1. Tester Discord connector en conditions réelles avec web_search (demander une info fraîche)
2. Scoring qualité algorithmique dans benchmarks (P0 reporté depuis session 25)
3. RAG natif projets — PDF/DOCX/MD/CSV drag-drop, ChromaDB par projet
4. Remote Access — Cloudflare Tunnel + Telegram (après Discord validé)
5. Re-télécharger DeepSeek R1 AWQ 7B (poids manquants)

## Points en suspens

- vLLM venv 0.21.0 : vérifier avec `/home/trinity/.local/share/echohub/vllm-envs/0.21.0/bin/pip show vllm`
- Fix TS pré-existant `App.tsx:354` (LoadConfig kvQuant null mismatch) — non bloquant
- `chroma_data/` à la racine — répertoire parasite à supprimer (ou .gitignore)
- `chroma.sqlite3` à la racine — fichier parasite

## Historique

### Session 26 (2026-05-22)
invoke_agent streaming end-to-end (agent_runner.py async generator). _parse_tool_call_json regex fallback 3 niveaux (GGUF Qwen3 tronque JSON). Conversations projets sauvegardées tous modes. Archive conversations projets. Auto-scroll toggle animé. ReAct framework natif prompts sous-agent. hljs live streaming code.

### Session 25 (2026-05-22)
Docs/Research panels fonctionnels (DB, endpoints, frontend drag-drop). invoke_agent chaîne complète réparée (SIGSEGV→deadlock→XML parsing). Streaming backend implémenté mais steps non visibles dans ToolCallBlock — bug drain timing.

### Sessions 18-24 (2026-05-20 à 2026-05-22)
Projects system (Dev/Docs/Research). Tool use streaming interleaved (stop_event, detect `</tool_call>` mid-stream). Auto-compact 98%. Set_tool_limit. Scrapling (web_search/fetch_url). Slash commands. Skills/MCP system. Notifications. Awareness conditionnelle.

### Sessions 13-17 (2026-05-19)
Fine-tuning pipeline Unsloth QLoRA. GGUF export. Eval before/after. Vision llama.cpp (mmproj, Qwen25VL/LLaVA). MTP detection. KV cache Q8_0 par défaut. Reload model depuis footer. Wayland clipboard.

### Sessions 1-12 (2026-05-15 à 2026-05-17)
Scaffolding complet. vLLM + llama.cpp dual engine. Multi-venv vLLM. Tauri v2 migration. Installer. Mise à jour système. Benchmarks qualité. Discover multi-filtres.
