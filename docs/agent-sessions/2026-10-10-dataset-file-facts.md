# 2026-10-10 - Dataset facts on load (size, format, encoding, type mix)

## Goal

User request: when a file lands, show more about its format (UTF-8 or
whatever) and its size, plus some helpful stats. The Overview already had a
dataset line and four health tiles; this adds the input facts around them.

## What shipped

On the Overview dataset line (`src/ui/overview.ts`):

- **Facts**: `sales_demo.csv · 6,015 rows × 12 columns · 518.0 KB · 115 ms`.
- **Badges**: format from the name (`CSV`, `TSV`, `PSV`, `Text`, `JSON`,
  `Parquet`, `Excel`, `Excel 97–2003`), detected delimiter for delimited text
  (`comma`, `tab`, `semicolon`, `pipe`) and the encoding (`UTF-8` or
  `windows-1252`; shown whenever known).
- **Type mix** on its own line: `3 numeric · 1 date · 5 category · 2 text ·
  1 boolean` (identifier shows as `ID`).

Supporting plumbing:

- `IngestResult`/`DatasetMessage` gained `delimiter` (`src/worker/ingest.ts`,
  `src/worker/protocol.ts`); the worker keeps it across transforms like
  `encoding`/`ragged` (`src/worker/search.worker.ts`).
- The app records the input byte size on every load path — direct buffer or
  pasted text (`TextEncoder`), archive entries (uncompressed size),
  gzip/bzip2 (decompressed size) and workbooks (`buffer.byteLength`) — and
  passes a preformatted `sizeLabel` to `Overview.render`
  (`src/ui/app.ts`). The top-bar tooltip carries size, delimiter, encoding,
  duplicates, empties and parse time.

## Files changed

- `src/ui/overview.ts`, `src/ui/app.ts`, `src/styles.css`,
  `src/worker/ingest.ts`, `src/worker/protocol.ts`,
  `src/worker/search.worker.ts`.
- Tests: `test/ui-overview.test.ts` (label helpers, type mix, rendered line),
  `test/ingest.test.ts` (delimiter detection, JSON null).

## Commands executed

```
npm test            # 374 tests, 374 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python measure_post_import.py http://localhost:4174/ sales_demo.csv
python check_dataset_facts.py http://localhost:4174/ sales_demo.csv
```

## Results

- **21/21 budgets still pass** (B8 stays at one "rows × columns" statement).
- `check_dataset_facts.py`: facts read `sales_demo.csv · 6,015 rows × 12
  columns · 518.0 KB · 115 ms`, badges `CSV · comma · UTF-8`, types
  `3 numeric · 1 date · 5 category · 2 text · 1 boolean`; the top-bar tooltip
  carries the same detail.

## Decisions

- File size is measured on the input actually parsed (uncompressed inner
  buffer for gz/bz2/zip entries; byte length of pasted text), not the
  container file.
- Format comes from the extension (works for archive entries like
  `archive/inner.csv`); delimiter comes from the parser, so CSV variants are
  honest.
- Encoding is only shown when the worker decoded bytes (file buffer); pasted
  text and Excel sheets have no encoding badge.
- Type mix is recomputed on every render, so transforms update it in place.

## Next

Optional: deploy to Cloudflare (branch `agent/dataset-file-facts`).
