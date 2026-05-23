# STATE — EchoHub
*Dernière mise à jour : 2026-05-23 (session 27 continued)*

## Résumé de l'état actuel

Application Tauri v2 stable. Discord connector fonctionnel — streaming SSE, embeds, boutons contextuels, conversations EchoHub intégrées, profils de chat. **Bug "(no response)" résolu** — root cause : `url.port` retourne une string en JS, `http.request` Node/Bun ignorait le port silencieusement → connexion port 80 → timeout. Error propagation backend ajoutée. **web_search non encore intégré dans Discord** (generate_with_tools cassé vLLM, isolation skills MCP en attente).

## Ce qui a été fait — session 27 continued (2026-05-23)

### Discord — fixes critiques post-checkpoint

**Bug "(no response)" — root cause chaîne complète :**
1. `generate_with_tools` incompatible vLLM (signature différente, stream vide) → revenu à `engine_router.generate()`
2. `url.port` retourne `"37821"` (string) en JS Web URL API. `http.request` Node/Bun ignore un `port` string → connexion port 80 → timeout silencieux → `accumulated = ""` → "(no response)". Fix : `parseInt(url.port)` dans `discord-stream-helpers.ts` ET `discord-api-helpers.ts`
3. Exception backend silencieuse quand skills MCP actifs : `except Exception: return` stoppait le générateur sans rien yielder. Fix : yield `data: {"type":"discord_error","error":"..."}` + `extractDiscordError()` côté bot
4. `accumulated` vide sans erreur → message d'erreur explicite "⚠️ No response from model..." au lieu de "(no response)"
5. `onStreamError` log toujours le message complet

**Bug double menu :**
- `interaction.deferUpdate()` + `channel.send()` = deux messages Discord. Fix : `interaction.update()` modifie le message original

**Bug Back to Menu :**
- `echohub_back` absent du handler `handleButtonInteraction`. Ajouté.

**Bug parser SSE :**
- `parseSSEChunk` lisait uniquement `choices.delta.content` (format OpenAI). `generate_with_tools` émet `{"type":"text_chunk","content":"..."}`. Support des deux formats ajouté.

**system_prompt non injecté :**
- `DiscordChatRequest.system_prompt` reçu mais non injecté dans les messages. Fix : prepend `{"role":"system","content":system_prompt}` avant `engine_router.generate()`

**Back button :**
- `echohub_back` → `showMenuViaUpdate()` extrait dans `discord-embed-helpers.ts`

### État du Discord connector maintenant

**Fonctionnel :**
- Streaming SSE (http.request Node-compat, parseInt port)
- Embeds avec boutons contextuels (Menu, Conversations, New Chat, Profile, History, Tools, Back)
- Conversations EchoHub partagées (même SQLite)
- Profils de chat Default/Precise/Creative/Balanced/Coder
- Error messages explicites (plus de "(no response)" silencieux)
- Back to Menu fonctionnel

**Non fonctionnel / en attente :**
- web_search dans Discord : désactivé. `generate_with_tools` cassé vLLM (signature différente), et les skills MCP actifs dans EchoHub font planter le backend silencieusement
- Isolation skills MCP : discord/chat devrait bypasser les MCP servers actifs

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| parseInt(url.port) obligatoire | url.port = string en JS Web URL API, http.request ignore silencieusement | 2026-05-23 |
| generate() au lieu de generate_with_tools | generate_with_tools signature incompatible vLLM | 2026-05-23 |
| yield discord_error event au lieu de return silencieux | Exception backend invisible = "(no response)" indébuggable | 2026-05-23 |
| interaction.update() pour menu | deferUpdate + channel.send = double message Discord | 2026-05-23 |
| showMenuViaUpdate dans discord-embed-helpers.ts | Extraction pour maintenir discord-dm-bot.ts sous 500L | 2026-05-23 |

## Contexte non-évident

- **url.port string** : CRITIQUE. En JavaScript, `new URL("http://localhost:37821").port` retourne `"37821"` (string, pas number). Le module `http` de Node/Bun accepte `port: string | number` dans les types TypeScript mais **ignore silencieusement** la valeur string et utilise le port par défaut (80). Toujours `parseInt(url.port)` pour tout appel `http.request`. Ce bug s'applique aussi à `discord-api-helpers.ts` (apiGet/apiPost).

- **Skills MCP actifs = discord/chat planté** : Quand des skills MCP tournent dans EchoHub, ils injectent des tools et awareness dans les requêtes d'inférence. `engine_router.generate()` peut lever une exception si le contexte devient trop large ou incompatible. La fix actuelle yield une erreur explicite, mais l'isolation propre (discord/chat ignore les MCP actifs) reste à faire.

- **generate_with_tools vLLM** : `engine_router.generate_with_tools(tools: list[dict], ...)` attend les définitions d'outils, pas `enabled_tools: list[str]`. Le sous-agent session 27 avait utilisé la mauvaise signature → stream vide sans erreur.

- **vLLM venv 0.21.0** : Créé avec Python 3.14 (bug). Recréer via Settings → Engines si nécessaire.

- **web_search Discord** : Fonctionne uniquement si GGUF chargé (llama.cpp supporte les tools XML inline). Avec vLLM, pas de tool calling XML. Solution propre : détecter `engine_router.get_active_engine()` côté backend et brancher `/inference/tool-chat` si llama, `generate()` si vLLM.

## Prochaines étapes

1. **Isolation MCP dans discord/chat** — discord/chat ne doit pas hériter des MCP servers actifs
2. **web_search conditionnel** — GGUF → tool-chat avec web_search, vLLM → generate() sans tools
3. **Scoring qualité algorithmique dans benchmarks** (P0 reporté depuis session 25)
4. **RAG natif projets** — PDF/DOCX/MD drag-drop, ChromaDB par projet
5. **Remote Access** — Cloudflare Tunnel + Telegram

## Points en suspens

- web_search non intégré Discord (voir contexte non-évident)
- Isolation skills MCP dans discord/chat
- vLLM venv 0.21.0 : vérifier `/home/trinity/.local/share/echohub/vllm-envs/0.21.0/bin/pip show vllm`
- Fix TS pré-existant `App.tsx:354` (non bloquant)
- `chroma_data/` à la racine — à supprimer ou gitignore

## Historique

### Session 27 (2026-05-23) — Discord connector
Discord connector complet end-to-end. Bot discord.js (Bun) 4 fichiers. Conversations EchoHub partagées. State machine idle/chatting/menu/conv_list. Boutons contextuels partout. Profils de chat. strip think/tool_call. Error propagation. Nombreux fixes d'interactions Discord (Partials, emojis invalides, interaction.update vs deferUpdate).

### Session 26 (2026-05-22)
invoke_agent streaming end-to-end (agent_runner.py async generator). _parse_tool_call_json regex fallback 3 niveaux. Conversations projets sauvegardées tous modes. Archive conversations projets. Auto-scroll toggle animé. ReAct framework natif. hljs live streaming code.

### Sessions 18-25 (2026-05-20 à 2026-05-22)
Projects system (Dev/Docs/Research). Tool use streaming interleaved. Auto-compact 98%. Skills/MCP system. Notifications. Awareness conditionnelle. invoke_agent chaîne complète.

### Sessions 13-17 (2026-05-19)
Fine-tuning pipeline Unsloth QLoRA. GGUF export. Vision llama.cpp. MTP detection. KV cache Q8_0. Reload model. Wayland clipboard.

### Sessions 1-12 (2026-05-15 à 2026-05-17)
Scaffolding complet. vLLM + llama.cpp dual engine. Multi-venv vLLM. Tauri v2 migration. Installer. Benchmarks qualité. Discover multi-filtres.
