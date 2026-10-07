# 2026-10-07 — Deploy latest build to Cloudflare Workers

## Goal

Deploy the newest source (branch `agent/pipeline-wiring`, 10 commits ahead of
`main`) to the live Cloudflare Worker `turbofuzz`.

## Deploy path

Direct `wrangler deploy` from the current branch instead of pushing to `main`:

- `main` is protected by the repo workflow rules (no direct commits).
- The Cloudflare project is a Worker (`wrangler.jsonc`), so a local deploy is
  the fastest route to ship the current tree.

## Commands executed

```
git status --short --branch          # clean, on agent/pipeline-wiring
npx wrangler whoami                  # not authenticated
npm test                             # 166/166 pass
npm run build                        # tsc + vite build, dist/ produced
npx wrangler login                   # OAuth, mrjaystein account
npx wrangler deploy                  # uploaded worker + 8 assets
```

## Result

- Live URL: https://turbofuzz.mrjaystein.workers.dev
- Version ID: `ef08a4e8-775c-40c3-93b1-52590a590d23`
- 8 new/modified assets uploaded; verified the site serves
  "TurboFuzz — fast local table search".

## Notes

- Wrangler is invoked via `npx` (not a local devDependency).
- `main` still points at `7651dcd`; the pipeline-wiring work remains unpushed.
  Push/PR only when the branch is reviewed.
