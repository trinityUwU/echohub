# STATE — EchoHub
*Dernière mise à jour : 2026-05-21 (session 23)*

## Résumé de l'état actuel

Application Tauri v2 native stable. Session 23 = grosse session performance et GPU : load profiles (Performance/Balanced/Gaming/Minimal), multi-GPU llama.cpp (tensor_split) + vLLM (tensor_parallel_size), speculative decoding (ngram/MTP/draft), optimisations CPU-heavy, fix notifications persistantes. 9 commits pushés sur master. Prêt à tester sur hardware réel.

## Ce qui a été fait — session 23 (2026-05-21)

### Load modal — paramètres avancés (commits 2a252cb, 1d4ed5a, 0ac8f6a)

**Nouveaux paramètres :**
- `offload_kqv` — KV cache → RAM système. Preview VRAM bar avec colonne verte "KV cache (RAM)"
- `n_batch` selector — 64/128/256/512 avec pour/contre. 128 par défaut sur MoE
- Smart cap context — remplace "adaptive" cassé. Calcule ctx max depuis VRAM disponible après weights. Avec offload_kqv, monte jusqu'à 32K

**4 profils de chargement (llama.cpp uniquement) :**

| Profil | VRAM cible | GPU layers | KV quant | offload_kqv | n_batch | Context |
|--------|-----------|-----------|---------|------------|---------|---------|
| ⚡ Performance | ~92% total | Full (-1) | Q8_0 | off | 512 | Fixed |
| ⚖ Balanced | ~50% total | Partiel auto | Q8_0 | off | 256 | Fixed |
| 🎮 Gaming | ~3 GB | Partiel auto | Q4_0 | on | 128 | Smart cap |
| 🪶 Minimal | ~1.5 GB | Partiel auto | Q4_0 | on | 64→512* | Smart cap |

*n_batch=512 forcé si CPU-heavy (pas de VRAM pressure sur CPU)

Calcul layers : `estimateLayers(paramsBillion) × gpuLayersPct / 100`. Profils appliqués via `applyProfile()`, tweaks manuels après = badge "active" effacé.

### Bugs critiques corrigés (commit 0ac8f6a)
- `resolvedNGpuLayers` retournait `null` pour 0–100% → backend interprétait comme -1 → **full GPU malgré profil Gaming/Minimal**. Fix : conversion via `estimateLayers()`
- "Adaptive" context passait `null` → llama.cpp crashait "tokens exceed 4096". Fix : Smart cap calcule un ctx réel

### Multi-GPU llama.cpp — tensor_split (commit 35c38db)
- Nouveau module `backend/services/multi_gpu.py` : `detect_all_gpus()`, `compute_tensor_split()`, `get_multi_gpu_config()`
- Split proportionnel à la VRAM par GPU (égal si VRAM inconnue / AMD)
- `GET /inference/multi-gpu-config`
- Frontend : banner vert auto si gpu_count > 1, VRAM bar utilise total combiné

### Multi-GPU vLLM — tensor_parallel_size (commit 41eebe2)
- `--tensor-parallel-size N` + `--pipeline-parallel-size N` dans vllm_service.py
- Selector ×1 → ×N dans modal vLLM si multi-GPU détecté

### Speculative decoding (commit 77db260)
- **N-gram** (défaut sur tous profils) : `LlamaPromptLookupDecoding(num_pred_tokens=10)`. ~1.3x sur outputs répétitifs. Zero VRAM
- **MTP self-speculative** : `LlamaDraftModel` + têtes MTP intégrées. ~1.5x sur coding. Auto-détection GGUF via scan 64KB metadata (`b'mtp'` / `b'num_nextn_predict'`). Option grisée si GGUF incompatible
- **Draft model externe** : path input + slider n_pred_tokens 2–16. ~2x sur coding
- `GET /inference/llama/mtp-support?model_id=`
- `checkMtpSupport()` dans api/client.ts

### Perf CPU-heavy — n_threads adaptatif (commit 47a2471)
- `_detect_n_threads(gpu_layers, total_layers)` — si < 20% layers sur GPU : tous les threads logiques (6→12 sur machine Chris)
- `n_batch=512` pour CPU-heavy (remplace 64 qui ralentissait inutilement le prefill)
- `estimateLayers_backend()` + `_model_params_from_path()` ajoutés
- Impact Minimal attendu : TTFT ~11s → ~4-6s, tok/s ~4.8 → ~7-9

### Notifications persistantes (commit f17c48b)
- `_history` en localStorage (`echohub:notifications`, max 200)
- `_loadHistory()` au module init, `_saveHistory()` à chaque `addToast`/`clearHistory`

### Docs v0.9 (commit d7dbc78)
- `docs/v0.9-perf-gpu-speculative.md` créé
- README.md mis à jour : bullets, under the hood, releases table

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| Smart cap plutôt que null pour ctx adaptatif | llama.cpp fixe n_ctx au load — null = crash garanti | 2026-05-21 |
| estimateLayers() dupliqué frontend/backend | Évite un API call synchrone dans le modal — valeurs identiques | 2026-05-21 |
| n_batch=512 pour CPU-heavy (profil Minimal) | Pas de VRAM pressure sur CPU, prefill plus rapide avec gros batch | 2026-05-21 |
| Tous threads logiques si < 20% layers GPU | CPU est le vrai bottleneck — HT aide sur compute LLM | 2026-05-21 |
| Notifications → localStorage, pas SQLite | État UI éphémère, pas données applicatives | 2026-05-21 |
| N-gram spéculatif par défaut sur tous profils | Zero coût, gain gratuit sur tous les modèles | 2026-05-21 |

## Contexte non-évident

- `nvidia-smi` sans args = teste driver kernel, pas GPU physique. `-L` liste devices réels (fix session 22)
- `CHAT_BUILTINS` est dans `useProfiles.ts`, pas dans `ChatSettingsSidebar.tsx`
- Clé localStorage profiles : `echohub:profiles` (deux-points, pas underscore)
- Clé localStorage notifications : `echohub:notifications`
- `skillChatHook` en mode skill = `useToolChat('__skills__')` — endpoint `/conversations/:id/messages`
- `install_complete` flag en DB : ne JAMAIS le reset pour forcer setup — utiliser `/installer/recompile-llama`
- Multi-GPU tensor_split doit sommer à 1.0 exactement — `compute_tensor_split()` normalise le dernier élément
- Speculative decoding MTP : `LlamaDraftModel` pointe sur une seconde instance Llama du même GGUF — double la VRAM si pas de têtes MTP natives. Vérifier via `/inference/llama/mtp-support` avant
- `resolvedNGpuLayers` null → backend `-1` était le bug critique qui rendait Gaming/Minimal inutiles
- `pipeline_parallel_size` câblé backend mais sans UI (usage avancé 3+ GPUs / 70B+)

## Prochaines étapes (session 24)

1. **Types de projets Dev/Docs/Research** — layouts fonctionnels (P0 depuis session 22)
   - Dev : arborescence fichiers réelle + IDE-like (file tree, tabs)
   - Docs : injection contexte fichiers drag & drop
   - Research : gestion sources URL/documents
2. **RAG natif dans les projets** — ChromaDB par projet, PDF/DOCX/MD/CSV, retrieval injecté contexte
3. Valider résultats perf Minimal après fix n_threads (Chris teste actuellement)
4. **Logs MCP** dans la card skill (GET /skills/{id}/mcp/logs?lines=50)
5. **Scoring qualité benchmarks** — algo sans LLM juge

## Points en suspens

- Résultats perf profil Minimal à confirmer (test en cours, fix commit 47a2471)
- `params` pas mis à jour si profil changé avant reload app → workaround : resélectionner le profil
- web_search DDG sélecteurs brittle — fallback si DDG change layout
- OOM kernel SIGKILL non détectable — watchdog process (backlog)
- ROCm : si rocm-smi absent mais GPU AMD présent → llama compilé CPU, pas de warning clair
- Speculative draft model externe : pas de browser pour choisir le GGUF dans le modal — path manuel seulement

## Historique

### Session 22 (2026-05-21)
GPU backend mismatch fix : `nvidia-smi -L` obligatoire, AMD ROCm support (`-DGGML_HIPBLAS=on`), mismatch auto-recompile, `/installer/diagnose`, `/installer/recompile-llama`, banner EnginesTab, toast startup.

### Session 21 (2026-05-20)
MCP stdio transport (McpStdioClient, buffer 8MB, timeout 120s), venv isolé par skill Python, detect_mcp_server smithery.yaml + StdioServerTransport Node + monorepos, context budget 75%/92%, synthesis on cap, persistance messages MCP, context bar projets, déduplication messages, tool call blocks animés, 5 profils chat avec system prompts + permanent rules.

### Session 20 (2026-05-20)
Skills/MCP system complet : native skills (Web Search, Code Runner, File System, Calculator), community skills installables depuis GitHub, toggles UI, awareness blocks injectés dans system prompt, MCP HTTP fonctionnel, notifications SSE, modularisation backend.

### Session 19 (2026-05-20)
Streaming interleaved tool execution, parser MessageContent à état (think/tool_call/tool_result), auto-compact 98%, set_tool_limit tool, fetch_url + web_search via Scrapling, slash commands, auto-focus textarea, Permanent Rules UI, capabilities détectées au load.

### Session 18 (2026-05-20 matin)
Projects system complet : hub, workspaces, profils scopés, sidebar conversations. Dev mode tool use. generate_with_tools streaming réel. KV cache sélectionnable. MoE VRAM guard.

### Sessions 1-17
Fondations (dual-engine inference, VRAM management, model discovery), multi-vLLM, benchmark suite, fine-tuning QLoRA complet, MTP support, vision GGUF.
