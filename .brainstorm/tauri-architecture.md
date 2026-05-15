# EchoHub — Architecture Tauri v2
*2026-05-16*

## Stack cible

```
┌─────────────────────────────────────────────┐
│  Tauri v2 (Rust shell)                      │
│  ┌───────────────────────────────────────┐  │
│  │  WebView (React + TypeScript)         │  │
│  │  → MSW en dev, vrai WS en prod        │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  Python sidecar (FastAPI + WebSocket) │  │
│  │  → lié à 127.0.0.1 uniquement        │  │
│  │  → port aléatoire, injecté via Tauri  │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Sécurité (non-négociable)

### CSP Tauri strict
```json
{
  "security": {
    "csp": "default-src 'self'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' data: blob:; script-src 'self'"
  }
}
```
- Zéro connexion vers l'extérieur depuis la WebView
- WebSocket uniquement vers 127.0.0.1 (pas localhost, pas 0.0.0.0)
- Pas d'accès fichier système depuis JS (tout passe par Tauri commands)

### Python sidecar
- Bind sur `127.0.0.1` uniquement — jamais `0.0.0.0`
- Port aléatoire choisi par le sidecar au démarrage, communiqué via stdout
- Tauri lit le port depuis stdout et l'injecte dans la WebView via `window.__ECHOHUB_WS_PORT__`
- Pas d'auth token (loopback only = sécurisé par l'OS)

### Données utilisateur
- SQLite dans `app.path.appDataDir()` (Tauri API, cross-platform)
- Modèles dans `app.path.documentDir()/echohub-models` ou config custom
- Jamais de données dans le répertoire de l'app (pour pouvoir update sans tout perdre)

## WebSocket vs SSE

On remplace SSE par WebSocket pour :
- Bidirectionnel (stop génération, ping/pong, statuts)
- Plus naturel dans Tauri (pas de CORS, pas de fetch SSE)
- Performance légèrement meilleure pour le streaming token par token

Protocol simplifié :
```
Client → Server : { type: "chat", payload: { messages, params } }
Client → Server : { type: "stop" }
Server → Client : { type: "chunk", payload: { delta: "..." } }
Server → Client : { type: "done", payload: { stats: {...} } }
Server → Client : { type: "error", payload: { message: "..." } }
```

## Migration progressive

Phase 1 (maintenant) : MSW dans le frontend Vite existant
Phase 2 : `cargo tauri init` — WebView autour du frontend existant
Phase 3 : Remplacer fetch/SSE par WebSocket dans le frontend
Phase 4 : Python sidecar avec WebSocket
Phase 5 : Tauri commands pour les opérations fichier/système
Phase 6 : Packaging binaire cross-platform

## MSW — ordre de priorité des mocks

1. `/conversations` + `/conversations/:id/messages`
2. `/models/search` + `/models/info/:id`
3. `/models/downloaded`
4. `/inference/load` + `/inference/chat` (streaming simulé)
5. `/system/gpu`
6. `/settings/gpu-backend` + `/settings/hf-token`
