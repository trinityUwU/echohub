# STATE — EchoHub Design System
*Dernière mise à jour : 2026-05-16*

## Sujet actuel
Refonte complète du design d'EchoHub + migration Tauri v2.
Étape immédiate : MSW + nouveau design system avant tout branchement.

## Arborescence
- `STATE.md` — ce fichier
- `design-system.md` — identité visuelle, couleurs, typo, composants
- `tauri-architecture.md` — migration Tauri v2 + sidecar Python WebSocket

## Thèmes abordés
- Design "echo / goutte d'eau dans un océan" — translucent dark
- Layout LM Studio conservé mais repensé
- MSW comme couche de mock pour développer sans backend
- Migration Tauri v2 + Python sidecar + WebSocket streaming

## Décisions prises
- Nom conservé : **EchoHub**
- Dark theme obligatoire
- Translucidité comme signature visuelle (glassmorphism subtil, pas excessif)
- MSW en place avant tout redesign
- Tauri v2 après que le design soit validé
- API Python en WebSocket (pas SSE) pour le streaming IA

## Points en suspens
- Palette de couleurs exacte à valider (propositions dans design-system.md)
- Composants prioritaires à redesigner (sidebar, chat, browser)
- Validation du design system avant implémentation
