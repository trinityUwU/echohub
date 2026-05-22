# STATE — EchoHub
*Dernière mise à jour : 2026-05-22 (session 26)*

## Résumé de l'état actuel

Application Tauri v2 stable. **Session 26 = gros chantier streaming invoke_agent résolu end-to-end.** Le sous-agent streame maintenant chaque token en temps réel dans l'UI. Les `<tool_call>` JSON tronqués par le modèle GGUF sont parsés par regex robuste. Les conversations projets (Research/Docs) sont sauvegardées et archivables. Le code `create_file`/`edit_file` s'affiche avec syntax highlighting live. L'auto-scroll est contrôlable pendant la génération. vLLM doit tourner sur Python 3.11 (venv 0.21.0 à recréer si créé avec 3.14).

## Ce qui a été fait — session 26 (2026-05-22)

### invoke_agent streaming — résolu complètement

- **backend/services/agent_runner.py** (nouveau) : async generator remplace ThreadPoolExecutor+Queue+callback synchrone. Utilise `generate_with_tools()` directement → chaque token stream immédiatement.
- **Nouveaux event types SSE** : `agent_text_chunk`, `agent_thinking_chunk`, `agent_thinking_end`, `agent_tool_start`, `agent_tool_done`, `agent_done`, `agent_error`
- **Format SSE** : `{"type": "agent_step", "step": {...}}` — clé `step` porte l'event réel (fix bug écrasement `type`)
- **ChatPage.tsx** : `toolCalls = toolChatHook.toolCalls` pour tous les modes projets (plus seulement `dev`)
- **agentStepsMap** keyed par `"invoke_agent:N"` (index occurrence) — chaque bloc reçoit ses propres steps, plus de duplication

### _parse_tool_call_json — fix critique inference.py

Modèle GGUF (Qwen3) tronque les JSON à ~1499 chars et émet `</tool_call>` prématurément. Solution en 3 niveaux :
1. `json.loads` direct (JSON complet)
2. `_sanitize_json_strings()` — remplace newlines réels dans strings JSON
3. `_extract_tool_call_fields()` — regex fallback qui extrait `name`/`harness`/`task` même sur JSON incomplet

### Conversations projets — archive support complet

- `conversation_manager.py` : champ `archived` dans `create_project_conversation`, `archive_project_conversation()`, `list_project_conversations(archived=)` filtré
- `projects.py` : endpoints `PATCH /{id}/conversations/{cid}/archive` + `/unarchive`
- `useProjectConversations.ts` : `archivedConversations` séparé, `archiveConversation`/`unarchiveConversation`
- `ChatPage.tsx` : guard `isDevOnlyMode` supprimé sur load/save messages → tous les modes sauvegardent
- `ProjectConvSidebar` : onglets Active/Archived avec compteurs, hover archive/unarchive button, context menu

### UI — streaming & affichage améliorés

- **ToolBlocks.tsx + ToolCallBody.tsx** (extraction pour normes 500L) :
  - `InvokeAgentPanel` : brief collapsible live (s'ouvre pendant écriture, se replie à l'exécution), `AgentLivePanel` (thinking ambré, tokens live, timeline milestones sans doublon)
  - Filtre `<tool_call>` dans `liveText` du sous-agent
  - `ToolCallBody` : `create_file`/`edit_file` avec header fichier + syntax highlighting hljs live
  - Extraction regex `path`/`content` sur JSON partiel (streaming)
- **MessageContent.tsx** :
  - Détecte `</think>` orphan (Qwen3 sans `<think>` ouvrant) → tout le texte précédent en ThinkingBlock collapsé
  - Strip `</tool_call>` orphelins entre blocs
- **Auto-scroll** :
  - Bouton toggle pill animé (Framer Motion) visible pendant streaming uniquement
  - `AutoScrollContext` React propagé depuis `ChatContent` → `ThinkingBlock`, `ToolCallBody`
  - `useScrollToBottom()` hook — scroll interne aux conteneurs (code, thinking)
  - Scroll up manuel → désactive auto-scroll automatiquement
  - Streaming restart → reset à ON
- **useToolChat.ts** : throttle 50ms déclaré hors de la boucle `for await` (correction — était réinitialisé à chaque event)

### ReAct prompt engineering natif

- `_SUB_AGENT_SYSTEM` : framework ReAct (Thought→Action→Observation), 10 tool calls max, contraintes anti-loop, JSON réel obligatoire
- `_RESEARCH_SYSTEM_PROMPT` : brief structuré GOAL/TOOLS/CONSTRAINTS/APPROACH imposé à l'orchestrateur Research

### Infrastructure

- `start.sh` : vide `__pycache__` + reset `logs/backend.log` à chaque lancement
- `lib.rs` (Tauri) : `find_python()` dynamique (venv `.venv` → `python3.11` → `python3`), clear `__pycache__` au spawn attempt 0
- `backend/main.py` : `started_at` dans `/health` → App.tsx poll 5s, refresh état modèle + toast si restart détecté
- `vllm_manager.py` : force `python3.11` (via `shutil.which`) pour création des nouveaux venvs vLLM

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| async generator pour sous-agent (agent_runner.py) | ThreadPoolExecutor bloquait tout jusqu'à la fin — zéro streaming possible | 2026-05-22 |
| _parse_tool_call_json regex fallback à 3 niveaux | GGUF Qwen3 tronque JSON à ~1499 chars → fatal sans fallback | 2026-05-22 |
| agentStepsMap keyed "invoke_agent:N" | Plusieurs invoke_agent dans une réponse partageaient les mêmes steps | 2026-05-22 |
| AutoScrollContext React context | Évite prop drilling ChatContent → ThinkingBlock/ToolCallBody (5+ niveaux) | 2026-05-22 |
| force python3.11 pour venv vLLM | python3 système = 3.14 sur Arch, incompatible vLLM 0.21.0 (crashes FrameSummary) | 2026-05-22 |
| hljs highlighting live pendant streaming | JSON partiel extrait par regex → rawCode disponible dès premiers tokens | 2026-05-22 |

## Contexte non-évident

- **vLLM venv 0.21.0 existant** : créé avec Python 3.14 (bug). Recréer : Settings → Engines → delete 0.21.0 → reinstall. Le fix est dans `vllm_manager.py` pour les prochaines installations. Réinstallation en cours en background à l'arrêt de la session 26.
- **_parse_tool_call_json** : seulement sur path XML (`<tool_call>`). Path natif (response tool_calls) a son propre fix `.replace('\n', '\\n')`.
- **agent_runner.py + _generation_lock** : l'orchestrateur relâche le lock via `stop_event.set()` AVANT d'appeler `_execute_tool_with_intercept` → le sous-agent peut appeler `generate_with_tools()` sans deadlock.
- **`</think>` orphan parsing** : Qwen3 émet parfois pensée sans `<think>` ouvrant. `parseSegments` dans `MessageContent` détecte `</think>` seul → tout le buffer précédent → ThinkingBlock.
- **Hooks React Rules** : `useScrollToBottom` dans `ToolCallBody` doit être au top level (avant tout `return` conditionnel). Bug corrigé en session (Fewer hooks than expected).
- **vLLM modèle AWQ incomplet** : `casperhansen/deepseek-r1-distill-qwen-7b-awq` — seules métadonnées téléchargées (132K total). Poids manquants. Re-télécharger depuis Library.

## Prochaines étapes

1. Vérifier que réinstallation vLLM 0.21.0 est terminée : `pip show vllm` dans le venv 3.11
2. Re-télécharger DeepSeek R1 AWQ 7B (poids manquants)
3. Scoring qualité algorithmique dans benchmarks (P0 reporté depuis session 25)
4. RAG natif projets (P1)
5. Remote Access Cloudflare + Telegram (P1)

## Points en suspens

- vLLM venv 0.21.0 : réinstallation python3.11 en cours en background — vérifier avec `/home/trinity/.local/share/echohub/vllm-envs/0.21.0/bin/pip show vllm`
- Fix TS pré-existant `App.tsx:354` (LoadConfig kvQuant null mismatch) — non bloquant
- `chroma.sqlite3` à la racine — fichier parasite à supprimer

## Historique

### Session 25 (2026-05-22)
Docs/Research panels fonctionnels (DB, endpoints, frontend drag-drop). invoke_agent chaîne complète réparée (SIGSEGV→deadlock→XML parsing). Streaming backend implémenté mais steps non visibles dans ToolCallBlock — bug drain timing.

### Sessions 18-24 (2026-05-20 à 2026-05-22)
Projects system (Dev/Docs/Research). Tool use streaming interleaved (stop_event, detect `</tool_call>` mid-stream). Auto-compact 98%. Set_tool_limit. Scrapling (web_search/fetch_url). Slash commands. Skills/MCP system. Notifications. Awareness conditionnelle.

### Sessions 13-17 (2026-05-19)
Fine-tuning pipeline Unsloth QLoRA. GGUF export. Eval before/after. Vision llama.cpp (mmproj, Qwen25VL/LLaVA). MTP detection. KV cache Q8_0 par défaut. Reload model depuis footer. Wayland clipboard.

### Sessions 1-12 (2026-05-15 à 2026-05-17)
Scaffolding complet. vLLM + llama.cpp dual engine. Multi-venv vLLM. Tauri v2 migration. Installer. Mise à jour système. Benchmarks qualité. Discover multi-filtres.
