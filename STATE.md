# STATE — EchoHub
*Dernière mise à jour : 2026-05-18 (session 12)*

## Résumé de l'état actuel

Application Tauri v2 native pleinement fonctionnelle. Dual-engine llama-cpp (GGUF) + vLLM (AWQ/GPTQ). Chat stable, stats par message persistées en DB (TTFT, tok/s, engine, model_name, oom). Barre de contexte temps réel avec tokenizer backend. Démo validée session 12 : Qwen3.5-9B GGUF → 7868 tokens à 20K ctx sur RTX 3060, 8.8GB VRAM, 27.8 tok/s. Stratégie Reddit en cours (karma building r/LocalLLaMA). Prochaine grosse feature : fine-tuning UI.

## Ce qui a été fait — session du 2026-05-18 (session 12)

### Stats par message — persistance complète
- `MessageStats` backend + frontend : ajout `ttft_ms`, `engine`, `model_name`, `oom`
- `GenerationStats` frontend : ajout `ttftMs`, `engine`, `modelName`, `oom`
- `inference.py` : event `echohub_stats` envoyé en fin de stream avec TTFT backend + engine + model_name
- `client.ts` : parse `echohub_stats`, préfère TTFT backend sinon fallback JS
- `useChat.ts` : persist tous les nouveaux champs en DB à chaque message
- `MessageRow.tsx` : footer affiche `tok/s · Xms TTFT · Xs · engine · model_name` — lu depuis `message.stats` au reload (plus de perte au changement de conv ou restart)

### Fix parsing ThinkingBlock
- Regex `^<think>` → match n'importe où dans le texte (modèle émet parfois du texte avant `<think>`)
- Cas `</think>` sans `<think>` (balise ouvrante mangée par throttle) → contenu avant `</think>` traité comme thinking
- `thinkContent` + `hasThink` extraits proprement, `visibleText` correct dans tous les cas

### Barre de contexte temps réel
- `InputBar` : nouveau composant `ContextBar` entre textarea et ligne temp/top-p
- Couleur : accent (< 75%) → jaune (75-90%) → rouge (> 90%)
- Label `~X / YK ctx` : `~` présent pendant le stream (estimation), disparaît une fois le stream terminé
- `useChat.ts` : `liveTokens` state mis à jour toutes les 10 tokens générés via `onTokensUpdate`
- `llama_service.py` : usage intermédiaire envoyé toutes les `USAGE_INTERVAL=10` tokens + usage final depuis chunk `finish_reason` natif llama-cpp (vrais `prompt_tokens` + `completion_tokens`)
- `estimateTokens()` : inclut maintenant `params.systemPrompt` dans le calcul d'estimation

### Fix régénération — messages en double au reload
- `DELETE /conversations/:id/messages/:msgId` : nouvel endpoint backend + `db.delete_message()`
- `handleRegenerate` : supprime l'ancien message assistant en DB avant de lancer `sendFromHistory`
- `handleEditUser` : supprime tous les messages depuis l'index édité en DB

### Détection OOM
- `llama_service.py` : catch exception dans stream → détecte "out of memory", "cuda error", "failed to allocate" → `error_type: "oom"` dans le payload SSE
- `client.ts` : parse `error_type` → appelle `onOom()` si OOM, sinon `onError()`
- `useChat.ts` : `oomError` state + `onOom` callback → `setOomError(true)`
- `ChatPage.tsx` : banner rouge "Out of memory" si `oomError` OU si dernier message assistant a `stats.oom === true`
- `MessageStats` : champ `oom: bool` persisté en DB → banner visible au reload, disparaît à la régénération
- `llama_service.py` : log `finish_reason` + token counts en fin de génération (debug coupures)

### Reddit — routine quotidienne
- Script `scripts/reddit_hunt.py` utilisé — scan `/new` + `/hot` r/LocalLLaMA, score par pertinence/fraîcheur
- Commentaire posté : fil "Quantizing MTP KV Cache = free lunch?" — réponse sur 20K ctx GGUF 9B RTX 3060
- OsmanthusBloom (top comment 31up) a répondu directement → visibilité confirmée

### Benchmarks démo
- Qwen3.5-9B GGUF (Claude Opus fine-tune) @ 20K ctx : 7868 tokens, 27.8 tok/s, 420ms TTFT, 283s, 8.8/12GB VRAM
- Précédent record : 15K tokens @ 20K ctx, 18.5 tok/s (session 11)
- LM Studio ne peut pas loader ce contexte sur même hardware → argument de lancement toujours valide

### Bug mineur connu
- Indicateur `~` reste affiché après fin de génération (liveTokens/streaming race condition) — noté, non bloquant

## Décisions prises

| Décision | Raison | Date |
|---|---|---|
| usage natif llama-cpp (finish_reason chunk) | Plus fiable que tokenization manuelle — chat template appliqué | 2026-05-18 |
| Suppression probe max_tokens=1 | Overhead inutile, usage natif suffit | 2026-05-18 |
| OOM persisté en DB (stats.oom) | Banner doit survivre au reload — régénération le supprime naturellement | 2026-05-18 |
| USAGE_INTERVAL=10 pour live tokens | Compromis fréquence/overhead — assez fréquent pour animation fluide | 2026-05-18 |
| estimateTokens inclut systemPrompt | Sans ça l'estimation était trop basse si profil avec system prompt long | 2026-05-18 |

## Contexte non-évident

- `prompt_tokens` dans `llama_service.py` vient du chunk `finish_reason` natif — c'est la seule source fiable (chat template appliqué). Le compteur manuel `completion_tokens += 1` est une approximation (un delta ≠ un token).
- `liveTokens` dans `useChat` ne se reset qu'au changement de conversation (pas au début d'un send) — intentionnel pour éviter le flash `~` entre deux messages consécutifs.
- `finish_reason` maintenant loggé dans `llama.log` à chaque fin de génération — utile pour diagnostiquer coupures prématurées (`length` vs `stop`).
- `error_type: "oom"` côté backend : détection string-based sur le message d'exception — couvre les cas CUDA OOM, mais pas les SIGKILL kernel (process tué silencieusement).
- Les logs `llama.log` se reset au restart de l'app (via `start.sh`). Le `finish_reason` d'une session précédente est perdu.
- Reddit : compte créé 2026-05-16, objectif 200 karma commentaires avant lancement (~28 juin 2026). Ne jamais mentionner EchoHub avant S4 (soft reveal organique).

## Prochaines étapes

1. **Fine-tuning UI** (P1) — prochaine grosse feature : Unsloth/LoRA, import dataset, export GGUF
2. **Reddit karma building** (P1) — 1-2 commentaires/jour r/LocalLLaMA, sujets perfs/vLLM/GGUF/CUDA
3. **Fix ~ indicateur** (P3) — `liveTokens` ne se reset pas correctement après stream → `~` reste
4. **Nettoyage composants héritage** (P2) — `src/components/ChatPanel.tsx`, `LoadConfigModal.tsx`, etc.
5. **Quality scoring** (P2) — retirer score Throughput/Latency, ajouter profil Tool call
6. **Packaging** (P2) — valider AppImage + .deb

## Points en suspens

- `~` indicateur reste affiché après stream — race condition `liveTokens`/`streaming` state
- OOM kernel SIGKILL non détectable (process tué sans exception Python)
- `psutil` pas auto-installé sur clones existants → `pip install psutil` dans backend/.venv
- AMD ROCm + Apple Silicon non testés sur vrai hardware
- Vieux composants héritage `src/components/*.tsx` toujours présents

## Historique

### Session 11 (2026-05-17) — Perf streaming + démo lancement
Throttle 150ms, memo() MessageRow, fix code blocks overflow, démo Qwen3.5-9B 15K tokens 20K ctx RTX 3060, matériel lancement Reddit/HN prêt.

### Session 10 (2026-05-17) — Benchmark qualité + Discover
quality_scorer.py (6 scorers), 10 profils benchmark, leaderboard par profil, multi-filtres Discover, modal hardware live, vLLM 400 fixes, model_name persisté.

### Session 9 (2026-05-17) — Fresh install E2E + UX actions
locate_project_root, start.sh cargo tauri dev, InstallerApp, archive conversations, CORS 500, footer stats, copy/edit/regenerate, context menu global, HMR fix.

### Session 8 (2026-05-17) — UX polish, installeur natif, système MAJ
Conversations archivables, GPU sidebar, ThinkingBlock, InstallerApp, UpdateBanner, benchmark, resource limits, HF token, export markdown.

### Session 7 (2026-05-17) — Multi-venv vLLM, paths, migration, docs
vllm_manager.py, Settings/Engines, config_service, migration_service, PathsTab, MigrationBanner, engine_router routing par version.

### Sessions 1-6 (2026-05-15/16)
Design, dual-engine GGUF/AWQ, SQLite, MSW, scaffold frontend, llama-cpp CUDA, Tauri init, sidecar Python.
