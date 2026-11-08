# Compare two datasets: plan

Owner scope, agreed 2026-11-08 (DEC-2026-11-08-02). A separate mode with two screens, a comparison report and a side-by-side table. Every other feature is locked while it is open.

## Scope (v1)

**Inputs.** A (before) and B (after). Each is a file, or A is the data already loaded, as cleaned so far. Same file formats as the normal loader.

**Setup step** (before the two screens, and reachable again from both):
- **Row matching.** Key columns suggested automatically: present in both, no empties, unique, preferring id-like names and types. Composite keys allowed. With no key, rows match **by whole-row content** (a multiset match: identical rows pair up, the rest are only in A or only in B; no cell-level changes).
- **Column matching.** By name, ignoring case, spaces and punctuation. Unpaired columns can be mapped by hand (renames). Type differences are reported; values compare after parsing to a common type where both sides parse.
- **Value rules.** Numbers: absolute and/or relative tolerance. Text: ignore case, ignore leading/trailing/repeated spaces. Empty equals empty (on by default).

**Screen 1: Report.**
- Headline: rows in A, rows in B, matched, only in A, only in B, changed, identical.
- Warnings first: duplicate keys and empty keys (each side), with counts.
- Columns: added, removed, renamed (mapped), retyped.
- Per column: changed cells and share of matched rows; top old → new pairs with counts.
- Totals check: per number column, sum and mean in A and B, and the difference (over all rows and over matched rows).
- Every count links to those rows on screen 2.

**Screen 2: Side by side.**
- Two panes, rows aligned by key, scrolling synced both ways. A missing row is a gap on its side.
- Changed cells highlighted; only-in-A and only-in-B rows tinted.
- Show: All / Changed / Only A / Only B / Identical. Column focus: only columns with changes.
- Next / previous difference (`n` / `p`).
- Toggle to one grid: each changed cell shows the B value over the struck-through A value.

**What shifted** (added 2026-11-08, owner request). The populations compared as wholes, so it works with no key. Each paired column is ranked by how far its values moved: numbers and dates by PSI over A's deciles plus the standardised mean difference (the larger verdict counts), categories by Cramér's V with value shares, new and vanished values. The verdicts are no real shift / mild / large and measure effect size, not significance (with large n almost everything is significant). By group: the mean or sum of a number column, or the row count, per group for A and B, biggest relative moves first. Later: mix vs real change, which splits a moved total into the part from group sizes and the part from values within groups.

**Exports.** The report as a self-contained HTML page; the differences as CSV or Excel (key…, column, A value, B value, status), plus only-in-A / only-in-B rows.

**Locked down.** Compare is read-only. The workspace tabs, cleaning, transforms, recipe and command bar are unavailable until Exit. Exit clears both datasets and returns to the start screen: compare is a one-off analysis (owner, 2026-11-08). When A carried Recipe steps, Exit asks first.

**Out of scope (v1).** Matching rows by similarity when there is no key; three or more datasets; merging changes back; editing in compare mode; saving a compare session.

## Architecture

- **In the main worker** (`search.worker.ts`), not a separate one (changed in M2): A is the loaded dataset as it is now (cleans, transforms, without deleted rows), used in place with no copy; B is ingested beside it with the same parser and dropped on Exit or on any new load. This saves copying A between workers. The lockdown is the full-screen compare layer, which also mutes the app's shortcuts.
- From the start screen, A is chosen inside compare mode and loads as the app's data. Exit clears it with B.
- B reads CSV/TSV/JSON/Parquet; workbooks and archives are explained (save as CSV) until their pickers are reused.
- **Matching** (`src/data/compare/`, pure and unit-tested): normalise key values → hash map from key to row in A → probe with B. Output: a row-pair index (`aRow`, `bRow`, -1 for a gap) in display order, plus per-pair status and a changed-cell bitset. No-key mode hashes whole normalised rows into a multiset.
- **Rendering**: windows of rows are requested by pair position, like the table today. Both panes are thin `ResultTable`-style virtual grids driven from one scroll position.
- **UI** in `src/ui/compare/` (mode shell, setup, report, side-by-side), mounted over the workspace, not inside `app.ts`.

## Speed (gate)

- `bench/compare.ts` (`npm run bench:compare`), in `npm run gate` at 200k rows with budgets scaled from these at 1M × 20 vs 1M × 20:
  - Suggest keys ≤ 1.5 s (measured 1.1 s).
  - Match + diff with a key ≤ 2 s (measured 1.7 s).
  - Whole-row match, no key ≤ 4.5 s (measured 2.9–4.1 s). It numbers every cell of both sides (40M) and stays exact: rows are grouped by value ids and verified, never equal on a hash alone.
  - Report ≤ 0.5 s (measured 0.16 s).
  - Window of 100 aligned rows ≤ 16 ms (milestone 4).
- Memory: two datasets live at once; warn above a combined size threshold.

## Milestones (one commit per feature)

1. **Engine.** `src/data/compare/` matching (key, composite key, whole-row), column pairing, value rules, report numbers. Unit tests, plus a bench with budgets.
2. **Mode shell + setup.** Entry point (start screen and workspace menu), choose A and B, key and column suggestions with overrides, the lockdown, Exit.
3. **Report screen.** Every section above, with the links into screen 2.
4. **Side-by-side screen.** Synced panes, filters, column focus, next/prev difference, one-grid toggle.
5. **Exports.** HTML report and the changes file.
6. **E2E + a11y** specs for the journey; docs (feature inventory, journeys, help).

## Open questions

- Where the entry point lives: a third card on the start screen, a toolbar button in the workspace, or both (proposed: both).
- Row-count ceiling for compare (two datasets in memory) and the warning wording.
