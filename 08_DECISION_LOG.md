# UX Decision Log

Record significant product and UX decisions so future AI sessions do not repeatedly reopen settled questions.

## Entry template

### DEC-YYYY-MM-DD-NN — Short title

- **Status:** Proposed / Accepted / Rejected / Superseded
- **Context:** What problem or opportunity prompted the decision?
- **Evidence:** Which observation, test or user feedback supports it?
- **Decision:** What will we do?
- **Alternatives considered:** What else was considered?
- **Trade-offs:** What gets better and what might get worse?
- **Features / journeys affected:** IDs from the inventory and journey register.
- **Acceptance criteria:** How will we know the decision worked?
- **Revisit trigger:** What evidence would justify changing this decision?
- **Date / owner:**

---

## Current decisions

Add decisions here. Do not treat AI-generated suggestions as accepted decisions until a human approves them.

### DEC-2026-10-31-01 — New-column formulas are Excel style

- **Status:** Accepted (owner, 2026-10-31)
- **Context:** The Table's New column window needs a formula language (next_steps.md, "BIG TODO: the Table view", section 1). Compared side by side: Excel style (`IF([Status] = "Closed", "Done", "Open")`, `UPPER([First] & " " & [Last])`, `YEAR([Order date])`) against pandas style (`np.where(Status == "Closed", …)`, `(First + " " + Last).str.upper()`, `` `Order date`.dt.year ``).
- **Decision:** Excel style. Columns are `[Column]` (any name, spaces included; `[` opens column suggestions). Spreadsheet function names: `IF`, `AND`, `OR`, `NOT`, `ROUND`, `ABS`, `MIN`, `MAX`, `LEN`, `LEFT`, `RIGHT`, `MID`, `FIND`, `UPPER`, `LOWER`, `TRIM`, `CONCAT` and `&`, `YEAR`, `MONTH`, `DAY`, `WEEKDAY`, `DATEDIF`, `TODAY`, `ISBLANK`, `COALESCE`/`IFBLANK`. The window shows the matching pandas line under the preview, and Recipe export writes pandas and Polars as for every step.
- **Trade-offs:** Python users write a syntax they use less, softened by the pandas line shown and the export; deep nesting of `IF` is offset by the Conditional builder.
- **Acceptance criteria:** every function has a parity case (pandas and Polars give the app's result); unknown columns and functions are reported at their place in the formula with a suggestion.
- **Date / owner:** 2026-10-31 / owner

### DEC-2026-10-29-01 — Score band caps and optional columns (plan D7)

- **Status:** Accepted 2026-10-29 by the owner as the starting thresholds (50%/75% empty, 20%/50% invalid); revisit after real use
- **Context:** A weighted mean can read "good" while one column is mostly unusable (Titanic Cabin 77% empty scored 96.8).
- **Evidence:** Corpus run: ARDD and UCS satellites read "poor" at 94 and 91 under the caps because several columns are 75%+ empty.
- **Decision:** Keep the weighted mean as the number. Cap the band at fair when a required column is more than 50% empty or a column has more than 20% invalid values; cap at poor above 75% empty or 50% invalid. The hero says why. Optional columns (name hint, or the only incomplete column in an otherwise complete table, or user-marked) count 25% towards Completeness and never cap the band. Empty columns stay excluded and reported once.
- **Alternatives considered:** Leave the band as the number only; cap by the worst column score.
- **Trade-offs:** Honest about unusable columns; may read harsh for sparse-by-nature data (government tables filled only for some regions). The user can mark such columns optional.
- **Features / journeys affected:** Data Quality hero, issue list (empty-cell cards), score tile.
- **Acceptance criteria:** Titanic reads fair with the Cabin reason; clean datasets stay good (test/band-optional.test.ts and the corpus).
- **Revisit trigger:** Owner finds the thresholds too strict or too lax on their own data.
- **Date / owner:** 2026-10-29 / owner approval pending
- **Known gap:** Optional marks are session-only; saving them in the Recipe and rules file waits on M3.

### DEC-2026-10-29-02 — Local history stores rates and counts only (plan D5)

- **Status:** Accepted (implemented as planned)
- **Context:** Users want to see change between loads without the app keeping their data.
- **Decision:** One snapshot per load in IndexedDB on this device: scores, row counts, per-column fill rate and distinct count, rule pass rates, schema. Category labels only for columns with 12 or fewer values that are not flagged sensitive, and none until the sensitive scan has run. Never cell values or examples. Snapshots are matched by file name; at most 30 are kept. A switch turns recording off and a button clears it.
- **Trade-offs:** A renamed file starts a new history. The same file reloaded within a minute is not recorded twice.
- **Acceptance criteria:** test/history.test.ts (sensitive columns never store labels, diff, cap, clear); the tab hides its content when IndexedDB is blocked.
- **Date / owner:** 2026-10-29 / owner

### DEC-2026-10-29-03 — Rules are data, never code (plan R1/R2)

- **Status:** Accepted
- **Decision:** A rule is a plain object (not empty, unique, range, one of a list, regex, length, compare columns) run by a pure evaluator. No eval and no `new Function`. Regex patterns are capped at 200 characters and nested repeats such as (a+)+ are refused. Rules reference columns by name and live in the session and in `turbofuzz-rules.json`, which carries a schema fingerprint.
- **Trade-offs:** Rules are remembered for the session only, not across browser restarts; a rules file is the durable form.
- **Date / owner:** 2026-10-29 / owner

### DEC-2026-10-29-04 — Accuracy is offline and carries no weight by default (plan REF)

- **Status:** Accepted
- **Decision:** Bundled lists (countries, currencies, AU and US states, weekdays, months) load by dynamic import only when a column's name and values point at one. A column needs 60% of its distinct values on the list before it is checked. Accuracy weight stays 0, so it is applicable but does not move the score unless the owner changes the weights.
- **Date / owner:** 2026-10-29 / owner
