# 2026-10-03 — Legacy encodings and Unicode-safe matching

## Goal

Make weird characters work: legacy CSV encodings, non-Latin scripts, special
Latin letters and preserved raw values.

## Decision

Raw values are never mutated. Normalization/decoding only affect the
comparison view or the byte-to-text step at ingestion; display and export
always use the raw strings.

## Changes

- **Tokenization** (`src/search/normalize.ts`): splits on `[^\p{L}\p{N}]+`
  instead of `[^a-z0-9]+`, so `Straße`, `ø`, `æ` stay whole tokens and any
  spaced script (Cyrillic, Greek, Arabic, CJK runs) is fuzzy-indexable.
- **Diacritic stripping is script-scoped**: marks are removed only after
  Latin/Greek/Cyrillic bases. Indic vowel signs and other meaningful marks are
  preserved instead of being deleted.
- **Encoding detection** (`src/parse/encoding.ts`): strict UTF-8 decode, then
  fallback to windows-1252. Node's TextDecoder decodes the 0x80-0x9F range as
  C1 controls, so the WHATWG mapping (€, quotes, dashes) is applied explicitly
  and idempotently — identical results in Node and browsers.
- `ingestDataset` now returns `{ dataset, encoding }`; the loaded message and
  the UI meta line show `windows-1252` when that path was used.
- `bench/real.ts` decodes files with the same code and reports the encoding.

## Real-data verification

`PPR-ALL.csv` (361,725 rows, Irish property register):

- Detected `windows-1252`; `Price (€)` inferred as **number** (previously the
  euro byte became U+FFFD and the column fell back to text).
- Quoted addresses with commas, text typing p50 7.1 ms, cached repeat 0.24 ms.

`winemag-data-130k-v2.csv` (129,971 rows, accented designations):

- 11,407 values change under normalization; accents stripped for matching.
- fuzzy `vulka` matches `Vulkà Bianco`; `cafe` matches `café`/`Eté` style
  values; raw values unchanged for display/export.

## Tests

- `npm test`: 55 pass, including encoding fallback, BOM handling, script-scoped
  normalization, Indic mark preservation, Unicode tokenization and `ß` fuzzy
  matching.
- `npm run typecheck`, `npm run build` clean.

## Branch state

`agent/unicode-encoding` → `bca6b91` (fast-forwarded to `main`, pushed).
