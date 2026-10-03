# 2026-10-03 — Stage 0 fuzzy search benchmark harness

## Goal

Settle the highest-risk design decision for `table-fuzzy-search` empirically before
building any UI: which fuzzy-search approach meets a p95 <= 10 ms keystroke latency
at 100k rows, and what data structures make it possible.

## Decisions

- Standalone git repo initialised in `Projects/table-fuzzy-search` (branch `main`,
  work on `agent/benchmark-harness`). Hosting target: Cloudflare Pages
  (custom headers, unlimited free bandwidth).
- Custom token-level index chosen as the candidate architecture: tokenize cell
  values, dictionary-encode distinct tokens, bigram posting lists + 26-bit letter
  masks + length window for candidate generation, Jaro-Winkler on survivors,
  expansion to rows via posting lists, BitSet for filter intersection.
- Fuse.js is confirmed unusable in the hot path (225 ms mean p95 at 100k).
- FlexSearch is fast but typo-blind (`Jhonson` -> 0 matches) and caps results.
- uFuzzy and linear substring scan are typo-blind and ~6 ms at 100k.

## Files changed

- `package.json`, `tsconfig.json`, `.gitignore`
- `bench/lib/{prng,normalize,jaro-winkler,bitset}.ts`
- `bench/fuzzy-index.ts` — custom token index
- `bench/data.ts` — seeded synthetic dataset generator
- `bench/baselines/{types,linear,fuse,flexsearch,ufuzzy}.ts`
- `bench/bench-utils.ts`, `bench/run.ts` — harness and report generator
- `bench/results.md` — recorded baseline results

## Commands executed

```bash
git init -b main
git add plan.md && git commit -m "docs: add project plan"
git checkout -b agent/benchmark-harness
npm install --save-dev typescript tsx @types/node fuse.js flexsearch@0.7.43 @types/flexsearch @leeoniya/ufuzzy
npm run typecheck
npm run bench:quick
npm run bench -- --out=bench/results.md
```

## Results (i5-12500H, Node 24, seed 42, 10 string columns)

| size | custom build | custom query p95 | end-to-end p95 | fuse.js p95 | flexsearch | ufuzzy |
|---|---|---|---|---|---|---|
| 10k | 14 ms | 0.06 ms | 0.73 ms | 22 ms | fast, typo-blind | 0.8 ms |
| 50k | 75 ms | 0.07 ms | 2.6 ms | 118 ms | fast, typo-blind | 4.1 ms |
| 100k | 181 ms | 0.05 ms | 4.8 ms | 225 ms | fast, typo-blind | 6.0 ms |

The 100k end-to-end case runs fuzzy name search AND numeric range AND year range
AND category filter, i.e. full-column scans plus bitset intersections, in ~5 ms.

## Open issues / follow-ups

- Within-window token recall is 71-100% for some queries (bigram vote threshold
  prunes a few JW-matching tokens). Tune `minVotes` or fall back to edit-distance
  candidate caps; measure precision/recall on real data.
- Dataset token diversity is low (135 distinct tokens). Re-run with a
  high-cardinality column (company/address-like) to stress the trigram maps.
- Type inference and per-column override UI not benchmarked yet.
- `opencode export` session export not captured in repo (see global workflow).

## Branch state

Commits on `agent/benchmark-harness`:

- `6b8bab0` feat(bench): add fuzzy search benchmark harness
- `5ab2abc` docs(bench): record 10k/50k/100k baseline results
