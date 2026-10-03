# 2026-10-03 — Rename to TurboFuzz

## Goal

Rename the app from "FuzzyFind" to **TurboFuzz** everywhere user-visible and
in package metadata.

## Files changed

- `index.html` — `<title>` + meta description
- `src/ui/app.ts` — top-bar brand text
- `package.json` / `package-lock.json` — package name `turbofuzz`
- `plan.md` — UI mock title
- `bench/run.ts` + `bench/results.md` — report heading

Historical session summaries and the repo folder keep their original names.

## Verification

- `npm run typecheck`, `npm test` (39 pass), `npm run build` — all clean.
- `npm install --package-lock-only` updated the lockfile name.

## Branch state

`agent/rename-turbofuzz` → `5b3a9dd chore(branding): rename app to TurboFuzz`
