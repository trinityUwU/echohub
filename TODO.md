# TODO — EchoHub
*Dernière mise à jour : 2026-05-21 (session 23)*

## En cours
- [ ] Construction karma Reddit (r/LocalLLaMA) — 1-2 commentaires/jour, sujets perfs/vLLM/GGUF/CUDA
- [ ] Rédiger post Reddit/HN avec Chris (matériel prêt — démo Skills/MCP + Projects + agent + perf v0.9)
- [ ] Valider résultats perf profil Minimal après fix n_threads (TTFT et tok/s attendus)

## À faire (priorité)

### P0 — Prochaine session

- [ ] **Types de projets Dev/Docs/Research** — layouts fonctionnels, pas stubs
  - Dev : arborescence fichiers réelle + IDE-like (file tree, tabs)
  - Docs : injection contexte fichiers drag & drop
  - Research : gestion sources URL/documents
- [ ] **RAG natif dans les projets**
  - PDF (pdfplumber), DOCX (python-docx), PPTX, XLSX, MD, CSV, JSON
  - ChromaDB par projet, retrieval injecté dans contexte à chaque message
  - Chat normal = pas de RAG

### P1 — Session suivante

- [ ] **Logs MCP** dans la card skill — last session logs, endpoint GET /skills/{id}/mcp/logs?lines=50
- [ ] **Scoring qualité benchmarks** — algo sans LLM juge, score 0-100 dans leaderboard
  - Code : compilation OK, présence éléments attendus
  - Raisonnement : réponse correcte
  - Instruction : format
  - Résumé : couverture mots-clés
- [ ] **Profils benchmark conversation** — minimal/medium/long context avec scoring auto
- [ ] **Draft model browser** dans le modal — actuellement path manuel, faudrait un dropdown des GGUFs téléchargés

### P2 — Performance GPU (backlog actif)

- [ ] **Speculative MTP** — mesurer gain réel sur Qwen3 (têtes présentes vs gain effectif)
- [ ] **N-gram n_pred_tokens auto** — ajuster selon type de task (coding → 16, chat → 6)
- [ ] **EAGLE-3 via vLLM** — 4090/5090, ~6x speedup. Nécessite modèle EAGLE3 Qwen3. Blocker : vLLM only
- [ ] **ExLlamaV3 backend** — Ada Lovelace (4090/5090). Ampere encore second-class
- [ ] **Bandwidth-aware profils** — adapter calcul selon bandwidth GPU (4090 = 1008 GB/s vs 3060 = 360 GB/s)
- [ ] **LMDeploy backend optionnel** — claims 1.8x vs vLLM, évaluer sur 4090
- [ ] **Blackwell/5090 compat** — PDL llama.cpp = Hopper+ only pour l'instant, surveiller updates

### P2 — Backlog actif

- [ ] Fix indicateur `~` après fin de stream (race condition liveTokens/streaming)
- [ ] web_search DDG sélecteurs brittle — fallback si DDG change layout
- [ ] OOM kernel SIGKILL non détectable — watchdog process
- [ ] Tester Qwen2.5-Coder-14B Q4_K_M pour Dev mode (tool calling natif probable)
- [ ] run_command timeout configurable (tsc sur gros projets peut dépasser 10s)

### Lancement

- [ ] Objectif karma Reddit : 200 commentaires avant ~28 juin 2026
- [ ] Finaliser posts avec Chris — /humanizer obligatoire avant publication
- [ ] Préparer Show HN (mardi-jeudi 14h-16h Paris)

## Backlog

- [ ] **Multi-node cluster** — Ray + vLLM distribué (plan dans `docs/cluster-integration-plan.md`)
- [ ] Tool calling natif vLLM dans generate_with_tools
- [ ] Scrapling MCP server natif
- [ ] MCP server EchoHub → Claude Code pilote modèles locaux (Phase 2)
- [ ] EchoForge ↔ EchoHub API locale (Phase 3)
- [ ] Automatisation fine-tuning (boucle finetune→test→finetune)
- [ ] Modèle juge fiable (après fine-tuning + évaluation itérative)
- [ ] Valider .AppImage + .deb
- [ ] Supprimer vieux composants héritage (ChatPanel.tsx, LoadConfigModal.tsx)

## Terminé ✅ (session 23 — 2026-05-21)

- [x] 4 profils de chargement (Performance / Balanced / Gaming / Minimal) — calcul auto layers
- [x] `offload_kqv` — KV cache → RAM système, preview VRAM temps réel
- [x] `n_batch` selector 64/128/256/512 avec pour/contre
- [x] Smart cap context — remplace adaptive cassé (null → crash)
- [x] Fix `resolvedNGpuLayers` null → full GPU malgré profil Gaming (bug critique)
- [x] Multi-GPU llama.cpp : `multi_gpu.py`, `tensor_split` proportionnel, banner modal, endpoint
- [x] Multi-GPU vLLM : `tensor_parallel_size`, selector modal
- [x] Speculative decoding : n-gram (défaut) / MTP (auto-détection GGUF) / draft model (path + slider)
- [x] `GET /inference/llama/mtp-support` — scan metadata GGUF
- [x] n_threads adaptatif : CPU-heavy → threads logiques complets (6→12 sur machine Chris)
- [x] n_batch=512 pour CPU-heavy (fin du 64 inutile en mode Minimal)
- [x] Notifications persistantes via localStorage (`echohub:notifications`)
- [x] docs/v0.9-perf-gpu-speculative.md + README.md mis à jour

## Terminé ✅ (session 22 — 2026-05-21)

- [x] GPU detection stricte : `nvidia-smi -L`
- [x] AMD ROCm support dans `_compile_llama_async`
- [x] Mismatch auto-recompile au setup
- [x] `GET /installer/diagnose` + `GET /installer/recompile-llama`
- [x] EnginesTab : banner mismatch + bouton recompile
- [x] App.tsx : toast warning startup GPU détecté mais CPU utilisé

## Terminé ✅ (sessions 19-21 — 2026-05-20)

- [x] MCP stdio transport, venv isolé par skill, context budget, synthesis on cap, 5 profils chat
- [x] Native skills + community skills + MCP HTTP + notifications SSE
- [x] Streaming interleaved, MessageContent parser, auto-compact, fetch_url + web_search

## Terminé ✅ (sessions 1-18)
- [x] Dual-engine inference, VRAM management, model discovery, multi-vLLM
- [x] Benchmark suite, fine-tuning QLoRA, MTP support, vision GGUF, Projects workspace
