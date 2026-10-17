# TurboFuzz latency benchmark — views, edits and filters

- Date: 2026-10-12T08:11:43.113Z
- Machine: 12th Gen Intel(R) Core(TM) i5-12500H
- Platform: win32 10.0.26200 x64
- Node: v24.13.0
- Iterations per case: 20 (p50/p95 reported)

## 100,000 rows

Dataset build: 281 ms · RSS after build 175 MB

| Operation | Budget | p50 | p95 | Verdict |
|---|---|---|---|---|
| Active view: count + sum + mean by status (8 groups) | 50 ms | 26.4 ms | 35.0 ms | pass |
| Time view: rows + sum by install month (gap fill) | 50 ms | 35.1 ms | 40.3 ms | pass |
| High cardinality: count by nmi (top 500 of many groups) | 100 ms | 77.8 ms | 78.0 ms | pass |
| Expression measure: sum(annual_usage) / count(*) by status | 50 ms | 25.1 ms | 30.3 ms | pass |
| Clean commit: trim one column and rebuild the dataset | 500 ms | 144 ms | 150 ms | pass |
| Filter keystroke: contains scan + sort (QueryEngine) | 50 ms | 3.32 ms | 4.29 ms | pass |

## 300,000 rows

Dataset build: 685 ms · RSS after build 518 MB

| Operation | Budget | p50 | p95 | Verdict |
|---|---|---|---|---|
| Active view: count + sum + mean by status (8 groups) | 50 ms | 77.4 ms | 80.5 ms | **slow** |
| Time view: rows + sum by install month (gap fill) | 50 ms | 110 ms | 115 ms | **slow** |
| High cardinality: count by nmi (top 500 of many groups) | 100 ms | 264 ms | 375 ms | **slow** |
| Expression measure: sum(annual_usage) / count(*) by status | 50 ms | 77.3 ms | 93.7 ms | **slow** |
| Clean commit: trim one column and rebuild the dataset | 500 ms | 307 ms | 321 ms | pass |
| Filter keystroke: contains scan + sort (QueryEngine) | 50 ms | 10.9 ms | 12.5 ms | pass |

Budgets follow the review's section 7: active view recompute < 50 ms at
100k rows (≤ 3 measures), > 10k groups never blocks > 100 ms, instant
clean/transform commit < 500 ms. The 300k run is the paste-limit ceiling.

## Decision: the 300k budget

The 50 ms active-view budget is defined at 100k rows and the app passes it
with headroom (22–38 ms p50). At the 300k paste-limit the same views take
77–264 ms: still interactive (one frame hitch at worst, keystrokes remain
fast because filters stay at ~11 ms), but deliberately over the stated
budget. **Decision (2026-10-12): keep the 50 ms target at 100k rows, do not
raise it, and do not add a 300k budget.** 300k remains a supported but
soft-degraded ceiling; the remediation path (WebAssembly kernels or
incremental aggregation) is logged as a follow-up rather than silently
loosening the number. `test/perf-guard.test.ts` fails at 100× the p50 so
accidental O(n²) regressions are caught long before the budget argues about
milliseconds.

