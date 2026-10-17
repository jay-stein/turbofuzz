"""Execute the generated pandas/Polars scripts against the parity fixtures.

For every case directory under cases/, this runs each target script in an
isolated temp dir with input.csv, then compares cleaned.csv with expected.csv.

Usage (from the repo root, after generating cases):
    npx tsx tools/recipe-parity/make_cases.ts
    python tools/recipe-parity/run_parity.py

Requires:
    pip install -r tools/recipe-parity/requirements.txt
"""

from __future__ import annotations

import csv
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CASES_DIR = Path(__file__).resolve().parent / "cases"
TARGETS = ("pandas", "polars")


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        header = list(reader.fieldnames or [])
        rows = [{key: (value or "") for key, value in row.items()} for row in reader]
    return header, rows


def cells_equal(left: str, right: str) -> bool:
    left = left.strip()
    right = right.strip()
    if left == right:
        return True
    if left == "" and right == "":
        return True
    try:
        left_number = float(left)
        right_number = float(right)
    except ValueError:
        return False
    if math.isnan(left_number) and math.isnan(right_number):
        return True
    return math.isclose(left_number, right_number, rel_tol=1e-9, abs_tol=1e-9)


def compare(expected_path: Path, actual_path: Path) -> list[str]:
    failures: list[str] = []
    exp_header, exp_rows = read_csv(expected_path)
    act_header, act_rows = read_csv(actual_path)
    if exp_header != act_header:
        failures.append(f"header {act_header!r} != expected {exp_header!r}")
        return failures
    if len(exp_rows) != len(act_rows):
        failures.append(f"row count {len(act_rows)} != expected {len(exp_rows)}")
    for row_index, (expected_row, actual_row) in enumerate(zip(exp_rows, act_rows)):
        for column in exp_header:
            if not cells_equal(expected_row.get(column, ""), actual_row.get(column, "")):
                failures.append(
                    f"row {row_index} column {column!r}: {actual_row.get(column)!r} != {expected_row.get(column)!r}"
                )
    return failures


def run_case(case_dir: Path) -> bool:
    expected = case_dir / "expected.csv"
    ok = True
    for target in TARGETS:
        script = case_dir / f"{target}.py"
        if not script.exists():
            print(f"  {target}: no script (skipped)")
            continue
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            shutil.copy(case_dir / "input.csv", work / "input.csv")
            shutil.copy(script, work / f"{target}_recipe.py")
            result = subprocess.run(
                [sys.executable, f"{target}_recipe.py"],
                cwd=work,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                print(f"  {target}: FAILED to run")
                print(result.stdout)
                print(result.stderr)
                ok = False
                continue
            actual = work / "cleaned.csv"
            if not actual.exists():
                print(f"  {target}: FAILED — cleaned.csv was not written")
                ok = False
                continue
            failures = compare(expected, actual)
            if failures:
                print(f"  {target}: FAILED ({len(failures)} difference(s))")
                for failure in failures[:8]:
                    print(f"    {failure}")
                ok = False
            else:
                print(f"  {target}: PASS")
    return ok


def main() -> int:
    if not CASES_DIR.exists():
        print("No cases found — run: npx tsx tools/recipe-parity/make_cases.ts")
        return 2
    all_ok = True
    for case_dir in sorted(path for path in CASES_DIR.iterdir() if path.is_dir()):
        print(f"case {case_dir.name}")
        all_ok = run_case(case_dir) and all_ok
    print("PARITY PASS" if all_ok else "PARITY FAIL")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
