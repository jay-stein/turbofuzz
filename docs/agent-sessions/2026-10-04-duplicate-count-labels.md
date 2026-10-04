# 2026-10-04 — Duplicate count labelling

## Issue

Topbar said "24,183 duplicate rows" while the QA Duplicates button said
"36,953". Both numbers were correct but measured different things:

- `duplicateRows` — extra copies beyond the first row of each duplicate group
  (a group of 3 identical rows contributes 2).
- `rowsInDuplicateGroups` — every row in a duplicate group; this is exactly
  what the Duplicates filter shows.

The difference equals the duplicate-group count (12,770).

## Change

- Topbar: `· 12,770 duplicate groups (24,183 redundant rows)`.
- QA button tooltip: "All rows belonging to a duplicate group — every copy is
  shown so they can be compared".
- Stats modal summary card renamed `Duplicate rows` → `Redundant rows`.

No logic changes; 104 tests, typecheck and build clean.
