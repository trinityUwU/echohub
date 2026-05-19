# TODO — EchoHub
*Dernière mise à jour : 2026-05-19 (session 17)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — 1-2 commentaires/jour, sujets perfs/vLLM/GGUF/CUDA
- [ ] Rédiger post Reddit/HN avec Chris (matériel prêt — démo 100K ctx validée)

## À faire (priorité)

### Lancement (P1)
- [ ] Finaliser posts avec Chris (docs/private/posts-drafts.md) — passer par /humanizer obligatoire
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)
- [ ] Objectif karma avant lancement : 200 commentaires (~28 juin 2026)

### Fine-tuning — stabilisation (P1)
- [ ] Upgrader llama-cpp-python → Settings/Engines → tester chargement GGUFs fine-tunés dans Chat
- [ ] Vérifier eval after persiste bien en DB après restart (pipeline_stage=eval_after → score_avg stocké)

### Vision / MTP (P2)
- [ ] Valider gain MTP mesuré dans EchoHub (baseline vs MTP activé sur Qwen3 GGUF avec nextn tensors)
- [ ] Tester vision GGUF complet : télécharger bartowski/Qwen2-VL-7B-Instruct-GGUF (inclut mmproj)
- [ ] Ajouter téléchargement automatique du mmproj dans le download flow si modèle vision détecté

### Bugs (P2)
- [ ] Fix indicateur `~` qui reste affiché après fin de stream (race condition liveTokens/streaming)
- [ ] OOM kernel SIGKILL non détectable — envisager watchdog process

### Nettoyage (P2)
- [ ] Supprimer vieux composants héritage : `src/components/ChatPanel.tsx`, `LoadConfigModal.tsx`, etc.

### Packaging (P2)
- [ ] Valider `.AppImage` (linuxdeploy requis)
- [ ] Valider `.deb`

## Backlog
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux (Phase 2)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Modèle juge fiable (après fine-tuning + évaluation itérative)
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune)
- [ ] Multi-GPU support vLLM (tensor_parallel_size)
- [ ] Support import dataset JSONL/ShareGPT/Alpaca dans Profiles
- [ ] Benchmark qualité : profil Tool call, retirer quality score sur Throughput

## Terminé ✅ (session 17 — 2026-05-19)
- [x] Skills Claude Code : /humanizer + /prompt-architect installés + règles session-awareness
- [x] Docs humanisées (README, v0.1-v0.4) — suppression patterns AI
- [x] MTP : detect_mtp() binaire GGUF, badge cyan partout, export fine-tune rapporte MTP
- [x] Vision llama.cpp : find_mmproj() + detect_vision_handler() + chat_handler au chargement
- [x] Strip image_url pour modèles sans vision (évite réponse vide)
- [x] Vision badge ground truth = mmproj présent sur disque
- [x] Fix détection vision : image-text-to-text pipeline_tag HF reconnu
- [x] Badges capabilities dans ModelPickerModal, LoadModelModal, ChatTopBar, ModelDetailPanel
- [x] Reload model depuis footer : load_config persisté par message, bouton mismatch
- [x] Clipboard Wayland : wl-paste subprocess via Tauri Rust command
- [x] vLLM compat check : subprocess via get_default_python() (356 archs)
- [x] vLLM max_tokens overflow : clip à max_model_len - prompt_tokens
- [x] Image lightbox : clic miniature → fullscreen Framer Motion
- [x] 1 commentaire Reddit posté (llama.cpp MTP thread)
- [x] docs/v0.5-mtp.md + docs/v0.6-vision-mtp-ux.md créés
- [x] README mis à jour (v0.5 + v0.6)

## Terminé ✅ (session 16 — 2026-05-19)
- [x] Support MoE : détection is_moe, active_params_billion, badge amber Discover/Picker
- [x] LoadModelModal MoE : banner + auto-fill n_gpu_layers/cpu_overflow
- [x] llama_service MoE : n_batch=128 + no_perf=True → évite crash CUDA graph

## Terminé ✅ (sessions 13-15 — 2026-05-19)
- [x] Section Fine-tune complète, Unsloth QLoRA, export GGUF, eval before/after
- [x] Pipeline asyncio.Task indépendant, resume logic, pipeline_stage en DB
- [x] GGUFs fine-tunés dans Library + ModelPicker + delete
- [x] llama-cpp-python dans Settings → Engines
- [x] Download history persistée SQLite

## Terminé ✅ (sessions précédentes)
- [x] quality_scorer.py, benchmarks, multi-venv vLLM
- [x] InstallerApp natif, système MAJ, fresh install E2E
- [x] App Tauri native, dual-engine, SQLite, profils
- [x] GitHub public MIT : https://github.com/trinityUwU/echohub
