# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Every applied step is generated below.

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv")

# Clean: region
df = df.with_columns(pl.when(pl.int_range(pl.len()) == 0).then(pl.lit("West")).otherwise(pl.col("region")).alias("region"))  # was "North"
df = df.with_columns(pl.when(pl.int_range(pl.len()) == 2).then(pl.lit(None)).otherwise(pl.col("region")).alias("region"))  # was "East"

df.write_csv("cleaned.csv")
