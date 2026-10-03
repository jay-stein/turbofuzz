# TurboFuzz fuzzy search benchmark

- Date: 2026-10-03T07:19:16.453Z
- Machine: 12th Gen Intel(R) Core(TM) i5-12500H
- Platform: win32 10.0.26200 x64
- Node: v24.13.0
- Seed: 42
- Query iterations (max): 25
- Scoring: Jaro-Winkler >= 0.72, top 100 tokens

## 10,000 rows

- Distinct tokens: **135** from 10,000 values
- Token postings: 20,000, bigrams indexed: 668
- Custom index build: 13.3 ms dict + 0.41 ms grams = **13.9 ms**
- RSS after ingest (10 string columns) + index: 86 MB
- Column scans: usage parse 1.28 ms, year parse 0.54 ms, category bitset 0.69 ms

### Baseline build times

| engine | build ms |
| --- | --- |
| flexsearch | 41.8 |
| fuse.js | 5.86 |
| ufuzzy | 2.18 |
| linear substring | 12.1 |

### Fuzzy query latency (p50 / p95 ms, matches capped at 1,000)

| query | engine | p50 | p95 | matches |
| --- | --- | --- | --- | --- |
| Johnson (exact) | custom token k=2 | 0.09 | 0.21 | 1,195 |
| Johnson (exact) | custom token k=1 | 0.01 | 0.02 | 682 |
| Johnson (exact) | flexsearch | 0.00 | 0.02 | 166 |
| Johnson (exact) | fuse.js | 17.0 | 20.1 | 684 |
| Johnson (exact) | ufuzzy | 0.66 | 1.06 | 166 |
| Johnson (exact) | linear substring | 0.40 | 0.54 | 166 |
| Jonson (1 substitution) | custom token k=2 | 0.06 | 0.08 | 1,823 |
| Jonson (1 substitution) | custom token k=1 | 0.03 | 0.05 | 973 |
| Jonson (1 substitution) | flexsearch | 0.00 | 0.00 | 167 |
| Jonson (1 substitution) | fuse.js | 16.8 | 22.6 | 975 |
| Jonson (1 substitution) | ufuzzy | 0.46 | 0.72 | 167 |
| Jonson (1 substitution) | linear substring | 0.42 | 0.61 | 167 |
| Jhonson (1 insertion) | custom token k=2 | 0.01 | 0.02 | 1,370 |
| Jhonson (1 insertion) | custom token k=1 | 0.01 | 0.01 | 508 |
| Jhonson (1 insertion) | flexsearch | 0.00 | 0.00 | 0 |
| Jhonson (1 insertion) | fuse.js | 16.6 | 18.2 | 333 |
| Jhonson (1 insertion) | ufuzzy | 0.33 | 0.43 | 0 |
| Jhonson (1 insertion) | linear substring | 0.36 | 0.65 | 0 |
| Johnston | custom token k=2 | 0.01 | 0.01 | 682 |
| Johnston | custom token k=1 | 0.00 | 0.00 | 354 |
| Johnston | flexsearch | 0.00 | 0.03 | 188 |
| Johnston | fuse.js | 21.1 | 22.9 | 734 |
| Johnston | ufuzzy | 0.51 | 0.73 | 188 |
| Johnston | linear substring | 0.44 | 0.75 | 188 |
| Johnsen | custom token k=2 | 0.01 | 0.01 | 810 |
| Johnsen | custom token k=1 | 0.00 | 0.01 | 515 |
| Johnsen | flexsearch | 0.00 | 0.01 | 161 |
| Johnsen | fuse.js | 16.9 | 18.0 | 694 |
| Johnsen | ufuzzy | 0.49 | 0.79 | 161 |
| Johnsen | linear substring | 0.46 | 0.80 | 161 |
| Smith (exact) | custom token k=2 | 0.01 | 0.01 | 519 |
| Smith (exact) | custom token k=1 | 0.00 | 0.00 | 519 |
| Smith (exact) | flexsearch | 0.00 | 0.00 | 348 |
| Smith (exact) | fuse.js | 22.0 | 29.1 | 1,000 |
| Smith (exact) | ufuzzy | 0.62 | 1.83 | 348 |
| Smith (exact) | linear substring | 0.40 | 0.59 | 348 |
| Smyth | custom token k=2 | 0.00 | 0.01 | 519 |
| Smyth | custom token k=1 | 0.00 | 0.00 | 519 |
| Smyth | flexsearch | 0.00 | 0.00 | 171 |
| Smyth | fuse.js | 25.2 | 31.3 | 759 |
| Smyth | ufuzzy | 0.77 | 1.05 | 171 |
| Smyth | linear substring | 0.70 | 0.86 | 171 |
| Jo (short prefix) | custom token k=2 | 0.08 | 0.19 | 1,218 |
| Jo (short prefix) | custom token k=1 | 0.09 | 0.19 | 1,218 |
| Jo (short prefix) | flexsearch | 0.00 | 0.01 | 1,000 |
| Jo (short prefix) | fuse.js | 10.2 | 11.3 | 1,000 |
| Jo (short prefix) | ufuzzy | 0.37 | 0.68 | 1,218 |
| Jo (short prefix) | linear substring | 0.60 | 0.76 | 1,218 |
| Xyzzy (no match) | custom token k=2 | 0.01 | 0.02 | 0 |
| Xyzzy (no match) | custom token k=1 | 0.01 | 0.01 | 0 |
| Xyzzy (no match) | flexsearch | 0.00 | 0.00 | 0 |
| Xyzzy (no match) | fuse.js | 18.7 | 26.9 | 0 |
| Xyzzy (no match) | ufuzzy | 0.20 | 0.30 | 0 |
| Xyzzy (no match) | linear substring | 0.33 | 0.36 | 0 |

### Custom token index — stage breakdown and recall (k=2, profiled single run)

| query | candidates | scored | cand ms | score ms | expand ms | token recall vs JW>=0.72 (within ±k) | GT tokens in window | GT tokens outside window |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Johnson (exact) | 12 | 7 | 0.01 | 0.01 | 0.03 | 88% | 8 | 1 |
| Jonson (1 substitution) | 22 | 12 | 0.00 | 0.01 | 0.05 | 100% | 12 | 0 |
| Jhonson (1 insertion) | 17 | 8 | 0.00 | 0.05 | 0.01 | 100% | 8 | 1 |
| Johnston | 4 | 4 | 0.00 | 0.00 | 0.00 | 80% | 5 | 2 |
| Johnsen | 5 | 5 | 0.00 | 0.00 | 0.00 | 71% | 7 | 2 |
| Smith (exact) | 9 | 3 | 0.00 | 0.00 | 0.00 | 100% | 3 | 0 |
| Smyth | 8 | 3 | 0.00 | 0.00 | 0.00 | 100% | 3 | 0 |
| Jo (short prefix) | 8 | 8 | 0.01 | 0.00 | 0.06 | n/a | 0 | 0 |
| Xyzzy (no match) | 0 | 0 | 0.00 | 0.00 | 0.01 | n/a | 0 | 0 |

Recall is measured against tokens scoring JW >= 0.72 that also fall inside the ±k length window. Tokens outside the window (for example the short token "john" when searching "johnston") are intentionally pruned to protect precision; the last column shows how many such tokens exist.

### Engine summary (mean of per-query p95)

| engine | mean p95 ms |
| --- | --- |
| custom token k=2 | 0.06 |
| custom token k=1 | 0.03 |
| flexsearch | 0.01 |
| fuse.js | 22.3 |
| ufuzzy | 0.84 |
| linear substring | 0.66 |

### End-to-end combined query

Fuzzy "Jonson" (k=2) AND annual_usage 20000-60000 AND year 2022-2025 AND status in {Active, Trial}

| p50 | p95 | matches |
| --- | --- | --- |
| 0.32 | 0.73 | 63 |

## 50,000 rows

- Distinct tokens: **135** from 50,000 values
- Token postings: 100,000, bigrams indexed: 668
- Custom index build: 75.2 ms dict + 0.09 ms grams = **75.4 ms**
- RSS after ingest (10 string columns) + index: 164 MB
- Column scans: usage parse 7.11 ms, year parse 5.57 ms, category bitset 0.95 ms

### Baseline build times

| engine | build ms |
| --- | --- |
| flexsearch | 241 |
| fuse.js | 10.1 |
| ufuzzy | 0.12 |
| linear substring | 19.9 |

### Fuzzy query latency (p50 / p95 ms, matches capped at 1,000)

| query | engine | p50 | p95 | matches |
| --- | --- | --- | --- | --- |
| Johnson (exact) | custom token k=2 | 0.04 | 0.05 | 5,791 |
| Johnson (exact) | custom token k=1 | 0.03 | 0.05 | 3,237 |
| Johnson (exact) | flexsearch | 0.00 | 0.01 | 775 |
| Johnson (exact) | fuse.js | 130 | 138 | 1,000 |
| Johnson (exact) | ufuzzy | 4.00 | 5.87 | 775 |
| Johnson (exact) | linear substring | 2.50 | 3.76 | 775 |
| Jonson (1 substitution) | custom token k=2 | 0.07 | 0.12 | 8,872 |
| Jonson (1 substitution) | custom token k=1 | 0.05 | 0.07 | 4,716 |
| Jonson (1 substitution) | flexsearch | 0.00 | 0.01 | 809 |
| Jonson (1 substitution) | fuse.js | 94.3 | 124 | 1,000 |
| Jonson (1 substitution) | ufuzzy | 4.11 | 5.28 | 809 |
| Jonson (1 substitution) | linear substring | 2.46 | 3.17 | 809 |
| Jhonson (1 insertion) | custom token k=2 | 0.06 | 0.09 | 6,658 |
| Jhonson (1 insertion) | custom token k=1 | 0.04 | 0.06 | 2,451 |
| Jhonson (1 insertion) | flexsearch | 0.00 | 0.00 | 0 |
| Jhonson (1 insertion) | fuse.js | 117 | 130 | 1,000 |
| Jhonson (1 insertion) | ufuzzy | 1.56 | 2.34 | 0 |
| Jhonson (1 insertion) | linear substring | 2.09 | 3.18 | 0 |
| Johnston | custom token k=2 | 0.04 | 0.04 | 3,237 |
| Johnston | custom token k=1 | 0.04 | 0.05 | 1,615 |
| Johnston | flexsearch | 0.00 | 0.00 | 840 |
| Johnston | fuse.js | 135 | 153 | 1,000 |
| Johnston | ufuzzy | 3.45 | 4.65 | 840 |
| Johnston | linear substring | 2.19 | 3.26 | 840 |
| Johnsen | custom token k=2 | 0.02 | 0.02 | 3,856 |
| Johnsen | custom token k=1 | 0.02 | 0.02 | 2,428 |
| Johnsen | flexsearch | 0.00 | 0.00 | 813 |
| Johnsen | fuse.js | 120 | 133 | 1,000 |
| Johnsen | ufuzzy | 3.56 | 4.62 | 813 |
| Johnsen | linear substring | 2.40 | 3.51 | 813 |
| Smith (exact) | custom token k=2 | 0.04 | 0.04 | 2,473 |
| Smith (exact) | custom token k=1 | 0.04 | 0.06 | 2,473 |
| Smith (exact) | flexsearch | 0.01 | 0.01 | 1,000 |
| Smith (exact) | fuse.js | 111 | 135 | 1,000 |
| Smith (exact) | ufuzzy | 2.47 | 3.47 | 1,664 |
| Smith (exact) | linear substring | 2.66 | 3.39 | 1,664 |
| Smyth | custom token k=2 | 0.04 | 0.05 | 2,473 |
| Smyth | custom token k=1 | 0.04 | 0.04 | 2,473 |
| Smyth | flexsearch | 0.00 | 0.01 | 809 |
| Smyth | fuse.js | 90.1 | 107 | 1,000 |
| Smyth | ufuzzy | 2.36 | 4.23 | 809 |
| Smyth | linear substring | 2.83 | 3.75 | 809 |
| Jo (short prefix) | custom token k=2 | 0.06 | 0.16 | 5,849 |
| Jo (short prefix) | custom token k=1 | 0.05 | 0.09 | 5,849 |
| Jo (short prefix) | flexsearch | 0.00 | 0.00 | 1,000 |
| Jo (short prefix) | fuse.js | 38.2 | 43.5 | 1,000 |
| Jo (short prefix) | ufuzzy | 2.50 | 3.66 | 5,849 |
| Jo (short prefix) | linear substring | 2.41 | 3.11 | 5,849 |
| Xyzzy (no match) | custom token k=2 | 0.01 | 0.01 | 0 |
| Xyzzy (no match) | custom token k=1 | 0.01 | 0.01 | 0 |
| Xyzzy (no match) | flexsearch | 0.00 | 0.00 | 0 |
| Xyzzy (no match) | fuse.js | 84.0 | 98.0 | 0 |
| Xyzzy (no match) | ufuzzy | 1.24 | 2.56 | 0 |
| Xyzzy (no match) | linear substring | 2.14 | 2.76 | 0 |

### Custom token index — stage breakdown and recall (k=2, profiled single run)

| query | candidates | scored | cand ms | score ms | expand ms | token recall vs JW>=0.72 (within ±k) | GT tokens in window | GT tokens outside window |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Johnson (exact) | 12 | 7 | 0.01 | 0.01 | 0.02 | 88% | 8 | 1 |
| Jonson (1 substitution) | 22 | 12 | 0.00 | 0.01 | 0.04 | 100% | 12 | 0 |
| Jhonson (1 insertion) | 17 | 8 | 0.00 | 0.01 | 0.02 | 100% | 8 | 1 |
| Johnston | 4 | 4 | 0.00 | 0.00 | 0.01 | 80% | 5 | 2 |
| Johnsen | 5 | 5 | 0.00 | 0.00 | 0.01 | 71% | 7 | 2 |
| Smith (exact) | 9 | 3 | 0.00 | 0.01 | 0.02 | 100% | 3 | 0 |
| Smyth | 8 | 3 | 0.00 | 0.00 | 0.01 | 100% | 3 | 0 |
| Jo (short prefix) | 8 | 8 | 0.00 | 0.00 | 0.02 | n/a | 0 | 0 |
| Xyzzy (no match) | 0 | 0 | 0.00 | 0.00 | 0.00 | n/a | 0 | 0 |

Recall is measured against tokens scoring JW >= 0.72 that also fall inside the ±k length window. Tokens outside the window (for example the short token "john" when searching "johnston") are intentionally pruned to protect precision; the last column shows how many such tokens exist.

### Engine summary (mean of per-query p95)

| engine | mean p95 ms |
| --- | --- |
| custom token k=2 | 0.07 |
| custom token k=1 | 0.05 |
| flexsearch | 0.00 |
| fuse.js | 118 |
| ufuzzy | 4.08 |
| linear substring | 3.32 |

### End-to-end combined query

Fuzzy "Jonson" (k=2) AND annual_usage 20000-60000 AND year 2022-2025 AND status in {Active, Trial}

| p50 | p95 | matches |
| --- | --- | --- |
| 1.83 | 2.63 | 310 |

## 100,000 rows

- Distinct tokens: **135** from 100,000 values
- Token postings: 200,000, bigrams indexed: 668
- Custom index build: 181 ms dict + 0.07 ms grams = **181 ms**
- RSS after ingest (10 string columns) + index: 270 MB
- Column scans: usage parse 16.9 ms, year parse 10.2 ms, category bitset 1.52 ms

### Baseline build times

| engine | build ms |
| --- | --- |
| flexsearch | 385 |
| fuse.js | 18.7 |
| ufuzzy | 0.19 |
| linear substring | 43.6 |

### Fuzzy query latency (p50 / p95 ms, matches capped at 1,000)

| query | engine | p50 | p95 | matches |
| --- | --- | --- | --- | --- |
| Johnson (exact) | custom token k=2 | 0.03 | 0.08 | 11,653 |
| Johnson (exact) | custom token k=1 | 0.04 | 0.06 | 6,604 |
| Johnson (exact) | flexsearch | 0.00 | 0.00 | 1,000 |
| Johnson (exact) | fuse.js | 170 | 202 | 1,000 |
| Johnson (exact) | ufuzzy | 3.89 | 5.60 | 1,576 |
| Johnson (exact) | linear substring | 4.14 | 5.96 | 1,576 |
| Jonson (1 substitution) | custom token k=2 | 0.04 | 0.05 | 17,823 |
| Jonson (1 substitution) | custom token k=1 | 0.03 | 0.06 | 9,522 |
| Jonson (1 substitution) | flexsearch | 0.00 | 0.01 | 1,000 |
| Jonson (1 substitution) | fuse.js | 220 | 234 | 1,000 |
| Jonson (1 substitution) | ufuzzy | 4.72 | 5.56 | 1,670 |
| Jonson (1 substitution) | linear substring | 5.01 | 6.03 | 1,670 |
| Jhonson (1 insertion) | custom token k=2 | 0.06 | 0.08 | 13,352 |
| Jhonson (1 insertion) | custom token k=1 | 0.03 | 0.06 | 4,945 |
| Jhonson (1 insertion) | flexsearch | 0.00 | 0.00 | 0 |
| Jhonson (1 insertion) | fuse.js | 267 | 269 | 1,000 |
| Jhonson (1 insertion) | ufuzzy | 4.93 | 6.27 | 0 |
| Jhonson (1 insertion) | linear substring | 4.78 | 5.69 | 0 |
| Johnston | custom token k=2 | 0.02 | 0.02 | 6,604 |
| Johnston | custom token k=1 | 0.01 | 0.01 | 3,248 |
| Johnston | flexsearch | 0.00 | 0.00 | 1,000 |
| Johnston | fuse.js | 251 | 308 | 1,000 |
| Johnston | ufuzzy | 4.68 | 5.86 | 1,672 |
| Johnston | linear substring | 4.62 | 6.07 | 1,672 |
| Johnsen | custom token k=2 | 0.04 | 0.06 | 7,835 |
| Johnsen | custom token k=1 | 0.03 | 0.03 | 4,934 |
| Johnsen | flexsearch | 0.00 | 0.01 | 1,000 |
| Johnsen | fuse.js | 185 | 188 | 1,000 |
| Johnsen | ufuzzy | 4.79 | 6.84 | 1,686 |
| Johnsen | linear substring | 4.78 | 6.53 | 1,686 |
| Smith (exact) | custom token k=2 | 0.03 | 0.03 | 5,004 |
| Smith (exact) | custom token k=1 | 0.03 | 0.03 | 5,004 |
| Smith (exact) | flexsearch | 0.01 | 0.01 | 1,000 |
| Smith (exact) | fuse.js | 250 | 255 | 1,000 |
| Smith (exact) | ufuzzy | 4.92 | 6.53 | 3,359 |
| Smith (exact) | linear substring | 5.50 | 6.78 | 3,359 |
| Smyth | custom token k=2 | 0.04 | 0.07 | 5,004 |
| Smyth | custom token k=1 | 0.03 | 0.03 | 5,004 |
| Smyth | flexsearch | 0.01 | 0.01 | 1,000 |
| Smyth | fuse.js | 237 | 245 | 1,000 |
| Smyth | ufuzzy | 4.36 | 6.23 | 1,645 |
| Smyth | linear substring | 5.33 | 6.72 | 1,645 |
| Jo (short prefix) | custom token k=2 | 0.07 | 0.09 | 11,893 |
| Jo (short prefix) | custom token k=1 | 0.06 | 0.20 | 11,893 |
| Jo (short prefix) | flexsearch | 0.00 | 0.01 | 1,000 |
| Jo (short prefix) | fuse.js | 81.8 | 81.8 | 1,000 |
| Jo (short prefix) | ufuzzy | 5.05 | 6.04 | 11,893 |
| Jo (short prefix) | linear substring | 4.81 | 5.84 | 11,893 |
| Xyzzy (no match) | custom token k=2 | 0.01 | 0.01 | 0 |
| Xyzzy (no match) | custom token k=1 | 0.01 | 0.01 | 0 |
| Xyzzy (no match) | flexsearch | 0.00 | 0.00 | 0 |
| Xyzzy (no match) | fuse.js | 221 | 240 | 0 |
| Xyzzy (no match) | ufuzzy | 3.19 | 4.96 | 0 |
| Xyzzy (no match) | linear substring | 4.40 | 5.28 | 0 |

### Custom token index — stage breakdown and recall (k=2, profiled single run)

| query | candidates | scored | cand ms | score ms | expand ms | token recall vs JW>=0.72 (within ±k) | GT tokens in window | GT tokens outside window |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Johnson (exact) | 12 | 7 | 0.00 | 0.00 | 0.03 | 88% | 8 | 1 |
| Jonson (1 substitution) | 22 | 12 | 0.00 | 0.01 | 0.06 | 100% | 12 | 0 |
| Jhonson (1 insertion) | 17 | 8 | 0.00 | 0.01 | 0.04 | 100% | 8 | 1 |
| Johnston | 4 | 4 | 0.00 | 0.00 | 0.01 | 80% | 5 | 2 |
| Johnsen | 5 | 5 | 0.00 | 0.00 | 0.03 | 71% | 7 | 2 |
| Smith (exact) | 9 | 3 | 0.00 | 0.00 | 0.02 | 100% | 3 | 0 |
| Smyth | 8 | 3 | 0.00 | 0.00 | 0.02 | 100% | 3 | 0 |
| Jo (short prefix) | 8 | 8 | 0.00 | 0.00 | 0.04 | n/a | 0 | 0 |
| Xyzzy (no match) | 0 | 0 | 0.00 | 0.00 | 0.04 | n/a | 0 | 0 |

Recall is measured against tokens scoring JW >= 0.72 that also fall inside the ±k length window. Tokens outside the window (for example the short token "john" when searching "johnston") are intentionally pruned to protect precision; the last column shows how many such tokens exist.

### Engine summary (mean of per-query p95)

| engine | mean p95 ms |
| --- | --- |
| custom token k=2 | 0.05 |
| custom token k=1 | 0.05 |
| flexsearch | 0.01 |
| fuse.js | 225 |
| ufuzzy | 5.99 |
| linear substring | 6.10 |

### End-to-end combined query

Fuzzy "Jonson" (k=2) AND annual_usage 20000-60000 AND year 2022-2025 AND status in {Active, Trial}

| p50 | p95 | matches |
| --- | --- | --- |
| 3.86 | 4.79 | 642 |

