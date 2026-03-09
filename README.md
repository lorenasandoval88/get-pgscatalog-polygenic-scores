# get-pgscatalog-scores

Retrieve **polygenic score metadata and summaries** from the **PGS Catalog REST API** directly in the browser.

This lightweight JavaScript SDK fetches PGS score information, caches it in browser storage, and provides simple functions to access the data.

---

## Live Demo

https://lorenasandoval88.github.io/get-pgscatalog-scores/
---

## Documentation
Available in the [wiki](https://github.com/lorenasandoval88/get-pgscatalog-scores/wiki). 

---

## Quick Test (Dev Console)

You can test the SDK directly in your browser console.

```javascript
const sdk = await import("https://lorenasandoval88.github.io/get-pgscatalog-scores/dist/sdk.mjs");

const data = await sdk.loadAllScores();

console.log(data);
```

<img width="1005" height="405" alt="image" src="https://github.com/user-attachments/assets/f72a2125-3b67-4fb2-b79c-9fee62b83345" />

---

## Architecture

- `src/js/`: browser modules for data loading, caching, trait/score summaries, and app startup.
	- `getPGS_main.js`: app entry and initialization wiring.
	- `getPGS_loadScores.js`: score fetch/load/cache/stat logic.
	- `getPGS_loadTraits.js`: trait fetch/load/cache/stat logic.
	- `getPGS_loadTxts.js`: score text file fetch/cache logic.
	- `getPGS_loadStats.js`, `getPGS_loadPgs.js`: additional helper modules.
- `sdk.js`: public SDK entrypoint (exports the SDK API used for `dist/sdk.mjs`).
- `src/css/`: app styles.
- `src/js/data/`: local data files used by the browser app.
- `dist/`: Rollup build outputs:
	- `dist/loadScores.bundle.mjs` for the scores bundle.
	- `dist/loadTraits.bundle.mjs` for the traits bundle.
	- `dist/sdk.mjs` for the bundled SDK entry.

## Build

Run `npm run build` to generate:

- `dist/loadScores.bundle.mjs`
- `dist/loadTraits.bundle.mjs`
- `dist/sdk.mjs`

## Run

Open `index.html` with a local static server (for example VS Code Live Server).

## SDK API

Public exports from `sdk.js`:

- `localforage`
- `loadAllScores`
- `loadScores`
- `fetchScores`
- `loadScoreStats`
- `getTxts`
- `fetchTraits`

