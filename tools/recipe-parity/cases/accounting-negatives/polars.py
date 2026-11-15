# TurboFuzz Polars recipe — generated from the applied Recipe.
# Written for Polars 2.1 (tested with Polars 2.1.0). Install: pip install "polars>=2.1,<3"
#   Also passes the same checks on Polars 1.44.2; versions older than that are untested.
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Every applied step is generated below.

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv")

# Missing values as TurboFuzz counts them (any case, padded with spaces)
_tf_missing = ["-", "--", "---", "----", "—", "–", "?", "??", "???", "...", "…", "####", "null", "nil", "none", "nan", "na", "n/a", "n.a", "n.a.", "#n/a", "undefined", "missing", "unknown", "unspecified", "tbd", "tba", "empty", "blank", "(empty)", "(blank)", "(null)", "[empty]", "[blank]", "[null]", "<na>", "<null>", "<none>", "not available", "not applicable", "not provided", "not specified", "no data", "no value", "no answer", "no response", "null value", "none supplied", "\\n", "#value!", "#div/0!", "#ref!", "#name?", "#num!", "#null!", "#error!", "error", "#error"]
_tf_keep = {}
df = df.with_columns([
    pl.when(pl.col(c).str.strip_chars().str.to_lowercase().is_in(_tf_missing) & ~pl.col(c).is_in(_tf_keep.get(c, [])))
    .then(None).otherwise(pl.col(c)).alias(c)
    for c in df.columns if df.schema[c] == pl.Utf8
])

# Clean: dot_amount
df = df.with_columns(pl.col("dot_amount").str.replace("^\\s*\\(([^()]*)\\)\\s*$", "-${1}").str.replace_all(r"[^0-9eE+\-.]", "").cast(pl.Float64, strict=False).alias("dot_amount"))

# Clean: comma_amount
df = df.with_columns(pl.col("comma_amount").str.replace("^\\s*\\(([^()]*)\\)\\s*$", "-${1}").str.replace_all(".", "", literal=True).str.replace_all(",", ".", literal=True).str.replace_all(r"[^0-9eE+\-.]", "").cast(pl.Float64, strict=False).alias("comma_amount"))

df.write_csv("cleaned.csv")
