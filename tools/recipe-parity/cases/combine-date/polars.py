# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Every applied step is generated below.

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv")

# Transform
df = df.with_columns(pl.datetime(year=pl.col("year").cast(pl.Int32, strict=False), month=pl.col("month").cast(pl.Int32, strict=False), day=pl.col("day").cast(pl.Int32, strict=False)).dt.date().alias("when"))
df = df.drop(["year", "month", "day"])

df.write_csv("cleaned.csv")
