# TurboFuzz

Clean, reshape and search tabular data in your browser. No uploads, no server
API, no network requests — everything is parsed and processed on your device.

**Live:** https://turbofuzz.mrjaystein.workers.dev

## Why it is private by construction

- Files are read with the File API and parsed in a Web Worker; nothing is sent
  anywhere.
- The production CSP sets `connect-src 'none'`, so the browser itself blocks
  any outbound request from the page.
- The deployment is a static assets-only Cloudflare Worker. There is no API
  route to call: the old URL/scrape proxy has been removed.

## What it does

- **Load:** drag or paste CSV/TSV/PSV/TXT/JSON, Excel (.xlsx/.xls), Parquet,
  and ZIP/GZ/BZ2 archives. BOM and encodings (UTF-8/UTF-16/windows-1252) are
  detected; messy headers, title rows and multi-level headers are handled.
- **Review:** per-column profiles with histograms and top values; QA chips for
  empties, outliers, long values, duplicates and constant columns; a
  suggestion engine for missing-value sentinels (`TBC`, `00/00/0000`, `-999`),
  mixed decimal conventions (`613,26` in a `1,234.56` column), type conflicts
  (`high` in an integer column) and formula-like cells.
- **Clean:** trim/case/replace, convert numbers and dates, repair mixed
  decimals, treat tokens as missing (per column, reversible), merge similar
  values, escape formula-like cells for Excel.
- **Transform:** dedupe, drop/round columns, group-by aggregates, impute
  (mean/median/mode/forward/backward/KNN), melt. Every step is tracked and
  reversible from the Steps list.
- **Search:** text (contains/exact/fuzzy/phonetic), value sets, numeric and
  date ranges, live facet counts and filtered histograms.
- **Export:** CSV with scope choice (all rows after steps vs. filtered), a BOM
  for Excel, optional formula escaping, plus clipboard copy and a pandas recipe
  of the applied steps.

## Development

Requirements: Node 22+ and npm.

```bash
npm install
npm run dev        # Vite dev server
npm test           # node:test suite (tsx)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
```

Benchmarks:

```bash
npm run bench:quick
npm run bench:real
```

## Deployment

The site is an assets-only Cloudflare Worker (`wrangler.jsonc`); no bindings,
no API:

```bash
npm run build
npx wrangler deploy
```

Security headers (including the strict CSP) live in `public/_headers` and are
copied into `dist/` by the build.

## Not supported

- HDF5 (`.h5`/`.hdf5`) — export to CSV or Parquet first.
- Fetching data from a URL — deliberately removed to keep the app fully
  offline.
