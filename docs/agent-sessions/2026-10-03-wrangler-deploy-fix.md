# 2026-10-03 — Wrangler deploy fix

## Problem

The Cloudflare project was created as a **Worker**, so its deploy command is
`npx wrangler deploy`. Wrangler detected a Vite project without the Cloudflare
Vite plugin and tried to auto-configure it, failing with:

```
Cannot modify Vite config: could not find a valid plugins array.
```

The Vite build itself had succeeded; only wrangler's setup wizard failed.

## Fix

Added `wrangler.jsonc` describing an assets-only Worker:

```jsonc
{
  "name": "turbofuzz",
  "compatibility_date": "2026-10-03",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

With a config file present, `wrangler deploy` skips the Vite plugin setup and
serves `dist` directly. Verified locally with:

```
npx wrangler@4 deploy --dry-run
# Read 7 files from the assets directory ... exiting now.
```

`dist/_headers` is included in the upload; Workers static assets picks it up
for caching and COOP/COEP headers.

## Result

Push to `main` triggers the Cloudflare build automatically.
