# TODO — EchoHub
*Dernière mise à jour : 2026-05-19 (session 13-15)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — 1-2 commentaires/jour, sujets perfs/vLLM/GGUF/CUDA
- [ ] Rédiger post Reddit/HN avec Chris (matériel prêt — démo 100K ctx validée)

## À faire (priorité)

### Fine-tuning — stabilisation (P1)
- [ ] Vérifier que eval after persiste bien en DB après restart backend (pipeline_stage=eval_after → score_avg stocké)
- [ ] Upgrader llama-cpp-python → Settings/Engines → Upgrade → tester chargement GGUFs fine-tunés dans Chat
- [ ] Fix : si eval_after seul (sans before), s'assurer que gguf_model_id n'est pas None dans le pipeline
- [ ] Test complet end-to-end : before eval → finetune → export → after eval → comparaison côte à côte

### Lancement (P1)
- [ ] Finaliser posts avec Chris (docs/private/posts-drafts.md)
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)
- [ ] Objectif karma avant lancement : 200 commentaires (~28 juin 2026)

### Fine-tuning — roadmap (P2)
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune) — après modèle juge validé
- [ ] Support import dataset JSONL/ShareGPT/Alpaca dans Profiles

### Bugs (P2)
- [ ] Fix indicateur `~` qui reste affiché après fin de stream (race condition liveTokens/streaming)
- [ ] OOM kernel SIGKILL non détectable — envisager watchdog process

### Nettoyage (P2)
- [ ] Supprimer vieux composants héritage : `src/components/ChatPanel.tsx`, `LoadConfigModal.tsx`, etc.

### Benchmark qualité (P2)
- [ ] Retirer quality score sur Throughput/Latency
- [ ] Profil "Tool call" : tester compatibilité tool calling natif

### Backend (P2)
- [ ] GPU service : tester AMD ROCm et Apple Silicon sur vrai hardware

### Packaging (P2)
- [ ] Valider `.AppImage` (linuxdeploy requis)
- [ ] Valider `.deb`

## Backlog
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux (Phase 2)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Modèle juge fiable (après fine-tuning + évaluation itérative)
- [ ] Multi-GPU support vLLM (tensor_parallel_size)
- [ ] Chat avec GGUFs fine-tunés via llama-cli si llama-cpp-python incompatible

## Terminé ✅ (sessions 13-15 — 2026-05-19)
- [x] Section Fine-tune complète : Models / Profiles / Train
- [x] Profils RLHF avec 5 builtin (Dev/Reasoning/General/Analysis/Debug)
- [x] Training Unsloth QLoRA avec hardware-aware defaults RTX 3060
- [x] Export GGUF Q4_K_M via binaires Unsloth (bypass cmake check)
- [x] Eval before/after : GGUF finder HF + llama-cli pour after eval
- [x] Pipeline asyncio.Task indépendant (résistant SSE disconnects)
- [x] Resume logic : pipeline_stage en DB, skip étapes déjà faites
- [x] GGUFs fine-tunés dans Library (toggle ft/downloaded/all) + ModelPicker
- [x] DELETE /models/finetuned/{job_id} — supprime gguf_export/
- [x] llama-cpp-python dans Settings → Engines (badge + upgrade SSE)
- [x] CompatBanner redirige vers Settings → Engines
- [x] Download history persistée en SQLite
- [x] FTLoadModal : VramBar live, CPU RAM offload slider
- [x] Configure & Start intègre eval before/after toggles
- [x] 9 paires de test créées et assignées aux profils
- [x] Fix : UNSLOTH_COMPILE_LOCATION hors src-tauri (évite Tauri hot-reload)
- [x] Fix : device_map={"": 0} (bitsandbytes 4bit incompatible avec dispatch CPU)
- [x] Fix : on_status("done") retardé si eval_after pending
- [x] Fix : pipeline_done event pour fermer SSE proprement

## Terminé ✅ (session 12 — 2026-05-18)
- [x] Stats par message persistantes (TTFT, engine, model_name)
- [x] Barre de contexte temps réel
- [x] Détection OOM persistée en DB
- [x] Fix régénération messages en double

## Terminé ✅ (sessions précédentes)
- [x] quality_scorer.py, benchmarks, multi-venv vLLM
- [x] InstallerApp natif, système MAJ, fresh install E2E
- [x] App Tauri native, dual-engine, SQLite, profils
- [x] GitHub public MIT : https://github.com/trinityUwU/echohub
