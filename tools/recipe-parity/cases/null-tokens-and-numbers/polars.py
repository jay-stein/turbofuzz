# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Every applied step is generated below.

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv")

# Clean: amount
df = df.with_columns(pl.col("amount").str.replace_all(".", "", literal=True).str.replace_all(",", ".", literal=True).str.replace_all(r"[^0-9eE+\-.]", "").cast(pl.Float64, strict=False).alias("amount"))

# Missing-value policy
df = df.with_columns(pl.when(pl.col("note").is_in(["TBC"])).then(None).otherwise(pl.col("note")).alias("note"))

df.write_csv("cleaned.csv")
