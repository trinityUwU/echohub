# TODO — EchoHub
*Dernière mise à jour : 2026-05-18 (session 12)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — 1-2 commentaires/jour, sujets perfs/vLLM/GGUF/CUDA
- [ ] Rédiger post Reddit/HN avec Chris (matériel prêt — démo 7868 tokens 20K ctx)

## À faire (priorité)

### Fine-tuning (P1 — prochaine grosse feature)
- [ ] UI fine-tuning dans EchoHub : sélection modèle base, import dataset JSONL/ShareGPT/Alpaca
- [ ] Intégration Unsloth (LoRA/QLoRA), logs SSE temps réel
- [ ] Export GGUF Q4_K_M post-train + requantisation
- [ ] Gestion datasets : génération IA, import HF, création manuelle

### Lancement (P1)
- [ ] Finaliser posts avec Chris (docs/private/posts-drafts.md)
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)
- [ ] Objectif karma avant lancement : 200 commentaires (~28 juin 2026)

### Bugs (P2)
- [ ] Fix indicateur `~` qui reste affiché après fin de stream (race condition liveTokens/streaming)
- [ ] OOM kernel SIGKILL non détectable — envisager watchdog process

### Nettoyage (P2)
- [ ] Supprimer vieux composants héritage : `src/components/ChatPanel.tsx`, `LoadConfigModal.tsx`, `MarkdownContent.tsx`, `ModelCard.tsx`, `ModelPickerModal.tsx`, `ThinkingBlock.tsx`, `SettingsPage.tsx`, `ui/`

### Benchmark qualité (P2)
- [ ] Retirer quality score sur Throughput/Latency (pas de critère objectif)
- [ ] Profil "Tool call" : tester compatibilité tool calling natif
- [ ] Profil "Repo generation" : créer un script complet, vérifier exécution

### Backend (P2)
- [ ] Installer psutil dans les clones existants (`pip install psutil` dans backend/.venv)
- [ ] GPU service : tester AMD ROCm et Apple Silicon sur vrai hardware

### Packaging (P2)
- [ ] Valider `.AppImage` (linuxdeploy requis)
- [ ] Valider `.deb`

## Backlog
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux (Phase 2)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune)
- [ ] Modèle juge fiable (après fine-tuning + évaluation)
- [ ] Multi-GPU support vLLM (tensor_parallel_size)

## Terminé ✅ (session 12 — 2026-05-18)
- [x] Stats par message persistantes : TTFT, engine, model_name — plus de perte au reload
- [x] Fix ThinkingBlock parsing — `<think>` n'importe où, `</think>` orphelin géré
- [x] Barre de contexte temps réel — tokenizer backend, live update toutes les 10 tokens
- [x] Estimation contexte inclut system prompt
- [x] Fix régénération — messages en double au reload (DELETE /messages/:id)
- [x] Fix handleEditUser — supprime messages suivants en DB
- [x] Détection OOM — banner rouge live + persisté en DB (visible au reload)
- [x] Log finish_reason dans llama.log (debug coupures prématurées)
- [x] Reddit — 1er commentaire posté, réponse OsmanthusBloom (top comment 31up)
- [x] Démo Qwen3.5-9B @ 20K ctx : 7868 tokens, 27.8 tok/s, 420ms TTFT, 8.8GB VRAM

## Terminé ✅ (session 11 — 2026-05-17)
- [x] Throttle streaming 150ms — fix freeze sur longues générations
- [x] memo() MessageRow — messages précédents ne re-rendent plus pendant stream
- [x] Code blocks overflow-x-auto
- [x] Démo Qwen3.5-9B 15K tokens 20K ctx RTX 3060 — matériel lancement

## Terminé ✅ (sessions précédentes)
- [x] quality_scorer.py — 6 scorers algorithmiques
- [x] 10 profils benchmark builtins + leaderboard par profil
- [x] Multi-venv vLLM + routing automatique
- [x] InstallerApp natif + système MAJ
- [x] Fresh install E2E — tous paths relatifs
- [x] Actions chat footer (copy/edit/regenerate), sendFromHistory
- [x] Context menu global, conversations rename/archive/delete
- [x] App Tauri native + sidecar Python, dual-engine, SQLite, profils
- [x] GitHub public MIT : https://github.com/trinityUwU/echohub
