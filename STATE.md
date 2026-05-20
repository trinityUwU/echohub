# STATE — EchoHub
*Dernière mise à jour : 2026-05-20 (session 18)*

## Résumé de l'état actuel

Application Tauri v2 native complète. Session 18 = Projects system complet (hub, workspaces, profils scopés), Dev mode avec tool use filesystem, conversations projets persistées SQLite, KV cache sélectionnable dans LoadModal, streaming tool calls réel. Bugs actifs : raw `<tool_call>` visible dans le chat, loop list_files après create_file, footer stats absent en Dev mode.

## Ce qui a été fait — session 18 (2026-05-20)

### Projects system
- `useChatMode` : ChatView/ProjectMode, activeProject, openProject/closeProject
- `useProjects` : CRUD projets localStorage (name, mode, description, archived)
- `ProjectsHub` : grille, filtres All/Dev/Docs/Research/Archived, create inline, context menu, search
- `ProjectsPanel` : panneau gauche 260px collapsible, animé
- `ProjectWorkspace` : composant isolé `key={project.id}`, useProfiles scopé par projet
- `useProfiles` scope : builtins Dev (Dev/Debug/Code Review), Docs (Writer/Summarizer/Translator), Research (Analyst/Brainstorm/Fact-check)
- Topbar full-width, sidebars dessous, PanelWrapper collapsible gauche+droite
- GPU section pinned bottom ConvSidebar (h-full fix)

### Dev mode — Tool use
- `tool_service.py` : create_file, read_file, list_files, delete_file, edit_file (run_command supprimé)
- `llama_service.generate_with_tools` : streaming réel (stream=True), accumulation tool_calls deltas
- `/inference/tool-chat` : boucle agentique SSE, parse `<tool_call>` texte, anti-loop, done toujours émis
- `useToolChat` : hook + tool calls + workspace files + persistence + clearAndResend
- `DevPanel` : arborescence, tool calls section, file viewer modal (eye+delete au hover, copy)
- GET/DELETE `/projects/{id}/workspace-files/{path}` + poll 2s temps réel
- `MessageRow.ToolCallRow` : bloc animé spinner/checkmark, jaune/vert

### Conversations projets
- DB tables `project_conversations` + `project_messages` (migration auto)
- Router `/projects/{id}/conversations` CRUD + messages
- `useProjectConversations` + `ProjectConvSidebar` (identique ConvSidebar : 240px, GPU, context menu)

### KV cache
- LoadModal : sélecteur Q8_0/Q4_0/BF16, VRAM preview temps réel
- `llama_service` : type_k/type_v dynamique
- Résultat validé : Qwen3.5-9B à 131K ctx en 9.4GB VRAM avec Q4_0 ✅

### Autres fixes session 18
- GGUF detection LoadModal élargie (Q4/Q5/Q6/Q8/IQ/i1/i2 dans name+id+arch_tag)
- Tools detection : familles qwen2.5/qwen3/llama-3.1+/mistral/mixtral tool-capable
- Discover filtre Tools : 3 passes HF (tool-calling/function-calling/tool-use)
- Badge tools dans ModelCard + ModelPickerModal
- max_tokens slider scale avec max_context_window
- MoE VRAM guard : GGML_CUDA_ENABLE_UNIFIED_MEMORY + split_mode=LAYER + n_gpu_layers dynamique
- KV Q8_0 par défaut
- Logs panel dans projets (œil toggle)
- Regen/edit Dev mode : clearAndResend (plus d'empilement)
- Arrow-up send icon
- docs/v0.7-projects-workspace.md + README mis à jour

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| run_command supprimé Dev mode | Modèles locaux instables → risque destruction données | 2026-05-20 |
| KV Q8_0 par défaut | Standard LM Studio/Ollama, 50% VRAM KV | 2026-05-20 |
| stream=True pour generate_with_tools | Streaming natif disponible llama-cpp-python | 2026-05-20 |
| Tool calls texte streamés sans filtrage | Chris veut tout voir en live | 2026-05-20 |
| Anti-loop tool calls | Modèle boucle sur list_files après create_file | 2026-05-20 |

## Contexte non-évident

- Qwen3.5-9B-Claude-Opus émet tool calls en texte `<tool_call>{JSON}</tool_call>` (pas structured output natif) → parsing regex obligatoire dans le backend
- Ce modèle refuse parfois des requêtes code complexe (héritage restrictions Claude)
- Workspace projets : `~/.local/share/echohub/projects/{project_id}/workspace/`
- Python 3.11 : f-string avec backslash interdit → variable intermédiaire obligatoire
- GGML_CUDA_ENABLE_UNIFIED_MEMORY=1 = clé pour MoE 35B sur 12GB (experts spillent en RAM)
- MoE lent sur 12GB : experts non actifs en RAM, fetched via PCIe à chaque token
- Best choix code sur 12GB : Qwen2.5-Coder-14B Q4_K_M (~9.5GB avec KV Q8_0 32K)

## Bugs actifs (à corriger session 19)

1. **Raw `<tool_call>` visible** : le JSON du tool call s'affiche en plain text dans le message assistant. Besoin d'un rendu inline formaté (pas suppression — Chris veut tout streamer)
2. **list_files loop** : après create_file, modèle appelle list_files en boucle → anti-loop stoppe mais "Max iterations reached" ugly. Fix : injection système "summarize what you did" après tool results
3. **Footer stats absent Dev mode** : pas de tok/s dans les messages, `useToolChat` ne retourne pas `stats`
4. **Context bar statique Dev mode** : `usedTokens = 0` hardcodé pour isDevMode

## Prochaines étapes

1. Fix loop list_files : prompt injection post-tools "now respond with a summary"
2. Footer stats Dev mode : estimation tokens depuis len(content)/4
3. Rendu tool calls inline : bloc formaté dans le flux (pas JSON brut)
4. Tester Qwen2.5-Coder-14B Q4_K_M pour Dev mode
5. Reddit karma : objectif 200 avant ~28 juin, 1-2/jour r/LocalLLaMA

## Historique

### Session 17 (2026-05-19)
MTP detection binaire GGUF, vision llama.cpp, badges capabilities, reload model footer, clipboard Wayland, vLLM fixes, lightbox, skills Claude Code.

### Sessions 13-16 (2026-05-19)
Fine-tuning Unsloth QLoRA end-to-end, pipeline resume-safe, export GGUF, eval before/after, MoE support, llama-cpp-python Settings/Engines.

### Sessions 1-12 (2026-05-15 à 2026-05-17)
Architecture dual-engine, multi-venv vLLM, benchmarks quality scoring, installer App, système MAJ, Discover multi-filtres, UX polish.
