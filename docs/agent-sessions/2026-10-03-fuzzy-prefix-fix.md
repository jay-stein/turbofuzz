# 2026-10-03 — Fuzzy prefix bug fix

## Symptom

Typing a prefix of an identifier-like value (`MAC000007`) in Fuzzy mode
returned nothing for 3-7 character queries, e.g. `MAC`, `MAC0`, `MAC00`.

## Root cause

- Queries of 3+ characters use bigram-vote candidates, which apply an edit
  distance length window (`|token.length - query.length| > 2` -> drop). For
  `mac` (3) against `mac000007` (9) the difference is 6, so the token was
  discarded **before** Jaro-Winkler ever scored it (JW would give ~0.85).
- Queries of 1-2 characters only matched token *prefixes*, never tokens that
  contain the text mid-token.

## Fix

- `candidates()` unions prefix matches (binary search over the sorted token
  dictionary) into the bigram candidate set; prefix matches bypass the length
  window and are then scored normally by Jaro-Winkler.
- `matchShort()` handles 1-2 character queries as prefix **or** containment
  over the token dictionary.

## Verification

- 63 tests pass; new `test/fuzzy.test.ts` covers every prefix length of
  `MAC000007`, mid-token `MA` matching, typos (`MOC000007`, `MAC00007`,
  `MACOO0007`) and unrelated-token exclusion.
- `bench:real` at 1M rows: fuzzy typing p50 0.69 ms / p95 5.9 ms — unchanged
  within noise.
