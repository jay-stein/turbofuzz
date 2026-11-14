# TurboFuzz pandas recipe — generated from the applied Recipe.
# Written for pandas 3.1 (tested with pandas 3.1.1). Install: pip install "pandas>=3.1,<4"
#   Also passes the same checks on pandas 2.3.3; versions older than that are untested.
#   Dates: year-first values are read with format="ISO8601" before format="mixed", because on
#   pandas 3 format="mixed" with dayfirst=True reads 2024-03-05 as 3 May (both need pandas >= 2.0).
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → Python date objects (datetime64, midnight);
#   datetime → datetime64 (naive timestamps are read as UTC; pandas 3 stores µs, 2.x ns);
#   time → Python time; duration → timedelta64.
# Nulls: pandas NaN/NaT; unparseable values become NaN/NaT via errors="coerce".
# Every applied step is generated below.

import pandas as pd

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pd.read_csv("input.csv", dtype={"city": str})

# Missing values as TurboFuzz counts them (any case, padded with spaces)
_tf_missing = ["-", "--", "---", "----", "—", "–", "?", "??", "???", "...", "…", "####", "null", "nil", "none", "nan", "na", "n/a", "n.a", "n.a.", "#n/a", "undefined", "missing", "unknown", "unspecified", "tbd", "tba", "empty", "blank", "(empty)", "(blank)", "(null)", "[empty]", "[blank]", "[null]", "<na>", "<null>", "<none>", "not available", "not applicable", "not provided", "not specified", "no data", "no value", "no answer", "no response", "null value", "none supplied", "\\n", "#value!", "#div/0!", "#ref!", "#name?", "#num!", "#null!", "#error!", "error", "#error"]
_tf_keep = {}
for _c in df.columns:
    if df[_c].dtype == object or pd.api.types.is_string_dtype(df[_c]):
        df[_c] = df[_c].mask(df[_c].str.strip().str.lower().isin(_tf_missing) & ~df[_c].isin(_tf_keep.get(_c, [])))

# Transform
df = df.melt(id_vars=["city"], value_vars=["jan", "feb"], var_name="month", value_name="sales")

df.to_csv("cleaned.csv", index=False)
