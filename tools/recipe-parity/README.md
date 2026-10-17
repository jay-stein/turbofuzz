# Recipe parity harness

Executes the generated pandas and Polars recipes against the same fixtures and
compares their output with TurboFuzz's own result for that operation history.

## Run

From the repo root:

```powershell
# 1. Generate the fixtures and both scripts (Node side)
npx tsx tools/recipe-parity/make_cases.ts

# 2. Create a Python environment with the libraries
python -m venv .venv-recipe-parity
.\.venv-recipe-parity\Scripts\pip install -r tools\recipe-parity\requirements.txt

# 3. Execute and compare
.\.venv-recipe-parity\Scripts\python.exe tools\recipe-parity\run_parity.py
```

On macOS/Linux use `.venv-recipe-parity/bin/python`.

The runner exits non-zero on any difference and prints the failing cell, so it
can be wired into CI once a Python environment with `pandas` and `polars` is
available. The Node test suite (`test/recipe.test.ts`,
`test/recipe-polars.test.ts`) covers generator shape and the support contract;
this harness is the execution check.

## How it works

`make_cases.ts` writes, per case:

- `input.csv` — verbatim source cells;
- `expected.csv` — the result of applying the same operations through the
  TurboFuzz runtime (`applyCleanOps`, logical types, `applyTransformOps`) and
  exporting with the app's canonical CSV writer;
- `pandas.py` / `polars.py` — the generated scripts (they always read
  `input.csv` and write `cleaned.csv`).

`run_parity.py` copies each case into a temp directory, runs each script, and
compares cell by cell (numbers numerically, blanks as empty). Column order and
names must match exactly.

Cases cover: value cleanup, comma-locale numbers, extra null tokens, date
typing, dedupe, mean imputation, melt defaults, group-by mean, delimiter split
and combineDate. Manual-step and reader-dependent operations (KNN, outlier
flags, keep-token policies) are intentionally out of the executed set — their
contract is covered by the Node-level support-report tests.
