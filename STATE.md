# STATE — EchoHub
*Dernière mise à jour : 2026-05-20 (session 19)*

## Résumé de l'état actuel

Application Tauri v2 native stable. Session 19 = refonte complète du streaming Dev mode (interleaved tool execution, think/tool parser, live JSON streaming), auto-compact 98%, slash commands input, Skills/Awareness system décidé et prêt à implémenter, web search via Scrapling intégré. Application en état stable.

## Ce qui a été fait — session 19 (2026-05-20)

### Streaming interleaved tool execution
- Backend : détection `</tool_call>` token-par-token, stop_event threading → exécution outil immédiate mid-stream, reprise génération
- `llama_service.generate_with_tools` : paramètre `stop_event: threading.Event` pour interruption propre
- Plus de GIF pendant tool use — tout stream en live
- `tool_call_streaming` SSE event : JSON généré token par token visible dans ToolCallBlock

### Parser MessageContent à état
- Parser complet `<think>/<tool_call>/<tool_result>` avec tracking `inThink` context
- Texte inter-tools dans `<think>` = thinking (pas texte visible)
- Orphan `</think>` (Qwen3) → tout le préfixe = thinking
- `ToolCallBlock` toujours ouvert pendant streaming (force open = streaming)
- Style identique ThinkingBlock : jaune pour tool_call, vert pour tool_result

### Auto-compact 98%
- `useToolChat` : compaction déclenchée via `usedTokensRef` (source de vérité) à 98% du contexte
- Animation inline "Compacting…" → "Context compacted" sans modifier messages visibles
- `compactedSummaryRef` injecté dans `historyToSend` seulement, display intact
- `compact()` exposé dans UseToolChatReturn, accessible via /compact

### Cap tool calls dynamique
- `set_tool_limit(new_limit, reason)` : modèle peut lever sa propre limite (max 300)
- Warning injecté à J-2 avant cap, reset à chaque nouvelle limite
- Cap initial 60 (était 6), MAX_ITERATIONS 40

### Tools Dev mode enrichis
- `run_command` whitelist : node, python3, tsc, eslint, jshint, deno
- `get_workspace_info` : path absolu + métadonnées
- `set_tool_limit` : modèle lève sa propre limite
- `fetch_url` + `web_search` via Scrapling (backend venv, testés OK)
- `read_file` : numéros de ligne + plage start_line/end_line
- `edit_file` : mode ligne (start_line/end_line/new_content) + diagnostic échec

### UX/Input
- Slash commands : /clear /compact /tokens /model /files /limit — menu popup animé
- Auto-focus textarea sur keypress global
- Permanent Rules UI dans ChatSettingsSidebar
- Placeholder : "Message… · type / for commands"

### Fixes
- `capabilities` détectées au load modèle (llama_service → _detect_capabilities)
- `projectId=""` hardcodé dans DevPanel → fix lecture/suppression fichiers
- Context bar sync en temps réel (text_chunk ET tool_call_streaming)
- Dev system prompt toujours préfixé, inviolable
- Auto-compact trigger via usedTokensRef (messagesRef manquait les tool_results inline)

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| Skills/Awareness system | Trop de tools surchargent un 9B — awareness court (≤100 tokens) par skill activé | 2026-05-20 |
| fetch_url + web_search via Scrapling | Lib déjà clonée /mnt/projects, anti-bot, testée OK venv backend | 2026-05-20 |
| set_tool_limit côté modèle | Boucle légitime ≠ boucle erreur — modèle lève = intention valide | 2026-05-20 |
| read_file numéros de ligne | edit_file échouait sur whitespace — numéros = édition fiable | 2026-05-20 |
| display/historyToSend séparés dans compact | Messages visibles ne doivent jamais disparaître | 2026-05-20 |
| usedTokensRef pour trigger compact | messagesRef sous-estime (manque tool_results inline) | 2026-05-20 |

## Contexte non-évident

- Scrapling installé `backend/.venv` via `pip install scrapling[all]` — curl_cffi requis
- `web_search` utilise DuckDuckGo HTML — pas d'API key, sélecteurs `.result` (brittle si DDG change)
- `stop_event.set()` coupe le stream llama proprement après chunk en cours
- System prompt Dev : `_DEV_SYSTEM_PROMPT` toujours préfixé, user en ADDITIONAL INSTRUCTIONS
- Slash commands exécutées côté client, jamais envoyées au modèle
- Auto-compact non testé en conditions réelles (session < 98% du contexte)

## Prochaines étapes (session 20)

1. **Skills/Awareness system** (priorité absolue)
   - Skills : Web Search, Code Runner, File System, Calculator
   - Toggles panneau droit — activables partout (chat normal + projets)
   - Awareness ≤ 100 tokens par skill injecté dynamiquement dans system prompt
   - Seuls les tools des skills actifs exposés au modèle
   - Chat normal bascule sur /tool-chat si skills tools activés
   - Audit codebase préalable avec sous-agents

2. **Push + release notes**

## Points en suspens

- run_command timeout 10s peut être court pour tsc sur gros projets
- web_search DDG : sélecteurs CSS peuvent changer

## Historique

### Session 18 (2026-05-20 matin)
Projects system complet, Dev mode tool use filesystem, conversations SQLite, KV cache sélectionnable, streaming tool calls réel.

### Sessions 13-17 (2026-05-19)
Fine-tune pipeline complet (Unsloth QLoRA), export GGUF, vision llama.cpp, MTP detection, reload model footer, Wayland clipboard.

### Sessions 1-12 (2026-05-15 à 2026-05-18)
Foundation → multi-venv vLLM → UX polish → benchmarks → fresh install → installer Tauri → update system → context management.
