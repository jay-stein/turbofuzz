# 2026-10-04 — ZIP and GZ upload support

## What was added

- Dropzone, file picker and URL loader accept `.zip` and `.gz` in addition to
  CSV/TSV/PSV/TXT/XLSX/XLS.
- `src/parse/archive.ts`:
  - `listArchiveEntries` lists supported data files inside a ZIP **without
    decompressing them** — fflate calls the filter for every entry, so
    rejecting all of them yields paths and uncompressed sizes at central
    directory speed (~24ms for a 17MB zip). Skips directories, dotfiles,
    `thumbs.db`, `._*` AppleDouble files and `__MACOSX/`.
  - `readArchiveEntry` decompresses a single entry by path, skipping the rest.
- UI flow:
  - ZIP with one data file loads it directly; multiple files show the table
    picker with full paths and sizes.
  - Workbook entries (.xlsx/.xls) go through the existing worksheet picker.
  - `.gz` gunzips and routes the inner file as CSV, workbook, or even another
    `.zip`.
  - `PickerItem` gained an optional `detail` label so archive entries can show
    size instead of an unknown row/column count.

## Verification

- 106 tests: archive listing/filtering and single-entry extraction.
- Real file: `Compress-Archive` zip with nested 53MB wine CSV — list 24ms,
  extract 400ms, 129,971 rows parsed. `logo.png` and junk excluded.
