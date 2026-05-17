# TODO — EchoHub
*Dernière mise à jour : 2026-05-17 (session 11)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — participation genuïne, pas de promo avant 3-4 semaines
- [x] Screenshots lancement : Qwen3.5-9B 15K tokens sur RTX 3060, footer stats, GPU sidebar — DONE
- [ ] Rédiger post Reddit/HN avec Chris autour de la démo Qwen3.5-9B (matériel prêt)

## À faire (priorité)

### Fine-tuning (P1 — prochaine grosse feature)
- [ ] UI fine-tuning dans EchoHub : sélection modèle base, import dataset JSONL/ShareGPT/Alpaca
- [ ] Intégration Unsloth (LoRA/QLoRA), logs SSE temps réel
- [ ] Export GGUF Q4_K_M post-train + requantisation
- [ ] Gestion datasets : génération IA, import HF, création manuelle

### Lancement (P1)
- [ ] Créer compte Reddit
- [ ] Finaliser posts avec Chris (docs/private/posts-drafts.md)
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)

### Nettoyage (P1)
- [ ] Supprimer vieux composants héritage : `src/components/ChatPanel.tsx`, `LoadConfigModal.tsx`, `MarkdownContent.tsx`, `ModelCard.tsx`, `ModelPickerModal.tsx`, `ThinkingBlock.tsx`, `SettingsPage.tsx`, `ui/`

### Benchmark qualité (P2)
- [ ] Retirer quality score sur Throughput/Latency (pas de critère objectif — vitesse pure)
- [ ] Profil "Tool call" : tester compatibilité tool calling natif du modèle
- [ ] Profil "Repo generation" : créer un script complet, vérifier exécution

### Backend (P2)
- [ ] Installer psutil dans les clones existants (`pip install psutil` dans backend/.venv)
- [ ] GPU service : tester AMD ROCm et Apple Silicon sur vrai hardware
- [ ] Installer : gérer race condition backend pas encore démarré

### Packaging (P2)
- [ ] Valider `.AppImage` (linuxdeploy requis)
- [ ] Valider `.deb`

## Backlog
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux (Phase 2)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune)
- [ ] Modèle juge fiable (après fine-tuning + évaluation)
- [ ] Multi-GPU support vLLM (tensor_parallel_size)
- [ ] Python sidecar WebSocket (SSE fonctionne, pas urgent)

## Terminé ✅ (session 11 — 2026-05-17)
- [x] Throttle streaming 150ms — fix freeze sur longues générations (15K tokens)
- [x] memo() MessageRow — messages précédents ne re-rendent plus pendant stream
- [x] Code blocks overflow-x-auto — ne débordent plus de la bulle de message
- [x] Démo Qwen3.5-9B GGUF → 15K tokens, 20K ctx, RTX 3060 — matériel lancement validé

## Terminé ✅ (session 10 — 2026-05-17)
- [x] quality_scorer.py — 6 scorers algorithmiques sans LLM juge
- [x] 10 profils benchmark builtins (Latency/Throughput/Prefill/Code/Long Context/Reasoning/Instruction/Conversation Short/Medium/Long)
- [x] Leaderboard par profil (onglets dynamiques)
- [x] Nommage auto benchmarks lisible (model-profil-17 May 09:51)
- [x] tok/s thinking models (tous tokens, thinking_tokens séparé)
- [x] Discover multi-filtres toggle + sort + pagination vraie
- [x] Modal chargement : hardware live CPU+GPU, slider compute split, CPU overflow
- [x] vLLM 400 fixes (chat template fallback, filtre messages vides)
- [x] _vllm_version() correct via subprocess
- [x] _extract_conversation_facts() extraction faits depuis prompt
- [x] LICENSE MIT
- [x] Onglet Models Settings supprimé
- [x] model_name persisté dans message.stats

## Terminé ✅ (sessions précédentes)
- [x] App Tauri native + sidecar Python, dual-engine, SQLite, profils
- [x] Multi-venv vLLM + routing automatique
- [x] InstallerApp natif + système MAJ
- [x] Fresh install E2E — tous paths relatifs, cargo tauri dev
- [x] Actions chat footer (copy/edit/regenerate), sendFromHistory
- [x] Context menu global, conversations rename/archive/delete
- [x] Markdown atom-one-dark, benchmark persisté DB
- [x] GitHub public MIT : https://github.com/trinityUwU/echohub
