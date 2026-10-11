# Ignis Capture

Chrome-extensie om snel notities in Obsidian op te slaan via [Ignis](https://github.com/Nystik-gh/ignis), gebaseerd op het [quicknote](https://github.com/s4ndyp/quicknote)-voorbeeld met extra ondersteuning voor **Notebook Navigator**-snelkoppelingen.

## Functies

- **Quick capture** — titel, inhoud, mapkeuze, tags uit de vault, taakregels
- **Ignis API** — direct naar je Ignis-server of via een Docker capture-proxy (`/ignis-api`)
- **Notebook Navigator** — snelkoppelingen in een modal; klik **haalt het Markdown-bestand op via Ignis** en toont het in een voorbeeld (modal of apart **Venster**). **↗** opent Ignis.

## Installatie

1. Clone deze repo.
2. Open `chrome://extensions` → **Ontwikkelaarsmodus** → **Uitgepakt laden** → kies de map `extension/`.
3. Open **Instellingen** van de extensie:
   - Ignis-URL en vault-naam (zoals in Ignis)
   - Standaard inbox-map
   - Optioneel: Notebook Navigator vault-profiel-ID (leeg = actief profiel in `data.json`)
4. Keur **host-permissie** goed voor je Ignis-URL. Bij self-signed TLS: open Ignis eerst in een normale tab en vertrouw het certificaat.

## Vereisten

- Ignis met toegankelijke `/api/fs/*`- endpoints
- Obsidian-vault met **Notebook Navigator** voor snelkoppelingen (plugin-id `notebook-navigator`)

## Ontwikkeling

De extensie is plain ES modules (Manifest V3), geen build-stap.

```text
extension/
  manifest.json
  popup.html / popup.js
  ignis-client.js
  notebook-navigator.js
  shortcut-opener.js
  …
```
