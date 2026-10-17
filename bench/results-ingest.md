# TurboFuzz ingestion benchmark

- Date: 2026-10-16T06:10:44.403Z
- Node: v24.13.0
- Sizes: 100,000, 500,000, 1,500,000 rows
- Memory: Node RSS (labelled proxy; not a browser metric)

| Shape | Rows | Cols | Cells | parse | ingest (parse+build+stats) | build+stats | preview p50 | filter p50 | sort p50 | transform | export (rows) | RSS after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| narrow | 100,001 | 3 | 300,000 | 60.5 ms | 342 ms | 201 ms | 0.51 ms | 0.04 ms | 43.8 ms | 151 ms | 329 ms (100,001) | 297 MB |
| wide | 100,001 | 40 | 4,000,000 | 441 ms | 3180 ms | 2525 ms | 0.24 ms | 0.04 ms | 31.7 ms | 868 ms | 991 ms (100,001) | 824 MB |
| strings | 100,001 | 3 | 300,000 | 52.8 ms | 246 ms | 191 ms | 0.25 ms | 0.02 ms | 156 ms | 194 ms | 84.4 ms (100,001) | 960 MB |
| messy | 100,001 | 5 | 400,000 | 75.8 ms | 352 ms | 233 ms | 0.25 ms | 0.02 ms | 36.7 ms | 121 ms | 121 ms (100,001) | 1118 MB |
| narrow | 500,001 | 3 | 1,500,000 | 268 ms | 1165 ms | 732 ms | 0.87 ms | 0.08 ms | 186 ms | 385 ms | 725 ms (200,000) | 1171 MB |
| strings | 500,001 | 3 | 1,500,000 | 289 ms | 1221 ms | 823 ms | 0.91 ms | 0.09 ms | 1445 ms | 1232 ms | 210 ms (200,000) | 1149 MB |
| messy | 500,001 | 5 | 2,000,000 | 436 ms | 1955 ms | 1552 ms | 1.02 ms | 0.12 ms | 199 ms | 614 ms | 268 ms (200,000) | 1125 MB |
| narrow | 1,500,001 | 3 | 4,500,000 | 1084 ms | 4130 ms | 2567 ms | 2.79 ms | 0.28 ms | 684 ms | 1765 ms | 1641 ms (200,000) | 2033 MB |
| strings | 1,500,001 | 3 | 4,500,000 | 1277 ms | 4368 ms | 3563 ms | 2.57 ms | 0.31 ms | 4762 ms | 4091 ms | 198 ms (200,000) | 2139 MB |
| messy | 1,500,001 | 5 | 6,000,000 | 1169 ms | 5482 ms | 3776 ms | 2.63 ms | 0.33 ms | 607 ms | 1876 ms | 264 ms (200,000) | 2858 MB |
