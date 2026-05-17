# STATE — EchoHub
*Dernière mise à jour : 2026-05-17 (session 11)*

## Résumé de l'état actuel

Application Tauri v2 native pleinement fonctionnelle. Dual-engine llama-cpp (GGUF) + vLLM (AWQ/GPTQ). Benchmark complet avec 10 profils, scoring qualité algorithmique, leaderboard par profil. Chat stable sans freeze même sur 15K tokens (throttle 150ms + memo React). Démo validée : Qwen3.5-9B-Claude-4.6-Opus GGUF → 15K tokens en 814s sur RTX 3060, 8.5GB VRAM, 18.5 tok/s. Matériel de lancement Reddit/HN prêt.

## Ce qui a été fait — session du 2026-05-17 (session 11)

### Performance streaming — fix freeze longues générations
- `useChat.ts` : throttle `setMessages` à 150ms pendant le stream (était à chaque token → freeze à 15K)
- `MessageRow` : wrapped dans `memo()` avec comparateur custom — les messages précédents ne re-rendent plus pendant la génération
- `MarkdownContent` : `overflow-hidden` → `overflow-x-auto` sur le container code block
- `MessageRow` container : ajout `min-w-0 overflow-hidden` pour contenir les longs code blocks

### Démo Qwen3.5-9B-Claude-4.6-Opus — matériel lancement
- Test réel : prompt 500 tokens → 15,088 tokens générés, 18.5 tok/s, 814s, 8.5/12GB VRAM
- 20K context window sur RTX 3060 — impossible sur LM Studio (OOM ou ctx tronqué)
- Screenshots sauvegardés : topbar modèle + GPU sidebar + footer stats
- Argument de vente principal : performance + contexte long sans configuration complexe

## Ce qui a été fait — session du 2026-05-17 (session 10)

### Benchmark — qualité algorithmique
- `quality_scorer.py` : 6 scorers sans LLM juge
  - `score_code` : AST parse + sandbox exec Python 5s + éléments structurels
  - `score_reasoning` : step-by-step markers + extraction réponse numérique
  - `score_instruction` : format liste numérotée, comptage items exact, filler
  - `score_summary` : keyword coverage depuis contexte source
  - `score_general` : densité info, topic overlap, filler ratio
  - `score_conversation` : extraction auto faits depuis prompt, cohérence, contradictions
- Score 0-100, grade A/B/C/D/F affiché dans cards + modal + leaderboard

### Benchmark — nouveaux profils
- 3 profils conversation builtins : Short/Medium/Long context (hallucination, mémorisation)
- 3 profils additionnels : Long Context (code review ~1500 tokens), Reasoning (math), Instruction
- Seed incrémental : ajoute les profils manquants au restart sans recréer

### Benchmark — leaderboard par profil
- Onglets : Overall + un onglet par profil avec classement dédié
- Colonne Quality score dans le leaderboard
- Nommage auto benchmarks : `model-profil-17 May 09:51`
- Persistance DB confirmée (table benchmarks + migrations)

### Benchmark — thinking models
- `tok/s` compte tous les tokens (thinking inclus) → plus de 0 tok/s sur DeepSeek-R1
- `/no_think` envoyé en system_prompt pour Qwen3/QwQ
- `thinking_tokens` stocké séparément, affiché dans modal si > 0

### Discover refonte
- Multi-filtres toggle (GGUF, AWQ, GPTQ, FP8, EXL2 + Vision, Thinking en jaune)
- Sort Downloads/Likes/Date avec flèche haut/bas
- Pagination vraie : Next/Prev/First, 20/page, scroll to top, replace (pas append)
- `direction` param conditionnel selon version huggingface_hub (fix crash)

### Modal chargement
- Section Hardware live : GPU (VRAM bar, temp, util%) + CPU (RAM bar, cores, temp)
- Slider Compute Split CPU←→GPU (llama.cpp uniquement)
- Checkbox "Overflow to CPU if VRAM exceeded" → split_mode ROW dans llama.cpp
- `psutil` ajouté aux requirements pour CPU stats
- OOM warning adapté : llama suggère overflow, vLLM bloque

### Bugs vLLM
- 400 Bad Request : fallback chatml si tokenizer sans chat_template (dolphin-mistral etc.)
- 400 messages vides : filtrage des messages content="" avant envoi
- Body vLLM 400 maintenant loggé avec détails

### Leaderboard Settings
- Onglet "Models" Settings supprimé (inutile, redirect vers Paths)
- Nom du modèle persisté dans `message.stats.model_name` → visible après restart

### Divers
- LICENSE MIT ajouté
- `score_conversation` extraction faits depuis prompt corrigée
- `\n` littéraux dans generated_text normalisés avant extraction code
- `_vllm_version()` via subprocess dans venv vLLM (plus "UNKNOWN")

## Décisions prises

| Décision | Raison | Date |
|---|---|---|
| LLM-as-judge rejeté | Boucle d'erreurs : mauvais modèle juge amplifie le bruit. Reprendre quand modèle juge fiable identifié | 2026-05-17 |
| Scoring algorithmique sans LLM | Déterministe, reproductible, zéro dépendance externe | 2026-05-17 |
| tok/s = tous tokens (thinking inclus) | DeepSeek-R1 ne sort que du thinking → 0 tok/s sinon. Thinking séparé pour info | 2026-05-17 |
| Pagination replace (pas append) | UX standard — pagination = switch de page, pas scroll infini | 2026-05-17 |
| psutil pour CPU stats | Seule lib cross-platform pour RAM, cores, CPU usage, température | 2026-05-17 |
| Fine-tuning manuel avant automatisation | Impossible de créer un modèle juge sans fine-tuner d'abord | 2026-05-17 |

## Contexte non-évident

- `quality_scorer.py` : `score_code` exécute le code en sandbox (timeout 5s, subprocess). Si ImportError → partial credit 60 (module absent mais code structurellement correct).
- `_extract_conversation_facts()` : regex sur phrases avec nombres/noms techniques — skip les phrases avec "tell me/based on/answer/question" pour ne pas capturer les questions elles-mêmes.
- `direction` param dans `hf_api.list_models()` : ajouté en huggingface_hub>=0.20 — vérification runtime via `inspect.signature`. Sur versions antérieures, sort ASC/DESC inactif mais pas crashé.
- `cpu_overflow` dans llama.cpp : utilise `LLAMA_SPLIT_MODE_ROW` — disponible seulement dans llama-cpp-python récent (≥0.3.x). Silencieusement ignoré si absent.
- Chat template vLLM : détecté via `tokenizer_config.json` dans le répertoire modèle avant spawn vLLM. Si absent → chatml injecté via `--chat-template`.
- Fine-tuning : roadmap validée → fine-tune manuel d'abord (Unsloth/LoRA), puis automatisation, puis modèle juge. psutil doit être installé dans `backend/.venv` (ajouté requirements.txt mais pas auto-installé sur clones existants).

## Prochaines étapes

1. **Fine-tuning** : prochaine grosse feature — UI dans EchoHub, Unsloth/LoRA/QLoRA, import dataset, export GGUF
2. **Quality scoring** : Throughput/Latency → retirer le quality score (pas de critère objectif), garder seulement pour Code/Reasoning/Instruction/Conversation
3. **Nettoyage** : supprimer vieux composants héritage `src/components/*.tsx`
4. **Tool call eval** : profil benchmark pour tester compatibilité tool calling natif
5. **Stratégie marché** : karma Reddit r/LocalLLaMA + assets lancement

## Points en suspens

- `psutil` pas auto-installé sur clones existants → `pip install psutil` dans backend/.venv
- Sort ASC/DESC inactif sur les vieilles versions de huggingface_hub (pas de crash, juste ignoré)
- AppImage non validé (linuxdeploy requis)
- AMD ROCm + Apple Silicon CPU stats non testés sur vrai hardware
- Vieux composants héritage `src/components/*.tsx` toujours présents

## Historique

### Session 9 (2026-05-17) — Fresh install E2E + UX actions + context menu
locate_project_root, start.sh cargo tauri dev, InstallerApp log scroll, installer vLLM par défaut, paths hardcodés supprimés, archive conversations (import datetime + migration DB), CORS 500 headers, footer messages stats persistées, actions copy/edit/regenerate, sendFromHistory(), toast erreur dismiss, markdown atom-one-dark, context menu global, HMR fix.

### Session 8 (2026-05-17) — UX polish, installeur natif, système MAJ
Conversations archivables, GPU sidebar, ThinkingBlock, Framer Motion, InstallerApp, UpdateBanner, benchmark, resource limits, HF token, export markdown, badge engine.

### Session 7 (2026-05-17) — Multi-venv vLLM, paths, migration, docs
vllm_manager.py, Settings/Engines, config_service, migration_service, PathsTab, MigrationBanner, engine_router routing par version, CompatBanner, Dialog.tsx, start.sh universel, OnboardingWizard.

### Sessions 1-6 (2026-05-15/16)
Design, dual-engine GGUF/AWQ, SQLite, MSW, scaffold frontend, llama-cpp CUDA, Tauri init, sidecar Python.
