# TurboFuzz ingestion benchmark

- Date: 2026-10-16T06:05:34.030Z
- Node: v24.13.0
- Sizes: 100,000, 500,000, 1,500,000 rows
- Memory: Node RSS (labelled proxy; not a browser metric)

| Shape | Rows | Cols | Cells | parse | ingest (parse+build+stats) | build+stats | preview p50 | filter p50 | sort p50 | transform | export (rows) | RSS after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| narrow | 100,001 | 3 | 300,000 | 54.4 ms | 278 ms | 214 ms | 0.35 ms | 0.15 ms | 39.1 ms | 136 ms | 265 ms (100,001) | 293 MB |
| wide | 100,001 | 40 | 4,000,000 | 337 ms | 2831 ms | 2186 ms | 0.24 ms | 0.03 ms | 32.3 ms | 875 ms | 976 ms (100,001) | 845 MB |
| strings | 100,001 | 3 | 300,000 | 60.6 ms | 224 ms | 156 ms | 0.24 ms | 0.02 ms | 146 ms | 205 ms | 83.5 ms (100,001) | 1012 MB |
| messy | 100,001 | 5 | 400,000 | 76.6 ms | 363 ms | 221 ms | 0.22 ms | 0.02 ms | 29.7 ms | 113 ms | 113 ms (100,001) | 1213 MB |
| narrow | 500,001 | 3 | 1,500,000 | 278 ms | 1014 ms | 650 ms | 0.84 ms | 0.09 ms | 173 ms | 403 ms | 689 ms (200,000) | 1247 MB |
| strings | 500,001 | 3 | 1,500,000 | 279 ms | 1145 ms | 799 ms | 0.87 ms | 0.08 ms | 1140 ms | 1153 ms | 172 ms (200,000) | 1361 MB |
| messy | 500,001 | 5 | 2,000,000 | 604 ms | 1578 ms | 1114 ms | 0.83 ms | 0.08 ms | 180 ms | 502 ms | 266 ms (200,000) | 1397 MB |
| narrow | 1,500,001 | 3 | 4,500,000 | 1027 ms | 3649 ms | 2330 ms | 2.52 ms | 0.24 ms | 580 ms | 1565 ms | 1357 ms (200,000) | 2187 MB |
| strings | 1,500,001 | 3 | 4,500,000 | 1524 ms | 3660 ms | 2535 ms | 2.54 ms | 0.31 ms | 4530 ms | 4326 ms | 230 ms (200,000) | 2344 MB |
| messy | 1,500,001 | 5 | 6,000,000 | 1228 ms | 5562 ms | 4777 ms | 2.74 ms | 0.31 ms | 569 ms | 1908 ms | 217 ms (200,000) | 2864 MB |
