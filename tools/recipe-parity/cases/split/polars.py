# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Non-equivalent steps (review before trusting the output):
#   ~ splitColumn: code — new columns are appended at the end of the frame

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv")

# Transform
_split = pl.col("code").str.split("-")
_split_width = int(df["code"].str.split("-").list.len().max() or 0)
_split_fields = [f"part_{i + 1}" for i in range(_split_width)]
df = df.with_columns(_split.list.to_struct(fields=_split_fields).alias("_split"))
df = df.unnest("_split")

df.write_csv("cleaned.csv")
