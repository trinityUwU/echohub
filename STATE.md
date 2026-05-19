# STATE — EchoHub
*Dernière mise à jour : 2026-05-19 (sessions 13-16)*

## Résumé de l'état actuel

Application Tauri v2 native avec pipeline fine-tuning complet + support MoE. Fine-tune : collecte RLHF, entraînement Unsloth QLoRA, export GGUF, évaluation before/after. GGUFs fine-tunés visibles dans Library + ModelPicker. llama-cpp-python gérable depuis Settings → Engines. MoE : Qwen3-30B-A3B charge sur RTX 3060 avec CPU overflow (40 layers GPU + 6GB RAM), badge amber dans Discover/Picker, defaults auto-remplis dans LoadModal. Pushé sur GitHub.

Matériel Reddit prêt — 100K ctx validé, Qwen3-30B-A3B MoE fonctionnel sur 12GB.

## Ce qui a été fait — sessions 13-15 (2026-05-19)

### Fine-tune — feature complète (section nav dédiée)

**Profiles tab** (3 colonnes : profils / paires / détail)
- 5 profils builtin : Dev / Reasoning / General / Analysis / Debug
- Création custom, barre progression pair_count/target_pairs
- Paires RLHF avec prompt + chosen + rejected

**Models tab**
- Toggle Installed / Hugging Face
- VRAM QLoRA estimée live, badge fits/exceeds GPU
- Download progress bar depuis SSE partagé

**Train tab**
- Configure & Start modal : hardware-aware (RTX 3060 → seq=512, rank=16, batch=1)
- VramBar live qui se met à jour quand on change rank/seq_length
- CPU RAM offload slider (0→N GB, passe en 8bit si activé)
- Toggles before/after eval avec GGUF finder HF intégré
- JobRow : expand/collapse logs, cancel, recover, heartbeat 30s

### Pipeline fine-tune — architecture résistante

**Root cause final résolu :** generator SSE = pipeline → si SSE déconnecte, pipeline suspend
- **Fix** : pipeline = `asyncio.Task` indépendant, SSE = reader sur `asyncio.Queue` par job
- Pipeline persist son stage en DB : `start → eval_before → finetune → finetune_done → export_gguf → eval_after`
- À chaque reconnexion : check stage + check fichiers sur disque → skip étapes déjà faites

**Export GGUF :**
- Bypass build check Unsloth (cmake fail sur warning C++ Arch Linux)
- Utilise binaires déjà compilés : `~/.unsloth/llama.cpp/build/bin/llama-quantize`
- `convert_hf_to_gguf.py` depuis `~/.unsloth/llama.cpp/`
- 3 étapes : merge LoRA→BF16 safetensors → GGUF BF16 → Q4_K_M (~6 min total)

**Eval before/after :**
- Before : download GGUF base depuis HF → llama-cpp-python → prompts → score → unload → delete
- After : llama-cli Unsloth direct (llama-cpp-python v0.3.23 incompatible avec GGUFs Unsloth)
- GGUF finder : même auteur prioritaire, Q4_K_M recommandé

### GGUFs fine-tunés dans Library + Chat

- `GET /models/finetuned` : scan `~/.local/share/echohub/finetune/*/gguf_export/*.gguf`
- `DELETE /models/finetuned/{job_id}` : supprime gguf_export/ (LoRA préservé)
- LibraryPage : toggle All / Downloaded / Fine-tuned, badge violet "ft"
- ModelPickerModal : idem avec filtre source
- Bouton delete sur chaque fine-tuné (confirmation avant)

### llama-cpp-python dans Settings → Engines

- `GET /models/llama-cpp/status` : version, cuda_enabled, size_gb
- `GET /models/llama-upgrade/stream` : SSE upgrade avec détection CUDA auto
- EnginesTab : section llama-cpp au-dessus de vLLM, badge operational/cpu only/not installed
- CompatBanner redirige vers Settings → Engines (pas upgrade inline)
- `SettingsPage` : prop `initialTab` pour ouvrir Engines directement

### Download history persistée

- Table `download_history` en SQLite — survit aux restarts
- DownloadsPage : section History avec VRAM live, badge "files deleted" rouge, delete log

### Paires de test créées

9 paires ML/LLM créées via script pour valider le pipeline (assignées aux profils)

## Décisions prises

| Décision | Raison | Date |
|---|---|---|
| Pipeline = asyncio.Task indépendant | Generator SSE suspendu si déconnexion → pipeline jamais terminé | 2026-05-19 |
| Export GGUF : binaires directs Unsloth | cmake fail sur warning C++ Arch → llama-quantize déjà compilé dans ~/.unsloth/ | 2026-05-19 |
| Eval after : llama-cli, pas llama-cpp-python | v0.3.23 incompatible GGUFs Unsloth ('sampler' manquant) | 2026-05-19 |
| pipeline_stage persisté en DB | Resume logic : skip étapes déjà faites à la reconnexion | 2026-05-19 |
| GGUF finder : cherche même auteur + GGUF suffix | Jackrong/BF16 → Jackrong/GGUF retrouvé en 1er résultat | 2026-05-19 |
| on_status("done") retardé si eval_after | Sans ça, DB=done → frontend ferme SSE → export+eval never run | 2026-05-19 |

## Contexte non-évident

- **Unsloth compile llama.cpp** dans `~/.unsloth/llama.cpp/` au premier export GGUF. Build ~5-10 min. Échoue sur Arch Linux à cause du warning `-Wdeprecated-enum-enum-conversion` mais les binaires sont quand même compilés. On bypass le check et utilise les binaires directement.
- **llama-cpp-python v0.3.23** : incompatible avec les GGUFs générés par Unsloth (version récente). Erreur : `'LlamaModel' object has no attribute 'sampler'`. Pour le chat avec les fine-tunés, il faut upgrader via Settings → Engines.
- **Cache Unsloth dans src-tauri/** : Unsloth écrit son JIT cache dans le répertoire courant → `src-tauri/` → Tauri hot-reload infini. Fix : `UNSLOTH_COMPILE_LOCATION=~/.cache/unsloth` dans le script train + `.tauriignore`.
- **device_map={"": 0}** obligatoire pour Unsloth 4bit : `device_map="auto"` dispatche certains layers sur CPU → incompatible avec bitsandbytes 4bit.
- **eval_gguf_model_id peut être None** si eval_after activé sans eval_before. Fix : pour les paths locaux, model_id = basename du .gguf.
- **_full_pipeline_inner est resume-safe** : vérifie lora_done() et gguf_exported() à chaque step. Un job bloqué en `running` avec stage `export_gguf` reprend à `eval_after` si le GGUF est présent sur disque.
- **Reddit** : compte créé 2026-05-16, karma building r/LocalLLaMA. Ne jamais mentionner EchoHub avant S4. Matériel lancement prêt (démo 100K ctx validée ce soir).

## Prochaines étapes

1. **Stabiliser le pipeline eval** (P1) — le flow before/after fonctionne mais l'eval after ne persiste pas encore systématiquement en DB, à vérifier et fixer
2. **Upgrader llama-cpp-python** (P1) — permettre de chatter avec les GGUFs fine-tunés dans le Chat
3. **Post Reddit lancement** (P1) — matériel prêt, rédiger avec Chris, angle "limites perçues artificiellement basses"
4. **Bug ~ indicateur** (P3) — race condition liveTokens/streaming
5. **Nettoyage composants héritage** (P2)
6. **Packaging AppImage + .deb** (P2)

## Points en suspens

- Eval after ne persiste pas toujours (à investiguer après restart backend)
- llama-cpp-python v0.3.23 bloque le chargement des GGUFs fine-tunés dans le Chat
- `~` indicateur reste après stream (race condition)
- OOM kernel SIGKILL non détectable
- Vieux composants héritage présents

## Ce qui a été fait — session 16 (2026-05-19, fin de session)

### Support MoE (Mixture of Experts)
- `_is_moe()` : détection via pattern `XB-AYB`, keywords (`mixtral`, `deepseek-v`, `moe`), tags HF
- `_extract_active_params_billion()` : extrait les params actifs (ex : 3B de 30B-A3B)
- `ModelInfo` : champs `is_moe` et `active_params_billion`
- `GET /models/moe-load-config` : calcule `n_gpu_layers` recommandé selon VRAM dispo
  - Qwen3-30B-A3B + RTX 3060 12GB → 40 layers GPU (~10.5GB) + ~6GB RAM overflow
- `llama_service.load_model` : `is_moe=True` + `cpu_overflow=True` → `n_batch=128`, `no_perf=True` → évite crash CUDA graph à 88%
- `LoadModelModal` : banner amber MoE, pré-remplit n_gpu_layers/cpu_overflow/ctx=32768 depuis `getMoeLoadConfig`
- Badge "MoE A3B" amber dans `ModelCard` (Discover) et `ModelPickerModal`
- Tout pushé sur GitHub (37 commits d'un coup)

## Historique

### Session 13-15 (2026-05-18-19) — Fine-tune pipeline complet
Section Fine-tune : profils RLHF, training Unsloth QLoRA, export GGUF, eval before/after. Architecture pipeline task indépendant (SSE-resistant). GGUFs fine-tunés dans Library+Chat. llama-cpp-python dans Settings Engines. Nombreux bugs pipeline résolus (asyncio, Unsloth build, llama-cpp compat).

### Session 12 (2026-05-18) — Stats persistantes + context bar + OOM
Stats TTFT/engine/model_name persistées en DB, barre contexte temps réel, détection OOM, fix régénération. Reddit : 1er commentaire posté, réponse OsmanthusBloom.

### Session 11 (2026-05-17) — Perf streaming + démo lancement
Throttle 150ms, memo() MessageRow, démo 15K tokens 20K ctx.

### Session 10 (2026-05-17) — Benchmark qualité + Discover
quality_scorer.py (6 scorers), 10 profils benchmark, multi-filtres Discover, modal hardware live.

### Session 9 (2026-05-17) — Fresh install E2E + UX actions
locate_project_root, start.sh cargo tauri dev, InstallerApp, CORS 500, footer stats, context menu.

### Sessions 1-8 (2026-05-15/16/17)
Design, dual-engine, SQLite, UX polish, vLLM multi-venv, InstallerApp, système MAJ.
