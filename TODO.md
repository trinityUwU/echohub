# TODO — EchoHub
*Dernière mise à jour : 2026-05-17*

## En cours
- [ ] **Multi-venv vLLM** — architecture venvs isolés par version, Settings/Engines, compatibility routing

## À faire (priorité)

### Multi-venv vLLM (P1 — session en cours)
- [ ] `vllm_manager.py` — scan venvs `~/.local/share/echohub/vllm-envs/`, taille disque, statut
- [ ] Settings > onglet "Engines" — liste versions installées, taille, statut opérationnel
- [ ] Protection : impossible de supprimer la dernière version installée
- [ ] Warning si version unique couvre < 20% des architectures communes
- [ ] Install nouvelle version depuis Settings — SSE logs temps réel, progress, durée estimée
- [ ] `engine_router.py` — sélection venv python selon version vLLM requise par modèle
- [ ] DB — persister version vLLM utilisée par modèle chargé
- [ ] `compatibility` endpoint — retourner version vLLM minimale requise
- [ ] ModelDetailPanel — badge version requise + bouton "Install vLLM X.Y" si absent

### Onboarding (P2)
- [ ] Tutoriel premier lancement — explique la plus-value, gestion dépendances, multi-venv
- [ ] Doit être explicite sur l'espace disque (~5-8 GB par version vLLM)
- [ ] Choix opt-in pour installer plusieurs versions dès l'onboarding

### start.sh universel (P2)
- [ ] Détection OS (Debian/Ubuntu, Arch, Fedora, macOS)
- [ ] Build complet automatique selon OS : deps système, venv Python, llama-cpp CUDA/ROCm/Metal
- [ ] Lance l'app Tauri à la fin
- [ ] Première ouverture = onboarding automatique

### Backend (P3 — en attente)
- [ ] Test load GGUF réel avec llama-cpp CUDA
- [ ] Badge engine dans l'UI (llama/vLLM visible sur modèle chargé)
- [ ] GPU service : fallback AMD (rocm-smi) et Mac (powermetrics)

### Features (P3)
- [ ] HF_TOKEN : feedback si token invalide
- [ ] Chat export (markdown)
- [ ] Multi-GPU support vLLM (tensor_parallel_size)

### Packaging (P4)
- [ ] .AppImage / .deb / .dmg
- [ ] Python sidecar WebSocket (remplacer SSE pour streaming)

## Backlog
- [ ] MCP server EchoHub → Claude Code pilote les modèles locaux
- [ ] EchoForge ↔ EchoHub API locale
- [ ] Orchestrateur cloud (Groq/Mistral) qui pilote agents locaux

## Terminé ✅
- [x] Maquette HTML complète (mockup/index.html)
- [x] Tauri v2 init + composants React (NavRail, Chat, Library, Discover, Downloads, Settings)
- [x] Sidecar Python — Rust spawne uvicorn, port dynamique, kill à fermeture
- [x] Backend dual-engine : llama-cpp-python CUDA + vLLM
- [x] SQLite conversations + messages + stats
- [x] Favoris modèles (localStorage)
- [x] ModelDetailPanel — tabs Info/README, GGUF variants avec VRAM, lien HF
- [x] Compatibility check avant download (AWQ+vision détecté)
- [x] CUDA Graphs control dans modal Load (default/limited/disabled)
- [x] Support images dans le chat (vision models)
- [x] Profils chat avec save/load/delete
- [x] Pages persistent entre navigations (CSS hidden)
- [x] SSE stream flush fix (tokens/stats affichés)
- [x] LoadModelModal VRAM preview réactive
- [x] GitHub public : https://github.com/trinityUwU/echohub
