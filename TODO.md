# TODO — EchoHub
*Dernière mise à jour : 2026-05-20 (session 19)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — 1-2 commentaires/jour, sujets perfs/vLLM/GGUF/CUDA
- [ ] Rédiger post Reddit/HN avec Chris (matériel prêt — démo 100K ctx + Projects mode + agent Dev)

## À faire (priorité)

### Skills/Awareness system (P0 — prochaine session)
- [ ] Audit codebase : identifier points d'entrée system prompt chat normal + projets (sous-agents)
- [ ] Définir structure Skills : Web Search, Code Runner, File System, Calculator
- [ ] Toggles dans ChatSettingsSidebar + RightPanel — activables partout
- [ ] Awareness block ≤ 100 tokens par skill, injecté dynamiquement
- [ ] Chat normal bascule sur /tool-chat si skills tools activés
- [ ] Skills actifs = seuls tools exposés au modèle

### Lancement (P1)
- [ ] Finaliser posts avec Chris — /humanizer obligatoire
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)
- [ ] Objectif karma Reddit : 200 commentaires (~28 juin 2026)

### Dev mode — améliorations (P1)
- [ ] Tester Qwen2.5-Coder-14B Q4_K_M pour Dev mode (tool calling natif probable)
- [ ] Scoring qualité Dev mode : compilation OK, présence éléments attendus

### Fine-tuning (P2)
- [ ] Upgrader llama-cpp-python → tester chargement GGUFs fine-tunés dans Chat
- [ ] Vérifier eval after persiste bien en DB après restart

### Vision / MTP (P2)
- [ ] Valider gain MTP mesuré dans EchoHub
- [ ] Tester vision GGUF complet (bartowski/Qwen2-VL-7B-Instruct-GGUF avec mmproj)
- [ ] Téléchargement auto mmproj si modèle vision détecté

### Bugs (P2)
- [ ] Fix indicateur `~` après fin de stream (race condition liveTokens/streaming)
- [ ] OOM kernel SIGKILL non détectable — watchdog process
- [ ] web_search DDG sélecteurs brittle — fallback si change

### Nettoyage (P2)
- [ ] Supprimer vieux composants héritage (ChatPanel.tsx, LoadConfigModal.tsx, etc.)
- [ ] run_command timeout configurable (tsc sur gros projets peut dépasser 10s)

### Packaging (P2)
- [ ] Valider .AppImage (linuxdeploy requis)
- [ ] Valider .deb

## Backlog
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux (Phase 2)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Modèle juge fiable (après fine-tuning + évaluation itérative)
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune)
- [ ] Multi-GPU support vLLM
- [ ] Docs mode : drag & drop fichiers pour injection contexte
- [ ] Research mode : ajout sources URL
- [ ] Tool calling natif vLLM dans generate_with_tools
- [ ] Scrapling MCP server natif (alternative aux tools custom)

## Terminé ✅ (session 19 — 2026-05-20)
- [x] Streaming interleaved tool execution (stop_event, mid-stream tool call)
- [x] Parser MessageContent à état (think/tool_call/tool_result imbriqués)
- [x] ToolCallBlock streaming live JSON + style ThinkingBlock
- [x] Auto-compact 98% (usedTokensRef source de vérité, display séparé historyToSend)
- [x] set_tool_limit tool (modèle lève sa propre limite)
- [x] run_command + get_workspace_info + fetch_url + web_search
- [x] read_file numéros de ligne + plage
- [x] edit_file mode ligne + diagnostic échec
- [x] Slash commands /clear /compact /tokens /model /files /limit
- [x] Auto-focus textarea sur keypress global
- [x] Permanent Rules UI
- [x] capabilities détectées au load modèle
- [x] projectId fix DevPanel
- [x] Context bar sync tool_call_streaming

## Terminé ✅ (session 18 — 2026-05-20 matin)
- [x] Projects system complet : hub, workspaces, profils scopés, sidebar conversations
- [x] Dev mode tool use : create_file, read_file, list_files, delete_file, edit_file
- [x] generate_with_tools streaming réel (stream=True)
- [x] KV cache sélectionnable LoadModal (Q8_0/Q4_0/BF16)
- [x] MoE VRAM guard + GGML_CUDA_ENABLE_UNIFIED_MEMORY
