# 2026-10-03 — Merge to main and Cloudflare Pages prep

## Goal

Consolidate all feature branches onto `main` and prepare the static deploy
target (Cloudflare Pages).

## Merge

All work was a linear chain, so `main` fast-forwarded from `19dcfb1` to
`e22de61` — benchmark harness, app MVP, stats, worker architecture, facets /
phonetic / histograms, rename, export, latency tuning.

## Deploy prep

- `public/_headers` — nosniff, no-referrer, COOP/COEP (unlocks
  SharedArrayBuffer for future threaded WASM), immutable caching for hashed
  assets, no-cache for the HTML shell. Vite copies `public/` to `dist/`.
- `public/favicon.svg` + link in `index.html`.
- `.nvmrc` pinned to Node 24 for the Cloudflare build.

## GitHub

- Created public repo `jay-stein/turbofuzz` with `gh`, pushed `main`.

## Cloudflare Pages settings

- Connect the GitHub repo, framework preset **Vite** (or None).
- Build command: `npm run build`
- Build output directory: `dist`
- Node version from `.nvmrc`; if the build ignores it, set the
  `NODE_VERSION` environment variable.

## Branch state

`main` is the deploy branch. Feature branches remain local.
