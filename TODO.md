# EchoHub — TODO

## 🔴 Priorité 1 — À faire maintenant

- [ ] **Vérifier la recompilation llama-cpp-python CUDA** après install :
  ```bash
  backend/.venv/bin/python -c "import llama_cpp, os; print([f for f in os.listdir(os.path.dirname(llama_cpp.__file__)+'/lib') if 'cuda' in f.lower()])"
  ```
  Doit retourner `['libggml-cuda.so']` ou similaire.
- [ ] **Tester les perfs GGUF GPU** : charger un modèle 8B Q4_K_M, vérifier ~40-60 tok/s
- [ ] **Mettre à jour start.sh** : détecter NVIDIA + compiler llama-cpp avec CUDA automatiquement
- [ ] **GPU backend dans SettingsPage** : afficher le backend actif (cuda/cpu/metal) avec statut

---

## 🟡 Priorité 2 — UX Onboarding & Setup

- [ ] Page Setup dans l'UI qui gère toute l'installation des dépendances
  - Détection hardware automatique au premier lancement
  - Installation llama-cpp-python depuis l'UI avec le bon backend
  - Logs d'installation en temps réel via SSE
  - Progress bar globale
- [ ] Onboarding tutoriel au premier lancement (fausses données, walkthrough)
- [ ] Endpoints backend : `/setup/status`, `/setup/install`, `/setup/hardware`

---

## 🟡 Priorité 3 — Features en attente

- [ ] Chat history persistence (SQLite au lieu de localStorage)
- [ ] Chat export (markdown)
- [ ] Real download progress from HF (tqdm callback)
- [ ] HF_TOKEN support UI → déjà fait, mais pas de feedback si token invalide
- [ ] Multi-GPU support vLLM (tensor_parallel_size)
- [ ] Model card README preview dans ModelBrowser
- [ ] GPU service : fallback AMD (rocm-smi) et Mac (powermetrics)
- [ ] Context window depuis metadata GGUF (gguf-reader)
- [ ] Badge engine (llama/vLLM) visible sur le modèle chargé dans le header
- [ ] LoadConfigModal : afficher engine détecté (GGUF→llama, AWQ→vLLM)

---

## 🟢 Priorité 4 — App de bureau Tauri v2

- [ ] Shell Rust + frontend React + sidecar Python FastAPI
- [ ] Packager en binaire natif : .exe / .dmg / .AppImage
- [ ] Le binaire embarque Python + venv → zero install pour l'utilisateur final
- [ ] Auto-update via Tauri updater

---

## ✅ Fait

- [x] Scaffold complet backend + frontend
- [x] vLLM subprocess manager (eject, VRAM cleanup, OOM auto-retry)
- [x] engine_router + llama_service (dual-engine GGUF/vLLM)
- [x] Download manager avec progress SSE + gguf_file spécifique
- [x] fix total_gb : calcule taille du fichier GGUF sélectionné uniquement
- [x] fix selectedGguf : dépend de gguf_files length, défaut Q4_K_M
- [x] ModelBrowser split-panel LM Studio style
- [x] VRAM bars inline dans les items (style LM Studio : "7B · ~47%")
- [x] Pagination scroll infini
- [x] Filtres format multi-sélection (GGUF/AWQ/GPTQ/FP8/EXL2)
- [x] Badge format dans les items de liste
- [x] Panel droit enrichi : description, gguf_files dropdown, more_from_author cliquable
- [x] Recherche par author/model-id direct
- [x] ModelPickerModal redesign (arch tags, toggle manual config, Framer Motion)
- [x] CapabilityBadges (vision, thinking, code, tools, multilingual)
- [x] Boutons Vision/Thinking inline dans input chat
- [x] Attachments images + fichiers texte dans le chat
- [x] HF Token settings + check gated avant download
- [x] Badge 🔒 gated + message clair 401
- [x] Auto-unload avant load d'un nouveau modèle
- [x] Bannière CPU-only avec instructions fix par plateforme
- [x] Page Settings (HF Token, Models Dir, About)
- [x] fix refresh loop (DownloadPanel + App.tsx)
- [x] fix max_model_len : cap 4096 supprimé pour valeurs explicites
- [x] CUDA graph overhead (+1.1GB) dans LoadConfigModal
- [x] Modal save profil stylisée
- [x] tools capability détection
- [x] llama-cpp-python installé Python 3.11 (wheel CPU, recompilation CUDA en cours)
