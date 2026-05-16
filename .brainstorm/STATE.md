# STATE — EchoHub Brainstorm
*Dernière mise à jour : 2026-05-16*

## Sujet actuel
Refonte complète du design + migration Tauri v2.

## Ce qui a été fait
- MSW en place et fonctionnel (VITE_MSW=true dans .env.development)
- Scaffold frontend existant (composants fonctionnels branchés sur MSW)
- App fonctionnelle avec données mockées
- GitHub : https://github.com/trinityUwU/echohub

## Décisions actées

### Design
- Tous les documents de design system existants ont été supprimés — ils produisaient des résultats inacceptables
- **Prochaine session** : refaire le design de zéro, nouvelle identité visuelle, nouveau système de composants

### Architecture
- Migration vers Tauri v2 en cours
- Python sidecar FastAPI en WebSocket (voir tauri-architecture.md)

## Fichiers restants
- `tauri-architecture.md` — architecture Tauri v2 + sidecar Python WebSocket

## Prochaines étapes (dans l'ordre)
1. **REFAIRE TOUT LE DESIGN** — nouvelle identité, nouveaux composants, nouveau système visuel
2. **Continuer la migration Tauri v2** — init Tauri, sidecar Python, WebSocket streaming
