# All Access

Hub de jeux local pour Windows : bibliothèque unifiée **Steam, Xbox / Game Pass, Epic, Ubisoft, Rockstar, Microsoft Store**, succès, amis, messages, téléchargements, overlay en jeu et bascule HDR.

## Télécharger

Va dans **[Releases](../../releases/latest)** et télécharge `All Access Setup X.Y.Z.exe`, puis lance-le (installation en un clic, sans droits admin).

## Compiler depuis les sources

Prérequis : Node.js 20+ et npm.

```bash
npm install
npm run dev      # développement
npm run dist     # installeur Windows dans release/
```

L'overlay de performances embarque **HW Monitor** et **PresentMon**, non versionnés ici.
Avant `npm run dist`, place dans `resources/perf/` :

- `HwMonitor.exe` — compilé depuis le dépôt [HardwareMonitor](../../../HardwareMonitor) (`deploy.ps1`)
- `PresentMon.exe` — [Intel PresentMon](https://github.com/GameTechDev/PresentMon) (MIT)

## Stack

Electron · electron-vite · React 19 · Tailwind 4 · TypeScript · better-sqlite3

## Licence

[MIT](LICENSE)
