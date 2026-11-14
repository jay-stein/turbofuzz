# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Non-equivalent steps (review before trusting the output):
#   ~ splitColumn: code — new columns are appended at the end of the frame

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv", schema_overrides={"code": pl.Utf8})

# Missing values as TurboFuzz counts them (any case, padded with spaces)
_tf_missing = ["-", "--", "---", "----", "—", "–", "?", "??", "???", "...", "…", "####", "null", "nil", "none", "nan", "na", "n/a", "n.a", "n.a.", "#n/a", "undefined", "missing", "unknown", "unspecified", "tbd", "tba", "empty", "blank", "(empty)", "(blank)", "(null)", "[empty]", "[blank]", "[null]", "<na>", "<null>", "<none>", "not available", "not applicable", "not provided", "not specified", "no data", "no value", "no answer", "no response", "null value", "none supplied", "\\n", "#value!", "#div/0!", "#ref!", "#name?", "#num!", "#null!", "#error!", "error", "#error"]
_tf_keep = {}
df = df.with_columns([
    pl.when(pl.col(c).str.strip_chars().str.to_lowercase().is_in(_tf_missing) & ~pl.col(c).is_in(_tf_keep.get(c, [])))
    .then(None).otherwise(pl.col(c)).alias(c)
    for c in df.columns if df.schema[c] == pl.Utf8
])

# Transform
_split = pl.col("code").str.split("-")
_split_width = int(df["code"].str.split("-").list.len().max() or 0)
_split_fields = [f"part_{i + 1}" for i in range(_split_width)]
df = df.with_columns(_split.list.to_struct(fields=_split_fields).alias("_split"))
df = df.unnest("_split")

df.write_csv("cleaned.csv")
