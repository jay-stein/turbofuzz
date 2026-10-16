# TurboFuzz pandas recipe — generated from the applied Recipe.
# Requirements: pip install pandas  (pandas >= 2.0 for format="mixed" parsing)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → Python date objects (datetime64, midnight);
#   datetime → datetime64[ns] (naive timestamps are read as UTC);
#   time → Python time; duration → timedelta64.
# Nulls: pandas NaN/NaT; unparseable values become NaN/NaT via errors="coerce".
# Every applied step is generated below.

import pandas as pd

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pd.read_csv("input.csv")

# Transform
df["when"] = pd.to_datetime(dict(year=df["year"], month=df["month"], day=df["day"]), errors="coerce")
df["when"] = df["when"].dt.date
df = df.drop(columns=["year", "month", "day"])

df.to_csv("cleaned.csv", index=False)
