<!-- markdownlint-disable-file -->

# Task Research Notes: Ataccama DQ Checks vs Open-Source Tooling — TurboFuzz Improvement Analysis

## Research Executed

### File Analysis

- README.md
  - TurboFuzz is an offline, in-browser table clean/transform/QA/search tool (Vite + TS, Cloudflare assets-only Worker, CSP `connect-src 'none'`). Zero network calls by construction.
  - Existing QA surface: per-column profiles/histograms, QA chips (empties, outliers, long values, duplicates, constant columns), sentinel suggestions (`TBC`, `00/00/0000`, `-999`), mixed-decimal repair, type-conflict chips, formula-cell escaping.
- next_steps.md
  - Latency budgets: keystroke filter < 50 ms; clean/transform commit < 500 ms at 100k rows; charts < 16 ms/frame; streamed exports.
  - Architecture rules: immutable source `Dataset`, non-destructive derived columns, centralised invalidation, lazy+cached derivations, no heavy deps in the core bundle.
- src/data/findings.ts (817 lines, 25 `report:` sites, ~16 finding families)
  - Reports: `quality.schemaHealth` (type conflicts, mixed numbers, formula-like cells), `quality.missingness` (+ co-missingness pairs), `quality.categoryConsistency` (near-identical value merges), `quality.columnUsefulness` (constant, identifier), `quality.constraintViolations` (negative values under count-like names), `quality.unitInconsistency` (mass either side of 1.0), `quality.joinReadiness` (unique key hygiene), `quality.duplicateAnalysis` (exact row duplicates), `quality.dataIntegrity` (functional dependencies / key→value conflicts), `quality.textMining`, `quality.nearDuplicates`, `quality.distributionChanges`, `anomalies.groupRelative`, `anomalies.univariate`, `relationships.association`, `relationships.explain`.
  - Findings carry `severity`, plain-language title, evidence metrics, impact rows/columns and one-click `action` (filter, clean, merge, flag, winsorize).
- src/data/anomalies.ts
  - Value fences: robust median/MAD (Iglewicz–Hoaglin, |0.6745(x−median)/MAD| > 3.5), log1p space for right-skewed non-negative columns, quantile fence fallback when MAD would flag > MAX_FLAG_RATIO. Length fences p90-based. One-time O(cells) pass → row-level bitmasks.
- src/data/group-anomalies.ts
  - Group-relative robust z (median/MAD, |z| > 3.5, groups ≥ 30).
- src/data/dependencies.ts
  - Functional-dependency discovery (candidate determinants → dependents, ≤2% violation ratio, capped pairs) — "station id → station name" style integrity evidence.
- src/data/distribution.ts
  - Windowed drift between first/second half: PSI for numeric (first-half deciles), Cramér's V for categories.
- src/data/comissingness.ts
  - Pairwise co-missingness counts over filtered rows ("missing together" findings).
- src/parse/null-tokens.ts
  - ~60 exact null tokens + compact matching + zero-width handling + per-column `NullPolicy` (extra/keep).
- src/data module surface (39 modules) confirms transform ops (dedupe, group-by, melt, KNN impute, combine dates), recipes (pandas/Polars export with support report), charts (histogram/scatter/density/box/heatmap/correlation), text profiles, similar-value clusters, archetypes.

### Code Search Results

- `anomal|outlier|MAD|fence` across `src/data`
  - 80 hits confirming MAD/log/quantile fences, length fences, group-relative z, winsorize op, outlier flag transform, recipe notes about data-derived fences.
- `report: "` within findings.ts
  - 25 matches → the finding catalog listed above (16 distinct report ids). No regex/pattern-format, pair-comparison, composite-key, allowed-values, freshness or threshold-based checks exist today.

- `score|Score|grade|rating` across `src/`
  - 88 matches, all search/heuristic internals: fuzzy-index scoring (`fuzzy-index.ts`), delimiter/header detection scores (`delimiter.ts`, `header-detect.ts`), archetype confidence (`archetype.ts`), overview rule ranking (`overview.ts`). **No data-quality score exists anywhere in the codebase.**

### External Research

- #fetch:https://www.ataccama.com/platform/data-quality
  - Ataccama ONE: agentic DQ platform — profiling, rule creation, monitoring, anomaly detection, remediation; commercial ("Talk to an expert", ROI calculator).
  - Also ships a **Data Trust Index** — a real-time trust signal/score for datasets in the catalog ("tells humans and AI whether a dataset is reliable"), plus overall quality scores per dataset/term.
- #fetch:https://www.ataccama.com/blog/what-is-data-quality-why-is-it-important
  - Ataccama's six DQ dimensions: **completeness, validity, timeliness, uniqueness, accuracy, consistency**; program steps: profile → fix urgent issues → define metrics → monitor → scale.
- #fetch:https://docs.ataccama.com/sitemap.xml + https://docs.ataccama.com/sitemap-one.xml
  - Full doc tree: anomaly-detection (catalog items, monitoring projects, service, outlier detection, time series), data-quality (rules, dimensions, aggregation rules, validation components, lookups, rule suggestions, DQ firewalls, data reconciliation, DQ gates), monitoring projects, notifications, invalid samples.
- #fetch:https://docs.ataccama.com/one/latest/data-quality/rules.html
  - Two rule categories: **detection rules** (data-based vs metadata-based term detection at profiling time) and **DQ evaluation rules** (condition builder per dimension).
  - Predefined dimensions & result states: Validity (Valid/Invalid), Uniqueness (Unique/Not populated/Not Unique), Completeness (Complete/Not complete), Accuracy (Accurate/No reference/Not accurate), Timeliness (ok/Minor delay/Major delay); custom dimensions supported; "Not applicable" results excluded from the overall quality percentage.
- #fetch:https://docs.ataccama.com/one/latest/data-quality/data-quality-dimensions.html
  - Verified **scoring semantics**: Overall Quality is record-based (explicitly "not an average of the dimension results") — a record fails if any applied rule fails, passes if none fail and at least one passes, and is excluded only when all rules are Not applicable; `Overall Quality (%) = Passed / (Passed + Failed) × 100` with N.A. excluded; consequence: the score "can never be higher than the lowest-scoring contributing dimension"; dimension contribution toggles, per-result effects (Pass/Fail/Not applicable), colours and abbreviations are configurable; indicator hidden with a tooltip when every record is N.A.
- #fetch:https://docs.ataccama.com/one/latest/data-quality/validation-components.html
  - Component rules (ONE Desktop files) as custom validation logic; component results mapped to dimension explanations.
- #fetch:https://github.com/ataccama
  - "This organization has no public repositories." → Ataccama is fully closed-source; no libre edition. (Interactive walkthrough/demo only.)
- #githubRepo:"fivetran/great_expectations expectations core"
  - 63 core expectation classes listed (see catalog below); repo license **Apache-2.0**; project now under the Fivetran org (~11.9k stars).
- #fetch:https://greatexpectations.io/expectations/
  - Expectation Gallery is the official catalog surface (JS-rendered; catalog taken from the core repo instead).
- #fetch:https://docs.soda.io/soda-documentation/soda-v3/sodacl-reference/metrics-and-checks.md
  - SodaCL: YAML metrics + thresholds; 25+ built-in metrics; check families: anomaly detection, distribution, freshness, reconciliation, reference, cross, schema, group by, group evolution, failed rows, user-defined; numeric/missing/validity metric groups.
- #githubRepo:"sodadata/soda-core"
  - Soda Core repo present; license **"Other" (NOASSERTION)** → open-core, custom license (Soda Cloud is paid). Not unambiguously libre unlike GX/dbt/Deequ.
- #fetch:https://docs.getdbt.com/docs/build/data-tests
  - dbt ships 4 generic data tests: `unique`, `not_null`, `accepted_values`, `relationships` (referential integrity); singular SQL tests; `store_failures`; history: tests renamed `data_tests`; extensions via dbt-utils (`unique_combination_of_columns`) and dbt-expectations.
- #githubRepo:"dbt-labs/dbt"
  - Repo renamed from dbt-core → dbt; license **Apache-2.0**; core now Rust; dbt platform is the paid product.
- #githubRepo:"awslabs/deequ DQDL rules"
  - Deequ ("unit tests for data", Spark, **Apache-2.0**): Checks with constraints (isComplete, isUnique, isContainedIn, isNonNegative, containsURL, hasApproxQuantile, hasSize…), data profiling, constraint suggestion, anomaly detection on metrics over time, MetricsRepository.
  - DQDL rule catalog verified from README: RowCount, ColumnCount, DuplicateRowCount, ZerosCount, Completeness, IsComplete, Uniqueness, IsUnique, ColumnCorrelation, DistinctValuesCount, Entropy, Mean, StandardDeviation, Variance, Skewness, Kurtosis, Range, Sum, UniqueValueRatio, CustomSql, IsPrimaryKey, ColumnLength, ColumnExists, ColumnValues (numeric/string/date), RowCountMatch, SchemaMatch, DataFreshness, composite AND/OR; row-level outcomes for a subset of rules.

### Project Conventions

- Standards referenced: README (product constraints: offline, no network, no chart libs), next_steps.md §5 "Architectural principles (non-negotiable)" and §7 "What not to do".
- Instructions followed: no `.github/instructions/` or `copilot/` directory exists in this workspace; conventions are captured in README.md, next_steps.md and docs/agent-sessions/*.md.

## Key Discoveries

### Project Structure

- `src/data/` — analysis engine: stats, findings, anomalies, dependencies, distribution, co-missingness, text profiles, similar clusters, recipes.
- `src/parse/` — format readers (CSV/TSV/JSON/XLSX/Parquet/archives) + null-token heuristics.
- `src/search/`, `src/worker/` — Web Worker search/aggregate engine; typed-array payloads; lazy caches.
- `src/ui/` — single-workspace UI: QA chips, Process Log (undoable steps), Clean/Transform panels, charts, export dialog, help drawer.
- Constraint that shapes everything: **no server, no network, no heavy runtime deps**; all checks must run on-device within the <50 ms–<500 ms budgets.

### Implementation Patterns

- Findings are the product's DQ UI: detected issue → plain-language title + evidence + severity + one-click fix that lands in the Process Log/Recipe. Any new DQ check should be added in this shape to inherit discoverability, filtering and undo.
- Checks are computed from already-materialised column primitives (`normalized()`, `numbers()`, `categories()`, `histogram()`, `rowHashes`, `duplicateBits`) — cheap to extend with new derived passes.
- Export is precedent-driven: pandas/Polars recipe + "support report" listing anything not translatable. A DQ-check export should follow the same pattern.
- Sampling infrastructure exists (strided samples, reservoir sampling) and would cover pattern profiling on large files.

### Complete Examples

Existing finding shape to reuse for any new check (source: `src/data/findings.ts`):

```ts
export interface Finding {
  id: string;
  report: string;
  severity: FindingSeverity; // "fix" | "review" | "info"
  /** Plain-language sentence. */
  title: string;
  evidence: { metric: string; value: string; n: number }[];
  /** Rows and columns the finding touches. */
  impact: { rows: number; columns: number[] };
  fixLabel?: string;
  action?: FindingAction;            // filter / clean / merge / flag / winsorize
  extraActions?: { label: string; action: FindingAction }[];
}
```

SodaCL check examples (source: #fetch:https://docs.soda.io/soda-documentation/soda-v3/sodacl-reference/metrics-and-checks.md):

```yaml
checks for dim_customer:
  - row_count > 0
  - duplicate_percent(id) = 0
  - missing_count(adjusted_passenger_count) = 0
  - values in salary must exist in dim_employee_prod salary   # reference check
```

DQDL ruleset example (source: #githubRepo:"awslabs/deequ DQDL rules"):

```text
Rules=[IsUnique "item", RowCount < 10, Completeness "item" > 0.8, Uniqueness "item" = 1.0]
```

dbt data tests example (source: #fetch:https://docs.getdbt.com/docs/build/data-tests):

```yaml
models:
  - name: orders
    columns:
      - name: order_id
        data_tests: [unique, not_null]
      - name: status
        data_tests:
          - accepted_values:
              arguments: { values: ['placed', 'shipped', 'completed', 'returned'] }
      - name: customer_id
        data_tests:
          - relationships:
              arguments: { to: ref('customers'), field: id }
```

### API and Schema Documentation

**Ataccama ONE (commercial, closed source).** Check model:
- Rule categories: detection rules (term assignment at profiling) vs DQ evaluation rules (dimension-scoped, condition builder, or Component rule implemented in ONE Desktop).
- Predefined dimensions with result states: Validity (Valid/Invalid), Uniqueness (Unique/Not populated/Not Unique), Completeness (Complete/Not complete), Accuracy (Accurate/No reference/Not accurate), Timeliness (ok/Minor delay/Major delay) + custom dimensions; "Not applicable" excluded from quality %.
- Enterprise feature set around the checks: profiling + rule suggestions (AI, rule creation "from profiling results"), aggregation rules, lookups/reference data, monitoring projects, notifications (Slack/Teams), invalid-samples export, data remediation/transformation plans, data reconciliation, DQ firewalls, **DQ Gates** (evaluate the same rules in Snowflake UDFs or local Python), catalog/lineage integration, anomaly detection service (incl. time series).
- Verdict: not libre — no public repos, paid platform; closest libre equivalents are below.

**Ataccama scoring (consolidated from rules.html + data-quality-dimensions.html).** Overall Quality is a **per-record pass rate**, not a dimension average:
- Each dimension result is configured with an **Effect on overall quality**: **Pass** (increases), **Fail** (reduces), **Not applicable** (excluded).
- Rule instance → record combination: any rule fails → record **Failed**; all rules N.A. → record **excluded**; otherwise (≥1 Pass, no Fail) → **Passed**.
- `Overall Quality (%) = Passed / (Passed + Failed) × 100`; N.A. excluded from both sides; because every applied rule must pass, the score **can never exceed the lowest contributing dimension**.
- Dimensions need an **Overall contribution** toggle (≥1 required), plus colour, abbreviation and order; per-project/source overrides exist; results can be filtered to selected dimensions; if all records are N.A. the indicator is hidden with a tooltip.
- Defaults include a built-in N.A. path: Accuracy → "No reference available". Completeness nuance: `NULL`, `.`, `,`, `-`, `_`, `N/A`-style values are *not* auto-treated as "Not complete" (TurboFuzz's null-token policy is deliberately more aggressive and user-adjustable).
- Related trust surface: the **Data Trust Index** (real-time dataset reliability signal in the catalog).

**TurboFuzz scoring status: none** (verified in Code Search Results — no quality score exists; every `score` in the codebase is search/heuristic internals).

**Libre/open check catalogs (the "what's available" answer):**

| Tool | License | Unit of check | Check taxonomy highlights |
|---|---|---|---|
| Great Expectations | Apache-2.0 | Expectation (Python) | 63 core expectations: table row/column counts & column set/order; column exists/type; value in set / not in set; distinct values equal/contain/in set; null / not null / proportion non-null; regex / regex list / not match; like-pattern / not match; strftime format; JSON parseable / JSON schema; value lengths between/equal; values between; increasing/decreasing; ordered/unique; z-scores <; not-be-outliers; quantiles/mean/median/min/max/stdev/sum between; proportion unique; most common value in set; KL divergence <; KS & chi-square tests; **pair** A>B, equal, in-set, Cramér's phi; **multicolumn** sum-to-equal, values equal/unique; **compound columns unique**; unique within record |
| Soda Core (SodaCL) | Open-core (custom "Other" license) | YAML metric+threshold | Numeric metrics: row_count, avg, min, max, sum, percentile, stddev/variance (+pop/samp), duplicate_count/percent, avg/max/min_length, group-by, change-over-time thresholds. Missing: missing_count/percent. Validity: invalid_count/percent. Unique patterns: freshness, reference (values in A exist in B), reconciliation, cross (row-count compare), schema, distribution, anomaly detection, group evolution, failed rows, user-defined SQL |
| dbt (data tests) | Apache-2.0 | SQL assertion (failing rows) | unique; not_null; accepted_values; relationships (referential integrity); singular SQL tests; store_failures; dbt-utils `unique_combination_of_columns`; dbt-expectations package |
| Deequ / PyDeequ (DQDL) | Apache-2.0 | Constraint on a metric | RowCount, ColumnCount, DuplicateRowCount, ZerosCount, Completeness, IsComplete, Uniqueness, IsUnique, IsPrimaryKey, ColumnCorrelation, DistinctValuesCount, Entropy, Mean, StandardDeviation, Variance, Skewness, Kurtosis, Range, Sum, UniqueValueRatio, ColumnLength, ColumnExists, ColumnValues (numeric/string/date, in/between), RowCountMatch, SchemaMatch, DataFreshness, CustomSql, composite AND/OR; profiling + constraint suggestion; metric-based anomaly detection over time |

**TurboFuzz today (verified in code)** — already covers, relative to that catalog:
- Completeness: null-token detection (60+ tokens), per-column null policies, missing counts, co-missingness pairs, missingness matrix.
- Uniqueness: exact whole-row duplicates (+groups), unique-key hygiene, near-duplicate rows, similar-value clusters (N mergeable).
- Validity: type-conflict detection, mixed decimal conventions, formula-like cells, sentinel suggestions; negative-value heuristic for count-like names; unit inconsistency split at 1.0.
- Consistency: functional-dependency discovery (determinant → dependent conflicts), category near-identical values.
- Anomalies: robust MAD/log/quantile value fences, p90 length fences, group-relative robust z.
- Drift: PSI / Cramér's V between row-order halves.
- Relationships: associations, correlation matrix, explain views; text profiles.

**Gaps vs the catalog (where TurboFuzz can really improve):**

| # | Check family | In Ataccama | Libre equivalent | TurboFuzz status | Suggested addition (fits offline model) |
|---|---|---|---|---|---|
| 1 | **Composite-key uniqueness** (dupes on a column subset) | Uniqueness dimension | GX `expect_compound_columns_to_be_unique` / `multicolumn_values_to_be_unique`; dbt `unique_combination_of_columns`; Deequ `DuplicateRowCount`, `IsPrimaryKey` | Only whole-row duplicates + single-column uniqueness | Hash selected columns per row (reuse `rowHashes` machinery) → "N duplicate rows on these 3 columns" chip + filter + dedupe transform scoped to the key |
| 2 | **Format/pattern validity** (regex/mask profiles) | Validity (format/content) | GX `match_regex` / `like_pattern` / `strftime`; Soda `invalid_count/percent`, valid-format; Deequ `ColumnValues` | Type conflicts + decimal repair only | Profile dominant masks (`AA-9999`, `999-999-9999`) from a sample; flag off-pattern cells; one-click filter/escape; optional regex field for power users |
| 3 | **Pair / cross-column consistency** | Consistency + attribute relations; Accuracy vs reference | GX `column_pair_values_*`; Deequ `ColumnValues`; dbt `relationships` | Functional dependencies + unit split only | Pair checks: A ≥ B (dates, amounts), A = B, in-set; arithmetic identity (a+b≈c, sum of parts = total) with tolerance; chips + filters |
| 4 | **Allowed values / reference list** | Lookups, reference data | GX `in_set`; Soda `reference` check; Deequ `ColumnValues IN` | Facets + merge suggestions (not a check) | "Allowed values" check from a pasted list (or import a small reference CSV as second file, when the UI grows that concept); surface out-of-list values as a chip + filter |
| 5 | **Completeness targets** | Completeness dimension | GX `proportion_of_non_null_values_to_be_between`; Soda `missing_percent`; Deequ `Completeness` | Missing counts shown; no user thresholds | Per-column required/optional flag + completeness target (e.g. ≥ 95%) with pass/fail status colour in the QA summary |
| 6 | **Overall Quality score** (dimension-based) | **Overall Quality %** across contributing dimensions; Pass/Fail/N.A. per record, N.A. excluded; never above the lowest contributing dimension | No direct equivalent — every OSS tool reports per-check results only | **None — verified: no quality score anywhere in the codebase** | Dataset score 0–100 with per-dimension breakdown (Completeness / Validity / Uniqueness / Consistency / Timeliness), Ataccama-style N.A. exclusion, score band colour, score delta before → after per Process Log step, score section in the DQ report |
| 7 | **Freshness / timeliness** | Timeliness dimension (ok/minor/major delay) | Soda `freshness`; Deequ `DataFreshness` | Time series charts, no freshness check | Latest non-null date per date column vs now / vs median interval; "data is N days stale" finding with severity |
| 8 | **Threshold semantics on existing stats** | Overall quality % per dimension | GX KL divergence; Soda distribution/change-over-time | PSI/Cramér's V computed, unthresholded; drift defaults internal | Expose user-editable thresholds (drift PSI, uniqueness %, missing %) and pass/fail reporting in one DQ summary |
| 9 | **Schema expectations** | Catalog attributes | GX table/column existence/type/counts; Deequ `SchemaMatch`, `ColumnExists` | Ingest guardrails (ragged rows, blank headers) already robust | Include expected schema (columns/types) in the exported check file so pipelines can assert it |
| 10 | **Row-level multivariate anomalies** | ML anomaly detection service (time series etc.) | Soda RAD; Deequ metric anomalies over time | Univariate + group-relative only | Stretch: per-row outlier score from standardised numeric columns (Mahalanobis-lite / kNN distance — kNN precedent exists); only if a real use case appears |
| 11 | **Reusable check definitions / export** | Central rule library, DQ Gates run same rules in pipelines | GX suites, SodaCL YAML, dbt YAML, DQDL | Recipe export exists (pandas/Polars + support report) | **Flagship:** "Data quality report" export emitting detected checks as SodaCL / dbt `data_tests` / GX JSON / DQDL **plus score and per-check pass/fail**, with a support report for gaps — mirrors the existing recipe pattern exactly |

Explicitly out of scope for TurboFuzz (and why): warehouse pushdown scans, scheduled monitoring, alerting/notifications, catalog/lineage, remediation workflows across systems, and DQ Gates — all require a server/network, which the product deliberately forbids. TurboFuzz's niche is the **hands-on, instant, private check-then-fix loop**; the enterprise tools' value is scale/monitoring, so TurboFuzz should borrow their **check taxonomy and file formats**, not their runtime model.

### Configuration Examples

SodaCL-style future export target (shape to generate from TurboFuzz checks):

```yaml
checks for uploaded_table:
  - duplicate_count(order_id, customer_id) = 0
  - missing_percent(email) < 5
  - invalid_percent(email) < 1   # format check
  - values in country must exist in reference_country_list country
  - freshness(order_date) < 30d
```

dbt-style future export target:

```yaml
models:
  - name: uploaded_table
    columns:
      - name: order_id
        data_tests: [unique, not_null]
    data_tests:
      - dbt_utils.unique_combination_of_columns:
          arguments:
            combination_of_columns: [order_id, customer_id]
```

### Technical Requirements

- All new checks must stay on-device, single-pass or sampled, and reuse worker primitives; no new runtime dependencies (no regex libs needed — JS RegExp; no new WASM).
- Performance envelope from next_steps.md §0 must be respected: composite-key hashing within ingest cost; pattern profiling on a capped sample; check suite re-run after transforms must reuse the existing invalidation path (`engine.invalidate()` → clear caches → recompute anomalies → push metadata).
- Any new check should emit an existing `Finding` (severity/title/evidence/action) so it appears in the same UI and Process Log; export additions extend the recipe pipeline under `src/data/recipe*.ts`.

## Recommended Approach

**Borrow the check taxonomy *and the scoring model*, own the interactive layer: close the check-family gaps (#1–#9, #11 above) inside the existing findings/suggestion engine, add an Ataccama-style Overall Quality score with a per-dimension breakdown, and export the discovered checks + score in SodaCL/dbt/GX/DQDL formats — reusing the proven recipe + support-report pattern.** Alternatives considered and rejected: (a) embedding an open-source DQ engine (GX/Soda) — Python/JVM runtimes violate the offline/no-bloat constraint; (b) building monitoring/alerting — requires a server and contradicts `connect-src 'none'`; (c) vendor integration with Ataccama — commercial, closed, and orthogonal to a browser tool.

Why this is the single optimal path:
- Parity where it matters: after P0 (composite-key uniqueness, pattern profiles, pair checks, allowed values) plus P1 (the dimension-based quality score, completeness targets, freshness, thresholds), TurboFuzz covers every practical check family in the Ataccama/GX/Soda/Deequ catalogs that can exist without a server — **plus the one thing they all report and TurboFuzz lacks: a single quality number**.
- Differentiation compounds: every check lands as a chip + one-click fix, and the score visibly moves as fixes land (sentinel policy → Completeness up; decimal repair → Validity up); the export then hands the same rules *and* the score to pipeline tools, which none of the open-source tools can do interactively.
- Zero architectural risk: all additions reuse `rowHashes`, sampling, histogram caches, findings and recipe plumbing.

### Scoring design (Ataccama-aligned adaptation)

- **Dimensions**: Completeness, Validity, Uniqueness, Consistency, Timeliness (Ataccama's contributing dimensions; **Accuracy is shown as "No reference available" — N.A. — offline**, mirroring Ataccama's own Accuracy result state).
- **Per check**: pass rate over applicable rows/cells; **Not applicable is excluded** from numerator and denominator exactly like Ataccama (e.g. empty email cells are N.A. for a format check, not Fails; optional columns can be excluded from Completeness).
- **Dimension score** (0–100) = weighted pass rate of the checks mapped to that dimension, weighted by applicable rows: Completeness (non-null eligible cells), Validity (cells parsing under the inferred type + future pattern/pair checks), Uniqueness (unique rows on key-like columns / row duplicates), Consistency (rows without functional-dependency conflicts), Timeliness (freshness pass, or the whole dimension is N.A. when no date columns exist).
- **Overall score** (0–100) = weighted mean of **applicable** dimensions (defaults: Completeness 30, Validity 30, Uniqueness 15, Consistency 15, Timeliness 10), renormalised when a dimension is N.A.; weights and band thresholds (default ≥ 90 green / 75–89 amber / < 75 red) are user-editable.
- **Documented deviation from Ataccama**: their "fail if any rule fails" record semantics assumes hand-authored, per-attribute rules; TurboFuzz auto-generates checks, so per-check/per-cell pass rates give honest dimension scores without forcing rule authoring. An optional strict mode (overall capped at the lowest dimension — Ataccama parity) can come later once users can mark required checks.
- **Display & flow**: score tile beside dataset facts; click → dimension breakdown with colours/abbreviations and per-column contributors linking to the existing chips/filters; every Process Log step records score **before → after** (undo restores it); "all N.A." hides the indicator with a tooltip (Ataccama behaviour); score + per-dimension results included in the DQ report export.

Suggested priority:
- **P0**: composite-key uniqueness; pattern/mask profiling with off-pattern flagging; pair/consistency checks (A ≥ B, equality, arithmetic identity); allowed-values check. (These are the checks the score aggregates.)
- **P1**: **Overall Quality score** — dimension engine, score tile + breakdown, score delta in the Process Log, N.A. semantics, configurable weights/bands; completeness targets (required/optional flags); freshness check; user thresholds for existing PSI/missing/uniqueness stats.
- **P2 (flagship export)**: "DQ report" export to SodaCL / dbt YAML / GX JSON / DQDL with support report, **score and per-check pass/fail included**; schema expectations section.
- **P3 (only on demand)**: strict score mode (cap at the lowest dimension); per-row multivariate anomaly score; reference-file (second dataset) comparisons.

## Implementation Guidance

- **Objectives**: reach check-family parity with the commercial/open catalogs for single-table, offline analysis; add an Overall Quality score with a per-dimension breakdown that makes improvement visible as fixes land; keep the instant, private, check-then-fix loop; make TurboFuzz the authoring front-end that hands rules to Soda/dbt/GX/Deequ pipelines.
- **Key Tasks**:
  1. Composite-key check: multi-select columns → hash per row (reuse row-hash path) → finding with count + filter + scoped dedupe transform; show in Process Log.
  2. Pattern profiler: sample ≤ N cells/column → derive masks (letter/digit/separator classes) → dominant pattern + off-pattern count → finding with filter action; optional regex input; handle null tokens.
  3. Pair checks: column pickers + operator (≥, >, =, ≈ with tolerance, in-set) → violation scan → finding + filter; date-aware comparison for date columns; arithmetic identity variant (sum of selected columns vs target).
  4. Allowed values: paste/select category set → out-of-set scan → finding + filter; keep merge suggestion separate.
  5. Completeness targets: per-column required/optional flag and threshold input; status colour in the QA summary (feeds the Completeness dimension score in task 9).
  6. Freshness: pick date column → latest value vs now (and vs median gap) → severity; reuses date parsing.
  7. Threshold surfacing: editable thresholds for existing drift (PSI/Cramér's V), missing %, similar-value ratio.
  8. Export: extend `src/data/recipe*.ts` pattern — generate SodaCL YAML / dbt YAML / GX JSON / DQDL text + support report for checks that need manual translation; add schema expectations block.
  9. Score engine: `src/data/score.ts` — dimension pass-rates derived from existing stats/findings + configurable weights/bands; extend the worker protocol with the score payload; score tile + breakdown UI; Process Log score delta per step; include the score in the DQ report export.
  10. Tests: extend `test/` (node:test via tsx) with fixtures per check family and deterministic score cases (N.A. exclusion, weight renormalisation, delta after a fix); bench additions for composite-key hashing, pattern profiling and score recompute at 100k/500k.
- **Dependencies**: none new — JS RegExp, existing hashing/sampling/worker protocol, existing findings + recipe modules; the score engine is pure functions over existing stats/findings with no new packages. Reference-file checks (#P3/4b) depend on a future multi-file UI concept (park unless needed).
- **Success Criteria**: every row of the gap table (#1–#9, #11) implemented or explicitly deferred with a decision note; each new check produces a Finding with ≥1 fix action and appears in the Process Log; **the score is deterministic, excludes N.A. results, moves correctly when fixes land (e.g. sentinel policy raises Completeness, decimal repair raises Validity) and recomputes within the 500 ms budget at 100k rows**; latency budgets hold overall (pattern profiling on sample only; no keystroke-path regression); export files validate against SodaCL/dbt/DQDL syntax for the covered subset; `npm test`, `npm run typecheck` green.
