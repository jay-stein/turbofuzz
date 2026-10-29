# Data Quality worker latency (npm run bench:dq)

Measured 2026-10-29, 250,000 rows x 6 columns unless stated. p95 over 2-3 runs after one warm-up.

| Work | p95 | Budget |
|---|---|---|
| First insight: load and profile | 324 ms | 1500 ms |
| Rows affected | 110 ms | 600 ms |
| Exceptions export | 180 ms | 1200 ms |
| Rules evaluation (5 rules) | 40 ms | 300 ms |
| Full profile + sensitivity pass, 71 columns x 5,000 rows | 123 ms | 3000 ms |

Wired into `npm run gate`. Budgets come from `constraints.performance` in the DQ plan.
