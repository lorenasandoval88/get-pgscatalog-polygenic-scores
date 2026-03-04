# get-pgscatalog-polygenic-scores

Retrieve **polygenic score metadata and summaries** from the **PGS Catalog REST API** directly in the browser.

This lightweight JavaScript SDK fetches PGS score information, caches it in browser storage, and provides simple functions to access the data.

---

## Live Demo

https://lorenasandoval88.github.io/get-pgscatalog-polygenic-scores/
---

## Documentation
available in the wiki](https://github.com/lorenasandoval88/get-pgscatalog-polygenic-scores/wiki). 

---

## Quick Test (Dev Console)

You can test the SDK directly in your browser console.

```javascript
const sdk = await import("https://lorenasandoval88.github.io/get-pgscatalog-polygenic-scores/dist/sdk.mjs");

const data = await sdk.loadAllScores();

console.log(data);
```

<img width="1005" height="405" alt="image" src="https://github.com/user-attachments/assets/f72a2125-3b67-4fb2-b79c-9fee62b83345" />

