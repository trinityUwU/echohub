# Plan d'intégration — Multi-node Cluster

*Rédigé : 2026-05-21 — Statut : backlog (pas de priorité immédiate)*

## Objectif

Permettre à EchoHub de fusionner la puissance GPU de plusieurs serveurs pour faire tourner des modèles qui dépassent la VRAM d'un seul nœud, ou pour augmenter le throughput. Cas d'usage principal : entreprise avec 2 serveurs × 5× H100 = 800 GB VRAM total → Llama 405B ou DeepSeek V3 en local.

La feature est **optionnelle et additive** : si aucun cluster n'est configuré, EchoHub se comporte exactement comme aujourd'hui.

---

## Architecture globale

```
┌─────────────────────────────────────────────────────────┐
│                    RÉSEAU LOCAL                         │
│                                                         │
│  ┌─────────────────┐         ┌─────────────────┐        │
│  │   EchoHub #1    │◄───────►│   EchoHub #2    │        │
│  │   (head node)   │  Ray    │   (worker node) │        │
│  │   5x H100       │  cluster│   5x H100       │        │
│  │   port 8080     │         │   port 8080     │        │
│  └────────┬────────┘         └─────────────────┘        │
│           │                                             │
│  ┌────────▼────────┐                                    │
│  │  Open WebUI /   │                                    │
│  │  EchoHub UI     │                                    │
│  │  (utilisateurs) │                                    │
│  └─────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

**Rôles :**
- **Head node** : reçoit les requêtes, orchestre Ray, expose l'UI
- **Worker node** : contribue ses GPUs au cluster, pas d'UI exposée nécessaire
- Un nœud peut switcher de rôle sans réinstaller

---

## Nouveaux fichiers à créer

### `backend/services/cluster_discovery.py`

Découverte automatique sur le LAN via UDP broadcast.

```
- broadcast_presence(port) → émet UDP pour signaler ce nœud
- listen_for_peers(timeout) → écoute les broadcasts, retourne liste d'IPs
- ping_echohub(ip, port) → vérifie qu'un EchoHub répond sur cette IP
```

Protocole : UDP broadcast port 37824, payload JSON :
```json
{"echohub": true, "version": "x.x", "gpus": 5, "role": "head|worker|standalone"}
```

### `backend/services/cluster_service.py`

Cycle de vie du cluster Ray + stratégie de parallélisme.

```
- get_cluster_status() → ClusterStatus
- start_as_head(port) → bool
- start_as_worker(head_ip, head_port) → bool
- stop_cluster() → bool
- get_cluster_nodes() → list[NodeInfo]
- get_total_vram() → int
- measure_bandwidth(target_ip) → float  (GB/s, via iperf3 si dispo)
- is_cluster_active() → bool
- get_current_strategy() → ParallelismStrategy
- recommend_parallelism_strategy(bandwidth_gbps, gpu_count) → ParallelismStrategy
```

Logique `recommend_parallelism_strategy` :
| Bande passante | Stratégie |
|----------------|-----------|
| < 2 GB/s | pipeline only, tensor=1 |
| 2–8 GB/s (10GbE) | tensor ≤ 4 par nœud, pipeline entre nœuds |
| 8–20 GB/s (25/40GbE) | tensor mixte |
| > 20 GB/s (InfiniBand) | full tensor parallel |

### `backend/routers/cluster.py`

```
GET  /cluster/status        → état complet (nodes, GPUs, VRAM totale, mode)
POST /cluster/start-head    → démarre ce nœud comme head {port: int}
POST /cluster/join          → rejoint un head {head_ip, head_port}
POST /cluster/leave         → quitte le cluster proprement
GET  /cluster/discover      → scan UDP LAN pour trouver d'autres EchoHub
GET  /cluster/bandwidth     → mesure bande passante vers chaque nœud connu
GET  /cluster/strategy      → stratégie de parallélisme recommandée
```

### `frontend/src/hooks/useCluster.ts`

```typescript
// État
clusterStatus: ClusterStatus | null
isInCluster: boolean
totalVram: number
nodes: NodeInfo[]
strategy: ParallelismStrategy | null

// Actions
startAsHead()
joinCluster(ip: string, port: number)
leaveCluster()
discoverNodes()
refreshStatus()
```

Polling `/cluster/status` toutes les 5s si cluster actif.

### `frontend/src/components/settings/ClusterTab.tsx`

UI Settings — onglet Cluster :

```
┌─ CLUSTER STATUS ─────────────────────────────────────┐
│  ● Standalone  /  ◉ Head Node  /  ◉ Worker Node      │
│                                                       │
│  Nœuds connectés : 2                                  │
│  GPUs totaux : 10 × H100 (800 GB VRAM)                │
│  Réseau : 25 GbE — Tensor Parallel recommandé         │
└───────────────────────────────────────────────────────┘

┌─ NODES ───────────────────────────────────────────────┐
│  ◉ 192.168.1.10 (ce nœud)  5× H100  HEAD    ● online │
│  ◉ 192.168.1.11             5× H100  WORKER  ● online │
│  + Add node manually                                  │
└───────────────────────────────────────────────────────┘

┌─ PARALLELISM STRATEGY ───────────────────────────────┐
│  ● Auto (recommandé)                                  │
│  ○ Manuel : tensor=__ pipeline=__                     │
│                                                       │
│  Actuellement : tensor-parallel=10, pipeline=1        │
│  Raison : InfiniBand détecté (24 GB/s)               │
└───────────────────────────────────────────────────────┘

┌─ DISCOVERY ──────────────────────────────────────────┐
│  [Scan réseau]  Dernière scan : il y a 2 min         │
│  192.168.1.11 — EchoHub v0.8, 5× H100 — [Add]       │
└───────────────────────────────────────────────────────┘
```

---

## Fichiers existants à modifier

### `backend/services/vllm_service.py`

Dans `load_model_async` — injecter les flags Ray si cluster actif :

```python
if cluster_service.is_cluster_active():
    strategy = cluster_service.get_current_strategy()
    cmd += ["--distributed-executor-backend", "ray"]
    cmd += ["--tensor-parallel-size", str(strategy.tensor_parallel_size)]
    if strategy.pipeline_parallel_size > 1:
        cmd += ["--pipeline-parallel-size", str(strategy.pipeline_parallel_size)]
# sinon : comportement actuel inchangé
```

Si cluster actif : `gpu_memory_utilization` calculé sur VRAM totale agrégée, pas juste locale.

### `backend/services/multi_gpu.py`

Ajouter `get_cluster_gpu_config()` qui fusionne GPUs locaux + nœuds Ray distants.

### `backend/main.py`

- Enregistrer le router cluster
- Dans lifespan : démarrer le broadcaster UDP si `cluster.enabled = true` dans config

### `backend/routers/models.py`

Endpoint `/models/vram-preview` — si cluster actif, utiliser `get_cluster_gpu_config().total_vram_mb`.

### `frontend/src/components/settings/SettingsPage.tsx`

Ajouter onglet `ClusterTab` entre EnginesTab et PathsTab.

### `frontend/src/installer/InstallerApp.tsx`

Étape Hardware (step 3) — section cluster optionnelle :

```
┌─ CLUSTER (optionnel) ────────────────────────────────┐
│  2 autres EchoHub détectés sur votre réseau           │
│  192.168.1.11 — 5× H100                              │
│                                                       │
│  ○ Utiliser uniquement ce serveur                     │
│  ● Créer un cluster (ce serveur = head node)          │
│  ○ Rejoindre un cluster existant → [IP du head]       │
└───────────────────────────────────────────────────────┘
```

### `frontend/src/hooks/useGpu.ts`

Exposer `totalClusterVram` alimenté par `useCluster`, en plus du VRAM local.

---

## Nouveaux schémas Pydantic

À ajouter dans `backend/models/schemas.py` :

```python
class NodeInfo(BaseModel):
    ip: str
    port: int
    role: Literal["head", "worker"]
    gpu_count: int
    gpus: list[GpuInfo]
    vram_total_mb: int
    status: Literal["online", "offline", "degraded"]
    latency_ms: float | None
    bandwidth_gbps: float | None

class ParallelismStrategy(BaseModel):
    tensor_parallel_size: int
    pipeline_parallel_size: int
    rationale: str
    auto: bool

class ClusterStatus(BaseModel):
    active: bool
    role: Literal["head", "worker", "standalone"]
    nodes: list[NodeInfo]
    total_gpus: int
    total_vram_mb: int
    strategy: ParallelismStrategy | None
    network_type: Literal["infiniband", "25gbe", "10gbe", "1gbe", "unknown"] | None
```

---

## Persistence config

Dans `~/.local/share/echohub/config.json` (via `config_service.py`) :

```json
{
  "cluster": {
    "enabled": false,
    "role": "standalone",
    "head_ip": null,
    "head_port": 6379,
    "auto_parallelism": true,
    "tensor_parallel_override": null,
    "pipeline_parallel_override": null
  }
}
```

Au démarrage : si `enabled = true` et `role = worker` → rejoindre le head automatiquement.

---

## Dépendances à ajouter

**Backend :**
- `ray[default]` — pip install dans le venv backend

**Système (optionnel) :**
- `iperf3` — mesure de bande passante précise. Détecté au runtime, fallback estimation si absent.

**Frontend :** aucune nouvelle dépendance.

---

## États dégradés

| Situation | Comportement |
|-----------|-------------|
| Nœud worker déconnecté | Toast warning, continue avec GPUs restants, re-balance auto |
| Ray crash | Fallback single-node transparent, log l'événement |
| Bande passante < 1 GB/s | Warning dans ClusterTab, stratégie forcée pipeline-only |
| Ray non installé | Bouton "Install Ray" dans ClusterTab avec SSE stream |
| Versions Ray incompatibles | Erreur explicite avec version de chaque nœud |

---

## Ordre d'implémentation

1. Schémas Pydantic (`schemas.py`)
2. `cluster_discovery.py` — UDP broadcast, testable seul
3. `cluster_service.py` — logique Ray + `recommend_parallelism_strategy`
4. `backend/routers/cluster.py` — endpoints
5. `backend/main.py` — enregistrement router + lifespan
6. Modifications `vllm_service.py`
7. Modifications `multi_gpu.py`
8. `useCluster.ts`
9. `ClusterTab.tsx`
10. `SettingsPage.tsx` — ajout onglet
11. `InstallerApp.tsx` — étape hardware enrichie
12. `useGpu.ts` — exposer VRAM cluster

---

## Ce qui ne change pas

- Flow llama.cpp (GGUF) — Ray ne supporte que vLLM, GGUF reste single-node
- Fine-tuning, MCP, conversations, Discover, Library
- Single-node multi-GPU existant
- API OpenAI-compatible de vLLM — les clients existants continuent de fonctionner
