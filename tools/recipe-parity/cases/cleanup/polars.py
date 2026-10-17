# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Every applied step is generated below.

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv")

# Clean: name
df = df.with_columns(pl.col("name").str.strip_chars().str.replace_all(r"\s+", " ").alias("name"))
df = df.with_columns(pl.col("name").str.to_titlecase().alias("name"))

# Clean: city
df = df.with_columns(pl.col("city").str.strip_chars().str.replace_all(r"\s+", " ").alias("city"))
df = df.with_columns(pl.col("city").str.to_titlecase().alias("city"))
df = df.with_columns(pl.col("city").str.replace_all("Fremantel", "Fremantle", literal=True).alias("city"))

df.write_csv("cleaned.csv")
