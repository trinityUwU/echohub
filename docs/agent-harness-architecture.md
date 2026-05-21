# Agent Harness Architecture — Multi-Agent System with Universal Validation

## Concept fondamental

L'approche classique (SmallCode, OpenCode) met le harness *autour* du modèle principal.
Cette architecture met le harness *dans* des modèles sacrifiables à vie courte — le modèle principal reste l'orchestrateur conversationnel.

---

## Architecture globale

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATEUR                                │
│              modèle principal, contexte long                    │
│         — parle UNIQUEMENT avec l'user —                        │
│         — ne touche JAMAIS aux fichiers —                       │
└──────┬──────────────────┬──────────────────┬───────────────────┘
       │ brief précis      │ brief précis      │ brief précis
       ▼                   ▼                   ▼
┌────────────┐    ┌────────────┐    ┌────────────┐
│ SUB-AGENT  │    │ SUB-AGENT  │    │ SUB-AGENT  │
│  task A    │    │  task B    │    │  task C    │
│            │    │            │    │            │
│  HARNESS   │    │  HARNESS   │    │  HARNESS   │
│  fort      │    │  fort      │    │  fort      │
└─────┬──────┘    └─────┬──────┘    └─────┬──────┘
      │ output           │ output           │ output
      └──────────────────┴──────────────────┘
                         │ résultats structurés
                         ▼
                  ORCHESTRATEUR
              consolide + répond user
```

---

## Invocation des sub-agents — Recursive Tool Calling

Le sub-agent n'est PAS un nouveau process ni un nouveau modèle chargé.
C'est une nouvelle inférence sur le même modèle déjà en VRAM, via un tool `invoke_agent`.

```
ORCHESTRATEUR
│
│  détecte : "j'ai besoin de lire 3 fichiers"
│
├── tool call → invoke_agent({
│     task: "lire /src/auth.py et extraire les fonctions publiques",
│     harness: "read_strict"
│   })
│
│   ┌─────────────────────────────────────────────┐
│   │  MÊME MODÈLE — nouvelle inférence vLLM      │
│   │  system prompt : sub-agent read             │
│   │  contexte : JUSTE le brief                  │
│   │  tools : find, read, grep (harness fort)    │
│   │  → fait son travail                         │
│   │  → retourne : { summary, findings, status } │
│   └─────────────────────────────────────────────┘
│
│  reçoit le résultat structuré
│  continue la conversation
```

**Implémentation vLLM :**
`invoke_agent` = POST `/v1/chat/completions` avec system prompt isolé.
Zéro reload, requêtes parallélisables, contexte parent jamais exposé.

### Contrat de retour du sub-agent

```json
{
  "status": "success | partial | failed",
  "summary": "...",
  "findings": {},
  "actions_taken": [],
  "confidence": 0.9
}
```

L'orchestrateur ne voit jamais les 200 lignes lues, les retries, les stack traces.
Il voit uniquement le `summary`. Son contexte reste propre indéfiniment.

---

## Compound Tools — Pourquoi les tool calls séquentiels tuent les petits modèles

```
APPROCHE CLASSIQUE
──────────────────
Tour 1 : modèle → find_file("auth.py")       → résultat
Tour 2 : modèle → read_file("/src/auth.py")  ← doit se souvenir du tour 1
Tour 3 : modèle → edit_file(patch)           ← doit se souvenir des tours 1+2
Tour 4 : modèle → run_tests()               ← doit se souvenir des tours 1+2+3

Chaque tour = nouveau raisonnement sur un contexte qui grossit.
Modèle 4-8B → attention window saturée → hallucinations → tool call raté.


APPROCHE COMPOUND
──────────────────
Tour 1 : modèle → code_action({
           pattern: "auth.py",
           edit: "...",
           verify: true
         })
         harness exécute find+read+edit+verify EN INTERNE

Le modèle fait UN choix, le harness fait le travail séquentiel.
Charge cognitive : divisée par 4.
```

---

## Universal Harness — Pipeline de validation

S'intercale sur **toute** mutation de fichier, automatiquement.

```
file event (edit / create / delete)
         │
         ▼
LANGUAGE DETECTOR
extension + shebang + content sniffing
.py → Python    .ts/.tsx → TypeScript    .rs → Rust
.go → Go        .c/.cpp → C/C++          .sh → Bash
         │
         ▼
VALIDATION PIPELINE

  LAYER 1 — SYNTAX
    Python : ast.parse()       TS : tsc --noEmit
    Rust   : rustc             Go : go vet
    C      : clang -fsyntax-only
    → erreur ligne X : message exact

  LAYER 2 — LINT / STYLE
    Python : ruff              TS : eslint
    Rust   : clippy            Go : golangci-lint
    Shell  : shellcheck
    → warnings avec severity

  LAYER 3 — TYPES
    Python : mypy / pyright    TS : tsc strict
    Rust   : borrow checker (inclus layer 1)
    → type errors avec context

  LAYER 4 — TESTS (si détectés)
    pytest / bun test / cargo test / go test
    → uniquement tests liés aux fichiers modifiés (dependency graph)
    → pas full suite à chaque edit
         │
         ▼
RESULT NORMALIZER
```

### Output normalisé

```json
{
  "file": "src/auth.py",
  "language": "python",
  "layers": {
    "syntax":  { "ok": true,  "errors": [] },
    "lint":    { "ok": false, "warnings": [
                  { "line": 42, "rule": "E501",
                    "msg": "line too long",
                    "severity": "warning" }
                ]},
    "types":   { "ok": true,  "errors": [] },
    "tests":   { "ok": true,  "passed": 12, "failed": 0 }
  },
  "overall": "warning",
  "actionable": [
    "line 42: line too long (120 chars max)"
  ]
}
```

`overall` : `ok` | `warning` | `error` | `fatal`

---

## Zéro faux positif — Règles d'isolation

**Règle 1 — Isolation des checks**
Chaque layer tourne dans un subprocess isolé avec timeout.
Un linter qui hang ne bloque pas le pipeline.

**Règle 2 — Dependency graph pour les tests**
On ne run PAS tous les tests à chaque edit.
On calcule quels tests importent le fichier modifié.
- Python : `modulefinder`
- TS : `madge`
- Go : `go list -deps`

**Règle 3 — Severity threshold configurable**
Par projet via `.harness.yml` à la racine :

```yaml
lint_severity: warning     # warning | error | off
types_severity: error
tests_severity: fatal
timeout_per_layer: 10s
diff_aware: true           # analyse uniquement les lignes changées
```

**Règle 4 — Diff-aware**
On analyse uniquement les lignes changées pour le lint.
Zéro alert sur du code pré-existant non touché. Zéro bruit parasite.

---

## Intégration dans le flow sub-agent

```
sub-agent édite un fichier
         │
         ▼
harness intercepte automatiquement (synchrone, bloquant)
         │
    résultat injecté dans le contexte du sub-agent
    AVANT que le sub-agent puisse continuer
         │
    sub-agent voit exactement :
    "line 42 — TypeError: expected str, got int"
    et corrige
         │
    sub-agent retourne à l'orchestrateur
    SEULEMENT si overall = "ok" ou "warning" accepté
         │
    max 5 retries → escalade à l'orchestrateur si fatal
```

Le sub-agent ne peut pas "oublier" de vérifier.
Le harness est une contrainte système, pas une option.

---

## Stack cible Echo Hub

| Composant | Implémentation |
|-----------|---------------|
| Modèle | Qwen3 8B AWQ — déjà en VRAM |
| Serving | vLLM local |
| invoke_agent | POST /v1/chat/completions — contexte isolé |
| Harness | subprocess par layer, timeout 10s |
| Dependency graph | modulefinder / madge selon langage |
| Config par projet | `.harness.yml` à la racine |

---

## Priorité d'implémentation

1. `invoke_agent` tool — recursive call sur vLLM local
2. Language detector — extension + shebang sniffing
3. Validation pipeline layer 1+2 (syntax + lint) — couverture 80% des erreurs
4. Result normalizer + injection contexte
5. Layer 3 (types) + Layer 4 (tests) + dependency graph
6. `.harness.yml` per-project config
