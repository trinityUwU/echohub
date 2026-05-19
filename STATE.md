# STATE — EchoHub
*Dernière mise à jour : 2026-05-19 (session 17)*

## Résumé de l'état actuel

Application Tauri v2 native complète. Pipeline fine-tuning Unsloth QLoRA end-to-end validé. Support MoE (Qwen3-30B-A3B RTX 3060). MTP détecté et badgé. Vision GGUF via mmproj auto-détecté. Reload model depuis le footer de chaque message. Badges capabilities uniformes dans toute l'UI. Clipboard image paste fonctionnel sur Wayland. vLLM compat check et max_tokens overflow fixés. Skills Claude Code installés : /humanizer, /prompt-architect. Pushé sur GitHub.

## Ce qui a été fait — session 17 (2026-05-19)

### Skills Claude Code
- `/humanizer` installé (`~/.claude/skills/humanizer/`) — humanisation docs/posts obligatoire
- `/prompt-architect` installé (`~/.claude/skills/prompt-architect/`) — 27 frameworks RISEN/ReAct/etc.
- Règles session-awareness mises à jour : humanisation obligatoire docs/posts, prompt-architect silencieux par défaut

### Documentation humanisée
- README.md, docs/v0.1 à v0.4 : suppression patterns AI (inline bold headers, em dashes, Title Case)

### MTP (Multi-Token Prediction)
- `gguf_utils.detect_mtp()` : scan binaire GGUF pour tenseurs `blk.N.nextn.*`
- `gguf_utils.find_mmproj()` + `detect_vision_handler()` : détection mmproj + handler par nom modèle
- `ModelInfo.has_mtp` populé binaire (local) + heuristique nom/tag (Discover)
- Badge cyan "MTP" dans ModelCard, ModelPickerModal, ModelDetailPanel, ChatTopBar, LoadModelModal
- Export fine-tune : rapporte `MTP_DETECTED:true/false` dans SSE done event
- docs/v0.5-mtp.md créé

### Vision llama.cpp
- `engine_router` : détecte mmproj au load, passe à `llama_service`
- `llama_service` : charge `chat_handler` (Qwen25VL, Llava15/16, MiniCPM, Llama3Vision…) si mmproj présent
- Fallback text-only silencieux si handler échoue
- `inference.py` : strip `image_url` parts pour modèles sans vision → évite réponse vide
- Vision badge ground truth : visible seulement si mmproj présent sur disque

### Badges capabilities
- ModelPickerModal : badges inline sous le nom (quant, MoE, MTP, thinking, vision)
- LoadModelModal : badges sous le nom avant chargement
- ChatTopBar : quant + MTP à côté du badge engine
- ModelDetailPanel : MTP ajouté
- Fix détection vision : `image-text-to-text` pipeline_tag HF reconnu + passé à `_detect_capabilities`

### Reload model depuis footer
- `messages.load_config TEXT` : colonne ajoutée (migration auto au démarrage)
- `llama_service._load_config` + `vllm_service._load_config` : params stockés au chargement
- `engine_router.get_load_state()` : retourne `load_config` complet
- `useChat.ts` : capture snapshot au clic "Send", persiste avec le message
- `MessageRow` : bouton reload si `loadedModelId !== message.loadConfig.model_id` ou pas de modèle
- Fallback pour anciens messages : utilise `stats.model_name` + `stats.engine`
- Résolution nom court → HF id via liste downloaded

### Clipboard image paste Wayland
- `read_clipboard_image` commande Tauri Rust (arboard + wl-paste subprocess)
- Sur Wayland : `wl-paste --list-types` + `wl-paste --type image/png` → base64 → FileList
- Sur X11 : arboard fallback
- Guard `if (!visionEnabled) return` supprimé dans `handlePaste`

### vLLM fixes
- Compat check : import direct `vllm` → subprocess via `get_default_python()` (356 archs détectées)
- `max_tokens` overflow : clipper à `max_model_len - estimated_prompt_tokens` avant envoi
- Erreur 400 : `json.dumps` pour SSE payload (évite JSON cassé si message contient des guillemets)

### Image lightbox
- Clic miniature → overlay plein écran (Framer Motion fade+scale, fond noir/blur)
- Fermeture clic extérieur ou croix

### Reddit
- 1 commentaire posté (2026-05-19) : thread llama.cpp MTP improvements, params RTX 3060

## Décisions prises

| Décision | Raison | Date |
|---|---|---|
| wl-paste subprocess pour clipboard Wayland | arboard échoue silencieusement sur Wayland ; wl-clipboard déjà installé | 2026-05-19 |
| Strip image_url pour modèles sans vision | llama.cpp sans chat_handler retourne vide sur contenu multimodal | 2026-05-19 |
| load_config capturé au clic Send (pas après stream) | Modèle peut changer pendant le stream | 2026-05-19 |
| Fallback stats.model_name pour anciens messages | Messages pré-feature n'ont pas load_config mais ont stats | 2026-05-19 |
| Vision badge ground truth = mmproj présent sur disque | pipeline_tag HF pas fiable (ex: Qwen3.5-9B taggé image-text-to-text sans vision) | 2026-05-19 |

## Contexte non-évident

- **Wayland clipboard** : GDK warnings UTF8_STRING sont normaux et inévitables, ils n'affectent pas le fonctionnement. wl-paste doit être dans PATH.
- **Vision GGUF** : seuls les repos HF qui incluent un `mmproj-*.gguf` supportent la vision. La plupart des fine-tunes et GGUF conversions simples ne l'ont pas. Exemple fonctionnel : `bartowski/Qwen2-VL-7B-Instruct-GGUF`.
- **MTP** : actif automatiquement si tenseurs présents. Pas de param à passer. Gain réel sur RTX 3060 : ~35 → 50-60 tok/s sur 9B Q4_K_M.
- **vLLM isolated venv** : JAMAIS importer vllm directement dans le process backend. Toujours subprocess via `get_default_python()`. Même règle pour `ModelRegistry.get_supported_archs()`.
- **arboard + Wayland** : arboard 3 nécessite wl-clipboard pour le clipboard Wayland mais ne fail pas proprement sans lui — retourne None silencieusement.
- **load_config résolution nom court** : `stats.model_name` est tronqué ("Qwen3.5-9B-Claude-4.6-Op..."). La résolution cherche dans `downloaded` par prefix match.

## Prochaines étapes

1. **MTP natif** — activer flag `--draft` ou équivalent quand tenseurs présents pour perf maximale (à valider si llama-cpp-python 0.3.23 le supporte)
2. **Post Reddit/HN lancement** — matériel prêt, rédiger avec Chris
3. **Karma Reddit** — objectif 200 commentaires avant lancement (~28 juin 2026)
4. **Upgrader llama-cpp-python** — tester chargement GGUFs fine-tunés dans Chat
5. **Packaging AppImage/.deb** — avant lancement public
6. **Fix ~ indicateur** — race condition liveTokens/streaming

## Points en suspens

- MTP : gain théorique confirmé, gain mesuré dans EchoHub à valider
- llama-cpp-python v0.3.23 bloque chargement GGUFs Unsloth fine-tunés → upgrade via Settings
- `~` indicateur reste après stream (race condition mineure)
- OOM kernel SIGKILL non détectable

## Historique

### Session 17 (2026-05-19) — Vision, MTP, UX polish, reload model, clipboard Wayland
Skills humanizer + prompt-architect. Docs humanisées. MTP détection + badge. Vision llama.cpp (mmproj). Badges capabilities partout. Reload model depuis footer. Clipboard Wayland (wl-paste). vLLM compat fix. Image lightbox. Voir docs/v0.6-vision-mtp-ux.md.

### Session 16 (2026-05-19) — MoE support
Support MoE (Qwen3-30B-A3B RTX 3060), badge amber, LoadModal auto-fill, llama_service n_batch=128 + no_perf.

### Sessions 13-15 (2026-05-19) — Fine-tune pipeline complet
Section Fine-tune complète, Unsloth QLoRA, export GGUF, eval before/after, pipeline asyncio.Task. Voir docs/v0.4-finetune.md.

### Session 12 (2026-05-18) — Stats + context bar + OOM
Stats TTFT/engine/model_name persistées, barre contexte, détection OOM, fix régénération.

### Sessions 1-11 (2026-05-15/16/17)
Design, dual-engine, SQLite, UX polish, vLLM multi-venv, InstallerApp, benchmark qualité.
