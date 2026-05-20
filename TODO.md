# TODO — EchoHub
*Dernière mise à jour : 2026-05-20 (session 18)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — 1-2 commentaires/jour, sujets perfs/vLLM/GGUF/CUDA
- [ ] Rédiger post Reddit/HN avec Chris (matériel prêt — démo 100K ctx + Projects mode)

## À faire (priorité)

### Bugs Dev mode (P0)
- [ ] Fix raw `<tool_call>` visible dans le chat — rendu inline formaté sans suppression
- [ ] Fix loop list_files → injection "summarize what you did" après tool results
- [ ] Footer stats Dev mode : tok/s dans messages (useToolChat → stats estimation)
- [ ] Context bar Dev mode : usedTokens estimation (len/4)

### Lancement (P1)
- [ ] Finaliser posts avec Chris (docs/private/posts-drafts.md) — /humanizer obligatoire
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)
- [ ] Objectif karma : 200 commentaires (~28 juin 2026)

### Dev mode — améliorations (P1)
- [ ] Tester Qwen2.5-Coder-14B Q4_K_M pour Dev mode (tool calling natif probable)
- [ ] run_tsc / run_python_check outils dans tool_service (vérification code généré)
- [ ] Scoring qualité Dev mode : compilation OK, présence éléments attendus

### Fine-tuning — stabilisation (P2)
- [ ] Upgrader llama-cpp-python → tester chargement GGUFs fine-tunés dans Chat
- [ ] Vérifier eval after persiste bien en DB après restart

### Vision / MTP (P2)
- [ ] Valider gain MTP mesuré dans EchoHub
- [ ] Tester vision GGUF complet (bartowski/Qwen2-VL-7B-Instruct-GGUF avec mmproj)
- [ ] Téléchargement automatique mmproj dans download flow si modèle vision détecté

### Bugs (P2)
- [ ] Fix indicateur `~` après fin de stream (race condition liveTokens/streaming)
- [ ] OOM kernel SIGKILL non détectable — watchdog process

### Nettoyage (P2)
- [ ] Supprimer vieux composants héritage (ChatPanel.tsx, LoadConfigModal.tsx, etc.)

### Packaging (P2)
- [ ] Valider .AppImage (linuxdeploy requis)
- [ ] Valider .deb

## Backlog
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux (Phase 2)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Modèle juge fiable (après fine-tuning + évaluation itérative)
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune)
- [ ] Multi-GPU support vLLM
- [ ] Support import dataset JSONL/ShareGPT/Alpaca dans Profiles
- [ ] Docs mode : drag & drop fichiers pour injection contexte
- [ ] Research mode : ajout sources URL
- [ ] Tool calling natif vLLM dans generate_with_tools

## Terminé ✅ (session 18 — 2026-05-20)
- [x] Projects system complet : hub, workspaces, profils scopés, sidebar conversations
- [x] Dev mode tool use : create_file, read_file, list_files, delete_file, edit_file
- [x] generate_with_tools streaming réel (stream=True)
- [x] Parse tool calls texte format `<tool_call>JSON</tool_call>`
- [x] Anti-loop tool calls (même tool+args 2x → break)
- [x] Conversations projets persistées SQLite
- [x] ProjectConvSidebar identique ConvSidebar (240px, GPU, context menu)
- [x] File viewer modal DevPanel (eye + delete, copy)
- [x] Workspace files poll 2s temps réel
- [x] KV cache sélecteur Q8_0/Q4_0/BF16 dans LoadModal
- [x] KV Q8_0 par défaut (type_k=8, type_v=8)
- [x] Qwen3.5-9B 131K ctx 9.4GB VRAM avec Q4_0 ✅
- [x] MoE VRAM guard : GGML_CUDA_ENABLE_UNIFIED_MEMORY + split_mode=LAYER
- [x] GGUF detection LoadModal élargie (i1/i2/IQ/Q3/Q6)
- [x] Tools badge ModelCard + ModelPickerModal
- [x] Tools detection familles (qwen2/3, llama-3.1+, mistral)
- [x] Discover filtre Tools 3 passes HF
- [x] max_tokens slider scale avec context window modèle
- [x] Logs panel projets (œil toggle)
- [x] Regen/edit Dev mode fix (clearAndResend)
- [x] Arrow-up send icon
- [x] docs/v0.7-projects-workspace.md + README mis à jour
- [x] GPU section pinned bottom ConvSidebar

## Terminé ✅ (session 17 — 2026-05-19)
- [x] MTP detection binaire GGUF + badge cyan
- [x] Vision llama.cpp : mmproj auto + chat_handler
- [x] Badges capabilities partout
- [x] Reload model footer
- [x] Clipboard Wayland
- [x] vLLM compat check + max_tokens fix
- [x] Image lightbox

## Terminé ✅ (sessions précédentes)
- [x] Fine-tuning Unsloth QLoRA, export GGUF, eval before/after
- [x] Multi-venv vLLM, benchmarks, quality scoring
- [x] Installer App natif, système MAJ, fresh install E2E
- [x] GitHub public MIT
