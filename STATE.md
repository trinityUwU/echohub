# STATE — EchoHub
*Dernière mise à jour : 2026-05-20 (session 21)*

## Résumé de l'état actuel

Application Tauri v2 native stable. Sessions 20+21 = système Skills/MCP complet avec
support stdio (Python + Node), pipeline d'installation automatique depuis GitHub,
agent loop production-grade (context budget, synthesis on cap, timeout MCP). Profils
de chat réécrits avec vrais prompts. Persistance messages MCP fixée. Frontend animé.

## Ce qui a été fait — session 21 (2026-05-20)

### MCP stdio transport (chantier principal)
- `mcp_stdio_client.py` — nouveau module McpStdioClient, pool singleton, JSON-RPC 2.0 over stdin/stdout
- Buffer readline 8MB (défaut 64KB causait "chunk is longer than limit" sur gros résultats)
- Timeout 120s par call (paper-search-mcp prend ~55s pour multi-source)
- `mcp_client.py` — routing http vs stdio selon colonne transport en DB
- `mcp_manager._start_stdio()` — lifecycle stdio, skip health check HTTP
- Patch python/python3 → backend venv (ou skill venv si `.venv` présent)
- Testé : paper-search-mcp (57 tools), mcp-fetch-server (6 tools)

### Pipeline install automatique complet
- Venv isolé par skill Python : `python3 -m venv .venv` + `pip install -e .` dans le skill dir
- `detect_mcp_server()` section 0 : smithery.yaml (uvx/npx/node → stdio auto)
- Détection `StdioServerTransport` dans source TS/JS → transport stdio correct pour Node MCP
- Monorepos (workspaces field) → return None, évite le bug `--workspaces` en boucle
- `mcp_transport` manquant au start → re-détection automatique + patch registry.json local + global
- `_patch_skill_registry_json()` dans skills_helpers — sync idempotent

### Agent inference fixes
- Context budget dans chaque tool result : `[Context: X/Y tokens (Z%)]`
- Warning à 75% : stop research maintenant. Hard stop à 92% : calls bloqués
- Synthesis on tool cap : au lieu de couper, inject user message "synthesize now" → réponse finale complète
- Cap warning à N-2 : maintenant dit explicitement "call set_tool_limit NOW"
- Timeout 60s sur `call_mcp_tool()` dans inference — plus de deadlock LLM

### Persistance messages MCP
- Bug : `skillChatHook` n'avait pas de `onSaveMessage` → messages MCP jamais écrits en DB
- Fix : `onSaveMessage` wrappant `addMessage()` passé à skillChatHook
- Historique conversations avec tool calls maintenant persistent entre sessions

### Frontend
- Context bar projets : `usedTokens` estimé depuis l'historique au chargement (était 0 hardcodé)
- Déduplication messages : `deduplicateMessages()` dans loadHistory + send()
- Tool call blocks animés : ouvert pendant exécution (spinner), fermé par défaut une fois done
- Framer Motion height animation, design tokens bg-surface border-white/5

### Profils chat
- `useProfiles.ts` CHAT_BUILTINS réécrit : 5 profils (Default/Precise/Creative/Balanced/Coder)
- Chacun avec systemPrompt + permanentRules + règle langue mirroring en #1
- localStorage toujours remplacé pour locked IDs → upgrade automatique sans migration

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| stdio transport via subprocess asyncio | HTTP incompatible avec mcp package standard | 2026-05-20 |
| Venv isolé par skill Python | Conflits de dépendances entre skills | 2026-05-20 |
| Buffer readline 8MB | paper-search-mcp retourne 200-500KB par search | 2026-05-20 |
| Timeout 120s stdio | Tools réseau légitimement lents (~55s multi-source) | 2026-05-20 |
| Synthesis au lieu de cut sur cap | Réponse partielle = inutilisable, synthèse = valeur | 2026-05-20 |
| Hard stop 92% contexte | Laisser 8% pour la réponse finale | 2026-05-20 |
| Language mirroring rule #1 | Comportement par défaut Qwen3 = répondre en anglais | 2026-05-20 |

## Contexte non-évident

- `CHAT_BUILTINS` est dans `useProfiles.ts`, pas dans `ChatSettingsSidebar.tsx` (qui existe mais n'est pas utilisé pour le panel Profile de ChatPage)
- Clé localStorage profiles : `echohub:profiles` (avec deux-points, pas underscore)
- paper-search-mcp installé dans backend venv (httpx disponible), mais skill venv créé à la prochaine réinstall
- `StdioServerTransport` dans le source TS = marqueur définitif de transport stdio pour Node MCP
- Monorepos (workspaces dans package.json) : `detect_mcp_server` retourne None — pas installable à la racine
- inference.py : `_model_status.max_context_window` peut être None sur llama → fallback 4096
- `skillChatHook` en mode skill = `useToolChat('__skills__')` — endpoint `/conversations/:id/messages` (pas `/projects/`)

## Prochaines étapes (session 22)

1. **Types de projets Dev/Docs/Research** — layouts fonctionnels (P0)
   - Dev : arborescence fichiers réelle + IDE-like
   - Docs : injection contexte fichiers drag & drop
   - Research : gestion sources URL/documents
2. **RAG natif dans les projets** (dépend des types de projets)
   - PDF, DOCX, PPTX, XLSX, MD, CSV, JSON
   - ChromaDB par projet, retrieval injecté dans contexte
3. **Logs MCP** dans la card skill (petit, utile debug)
4. **Scoring qualité benchmarks** — algo sans LLM juge

## Points en suspens

- `params` pas mis à jour si profil changé avant reload app → workaround : resélectionner le profil
- web_search DDG sélecteurs brittle — fallback si DDG change layout
- OOM kernel SIGKILL non détectable — watchdog process (backlog)

## Historique

### Session 20 (2026-05-20)
Skills/MCP system complet : native skills (Web Search, Code Runner, File System, Calculator),
community skills installables depuis GitHub, toggles UI, awareness blocks injectés dans system prompt,
MCP HTTP fonctionnel, notifications SSE, modularisation backend.

### Session 19 (2026-05-20)
Streaming interleaved tool execution, parser MessageContent à état (think/tool_call/tool_result),
auto-compact 98%, set_tool_limit tool, fetch_url + web_search via Scrapling, slash commands,
auto-focus textarea, Permanent Rules UI, capabilities détectées au load.

### Session 18 (2026-05-20 matin)
Projects system complet : hub, workspaces, profils scopés, sidebar conversations.
Dev mode tool use. generate_with_tools streaming réel. KV cache sélectionnable. MoE VRAM guard.

### Sessions 1-17
Fondations (dual-engine inference, VRAM management, model discovery), multi-vLLM,
benchmark suite, fine-tuning QLoRA complet, MTP support, vision GGUF.
