# 2026-10-08 — Remove URL scraping / enforce zero network

## Goal

1. Assess the two 2026-10-08 review docs and validate their fixture claims
   against `review_claude_20261008/torture_utf8_bom.csv`.
2. Remove all website scraping / URL loading so the app is fully offline:
   nothing leaves the browser, no server API.

## Validation results (real ingest pipeline, 21,000 × 18 fixture)

- BOM (`EF BB BF`) handled; `long_id` / `Postcode` typed ID/Exact, `0800`
  intact; duplicates exactly 599 groups / 599 redundant rows.
- **A1 confirmed:** 17 of 18 columns load — the blank-header 18th column
  (constant `x`) is silently dropped by `mergeHeaders` width logic.
- **A2 confirmed:** 5 short rows padded, 5 long rows truncated (`extra`
  cells lost); `Country` shows exactly 5 empties, no notice anywhere.
- **A3 confirmed:** `613,26` parses to `61326` (dot prior for UTF-8 CSV).
- **A4 confirmed:** `TBC` (206) and `00/00/0000` (245) are real values;
  `-999` (435) not missing; only `n/a` (210) + blanks count as null.
- **A5 confirmed:** `Score` typed integer while 339 cells read `high`.
- **A7 confirmed:** `=1+1` (108) and `@SUM…` (101) unflagged.
- All urgent items logged in `next_steps.md` §9.

## Changes

- `src/ui/app.ts`: removed the URL field, scrape/load routing, `isDataUrl` /
  `isWorkbookUrl` / `nameFromUrl`, table-name helpers and "best match" picker
  badge. Privacy copy now reads "0 bytes uploaded · 0 network requests".
- `src/ui/html-table.ts`, `test/html-table.test.ts`: deleted (scraper only).
- `worker/api.ts`: deleted; `wrangler.jsonc` is now assets-only (no `main`,
  no binding). `tsconfig.json` no longer includes `worker`.
- `public/_headers`: strict CSP added — `default-src 'none'`,
  `script-src 'self'`, `worker-src 'self'`, `style-src 'self'`,
  `connect-src 'none'`, `frame-ancestors 'none'`, `object-src 'none'`, etc.
- `table_scraper.md`: deleted. URL-related CSS removed from `src/styles.css`.
- `next_steps.md`: removed URL from the Load description; added §9 with all
  urgent review items and their validated status.
- `test/ingest.test.ts` / `src/worker/ingest.ts`: comment/name updates
  ("scraped tables" → pre-structured grids).

## Commands executed

```
npm run typecheck     # clean
npm test              # 211/211 pass
npm run build         # tsc + vite build, dist/ emitted
npx wrangler@4 deploy --dry-run   # assets-only config valid
```

## Decisions

- Deploy stays on the same Cloudflare Worker name but as an assets-only
  deploy; `_headers` (already honoured in production) now carries the CSP.
- Historical `docs/agent-sessions/*.md` logs left untouched; only the
  scraper spec was deleted.

## Blockers / follow-ups

- Review fixes are intentionally not implemented here; they are ranked in
  `next_steps.md` §9 (top: A1 column drop, A2 ragged-row summary, xlsx CVE
  upgrade, export scope).
