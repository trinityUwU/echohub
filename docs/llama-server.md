# Backend `llama_server` — llama.cpp piloté en process externe

Troisième moteur d'inférence d'EchoHub, à côté de `llama` (llama-cpp-python
in-process) et `vllm`. Il pilote le binaire `llama-server` de llama.cpp comme un
process externe et proxifie les requêtes vers son endpoint OpenAI-compatible.

## Pourquoi

llama-cpp-python n'expose ni `n_cpu_moe` ni `tensor_buft_overrides` : l'offload
d'experts MoE est impossible in-process. Mesuré sur Qwen3.6-35B-A3B Q4_K_M :

| Chemin | Débit |
|---|---|
| llama-cpp-python 0.3.23 + unified memory | 1,59 tok/s |
| binaire llama-server (`--n-cpu-moe 30`) | 25,54 tok/s |
| **EchoHub → backend `llama_server`** | **24,39 tok/s** (mesuré 2026-07-31) |

## Le binaire

Résolution, par ordre de priorité :

1. variable d'environnement `ECHOHUB_LLAMA_SERVER_BIN`
2. clé `llama_server_bin` dans `~/.local/share/echohub/config.json`
3. défaut `~/.unsloth/llama.cpp/build-cuda/bin/llama-server`
4. `llama-server` trouvé dans le `PATH`

Le défaut vit dans un dossier appartenant à unsloth — emplacement fragile, d'où
l'override. Le `llama-server` de `~/.unsloth/llama.cpp/build/bin/` est compilé
**sans support GPU** : ne pas le pointer.

Au démarrage, `GET /inference/llama-server/status` renvoie un diagnostic complet
(chemin, exécutabilité, présence d'un device CUDA, version, message d'erreur
explicite). Le moteur n'apparaît dans `available_engines` que si le binaire est
présent **et** rapporte un device CUDA.

### Rebuild d'une version CUDA

```bash
git clone https://github.com/ggml-org/llama.cpp ~/llama.cpp
cd ~/llama.cpp
cmake -B build-cuda -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=86   # 86 = RTX 3060
cmake --build build-cuda --config Release -j "$(nproc)" --target llama-server
export ECHOHUB_LLAMA_SERVER_BIN=~/llama.cpp/build-cuda/bin/llama-server
```

Vérification : `llama-server --list-devices` doit lister au moins un `CUDA0`.

## Routing

`engine_router` choisit le chemin GGUF ainsi :

- `engine: "llama_server"` dans `POST /inference/load` → forcé (erreur explicite
  si le binaire est indisponible) ;
- `engine: "llama"` → forcé sur l'in-process ;
- rien de spécifié et `is_moe: true` → **auto-routé** vers `llama_server` si le
  binaire est disponible (sinon fallback in-process avec un warning) ;
- sinon → in-process, comportement historique inchangé.

## Paramètres

Configurables par modèle via `POST /inference/load`, persistés en DB
(`app_state`, clé `llama_server_cfg:<model_id>`) et réutilisés au chargement
suivant.

| Champ | Défaut dense | Défaut MoE | Flag llama-server |
|---|---|---|---|
| `n_cpu_moe` | 0 | 30 | `--n-cpu-moe` |
| `n_gpu_layers` | 99 | 99 | `-ngl` |
| `n_ctx` | 8192 | 32768 | `-c` |
| `threads` | 6 | 6 | `-t` |
| `cache_type_k` / `cache_type_v` | q8_0 | q8_0 | `--cache-type-k/v` |
| `flash_attn` | true | true | `-fa on` |
| `n_batch` | — | — | `-b` |

Toujours ajoutés : `--jinja` (chat template du GGUF + tool calls natifs) et
`--reasoning-format none` (le `<think>` reste dans `message.content`, comme sur
le chemin in-process — le frontend parse les balises lui-même).

Exemple, profil MoE validé :

```bash
curl -X POST localhost:37821/inference/load -H 'Content-Type: application/json' -d '{
  "model_id":"unsloth/Qwen3.6-35B-A3B-GGUF","engine":"llama_server",
  "is_moe":true,"n_ctx":32768,"n_cpu_moe":30,"threads":6}'
```

## Exploitation

- port : **37824** (vLLM 37823, backend EchoHub 37821)
- log : `logs/llama-server.log` (réécrit à chaque chargement)
- PID : `/tmp/echohub_llama_server.pid`, nettoyé au démarrage du backend
- arrêt : `POST /inference/unload`, `atexit`, ou lifespan FastAPI

## llama_lock

Ce chemin **ne prend pas** le mutex global `llama_lock`. Ce verrou existe parce
que llama.cpp partage un état C dans le process Python ; un process externe a son
propre espace mémoire, et llama-server sérialise déjà ses slots. Le prendre
sérialiserait inutilement les requêtes et coupleraient deux moteurs qui ne
partagent rien. Les chemins existants le conservent.
