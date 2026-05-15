# EchoHub — Design System
*2026-05-16*

## Vision

> "comme une goute d'eau dans un océan" — translucent, dark, épuré

L'identité d'EchoHub c'est l'**écho** : une perturbation qui se propage en cercles concentriques sur une surface sombre et profonde.
Pas de couleurs vives. Pas de gradients agressifs. Juste de la profondeur, de la transparence, et des ondes très subtiles.

---

## Palette de couleurs

### Base — profondeur océanique
```
--bg-base:        #07090f   ← fond absolu, quasi-noir bleuté
--bg-1:           #0d1117   ← surfaces principales
--bg-2:           #121820   ← surfaces secondaires
--bg-3:           #1a2130   ← surfaces tertiaires / hover
--bg-glass:       rgba(13, 17, 23, 0.7)   ← surfaces translucides
--bg-glass-light: rgba(26, 33, 48, 0.5)   ← translucide plus claire
```

### Borders
```
--border:         rgba(255, 255, 255, 0.06)  ← très discret
--border-hover:   rgba(255, 255, 255, 0.12)
--border-focus:   rgba(99, 179, 237, 0.40)   ← bleu eau au focus
```

### Accent — l'écho (bleu eau profonde)
```
--accent:         #4A9EBF   ← bleu-cyan désaturé, comme l'eau profonde
--accent-dim:     #3A7A96
--accent-glow:    rgba(74, 158, 191, 0.15)  ← halo diffus
--accent-ring:    rgba(74, 158, 191, 0.30)
```

### Text
```
--text-primary:   rgba(255, 255, 255, 0.90)
--text-secondary: rgba(255, 255, 255, 0.55)
--text-muted:     rgba(255, 255, 255, 0.30)
--text-disabled:  rgba(255, 255, 255, 0.18)
```

### Sémantiques
```
--success:        #3D9E6E  ← vert désaturé
--warning:        #B8860B  ← amber foncé
--error:          #C0473A  ← rouge brique
--info:           #4A9EBF  ← même que accent
```

### Capability badges (désaturés, cohérents)
```
--cap-vision:     rgba(56, 189, 248, 0.15)  text: #7DD3F7  ← bleu clair
--cap-thinking:   rgba(167, 139, 250, 0.15) text: #C4B5FD  ← violet doux
--cap-code:       rgba(52, 211, 153, 0.15)  text: #6EE7B7  ← vert menthe
--cap-tools:      rgba(251, 191, 36, 0.15)  text: #FCD34D  ← ambre clair
--cap-multi:      rgba(251, 146, 60, 0.15)  text: #FCA97A  ← orange doux
```

---

## Typographie

**Interface** : `'Inter Variable'` ou `'Geist'` — propre, lisible, moderne
**Monospace** : `'JetBrains Mono'` ou `'Geist Mono'` — code, stats, IDs

Tailles :
```
xs:   11px / line-height 1.4
sm:   12px / line-height 1.5  ← labels, metadata
base: 13px / line-height 1.6  ← corps principal
md:   14px / line-height 1.6  ← titres secondaires
lg:   16px / line-height 1.4  ← titres
xl:   20px / line-height 1.3  ← grand titre
```

---

## Effets signature

### Glassmorphism (subtil, pas excessif)
```css
backdrop-filter: blur(12px) saturate(180%);
background: var(--bg-glass);
border: 1px solid var(--border);
```
Utilisé sur : sidebar, modals, panels flottants, topbar

### Echo ring (accents animés)
Au survol ou au focus d'un élément important :
```css
box-shadow: 0 0 0 1px var(--accent-ring), 0 0 20px var(--accent-glow);
```
Subtil. Juste un halo. Comme une onde qui s'estompe.

### Surfaces
Pas de `border-radius` uniforme — variation intentionnelle :
- Cards : `rounded-xl` (12px)
- Inputs : `rounded-lg` (8px)
- Chips/badges : `rounded-md` (6px)
- Boutons principaux : `rounded-xl`
- Modals : `rounded-2xl` (16px)

### Transitions
Toutes à `duration-150` avec `ease-out` — snappy, pas mou.
Pas d'animations flamboyantes. L'écho se propage vite, il ne s'attarde pas.

---

## Layout général (LM Studio)

```
┌─────────────────────────────────────────────────────┐
│ TopBar (h-11) — modèle chargé, stats GPU, actions   │
├──────────┬──────────────────────────────────────────┤
│ Sidebar  │                                          │
│ (w-52)   │         Main Area                        │
│          │                                          │
│ Nav      │  Browse / Chat / Settings                │
│ Library  │                                          │
│ ──────   │                                          │
│ GPU Mon  │                                          │
└──────────┴──────────────────────────────────────────┘
```

La sidebar est **translucide** — le fond de l'app transparaît légèrement.
Le main area a le fond le plus sombre (`--bg-base`).
La topbar est translucide avec un très léger blur.

---

## Composants prioritaires à redesigner

1. **TopBar** — modèle chargé, GPU bar inline, boutons
2. **Sidebar** — navigation, library, GPU monitor
3. **ModelBrowser** — split panel, liste, détail
4. **ChatPanel** — messages, input, thinking block
5. **Settings** — HF token, GPU backend
6. **Modals** — LoadConfig, ModelPicker, SaveProfile

---

## Ce qu'on évite

- Gradients violets/roses (trop "AI startup générique")
- Néon vert (trop hacker)
- Blanc pur comme fond (jamais)
- Animations trop longues (> 300ms pour l'UI)
- Glassmorphism excessif (blur sur tout = illisible)
- Couleurs accent trop saturées (cyan électrique → non)
