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

# Clean: name
df["name"] = df["name"].str.strip().str.replace(r"\s+", " ", regex=True)
df["name"] = df["name"].str.title()

# Clean: city
df["city"] = df["city"].str.strip().str.replace(r"\s+", " ", regex=True)
df["city"] = df["city"].str.title()
df["city"] = df["city"].str.replace("Fremantel", "Fremantle", regex=False)

df.to_csv("cleaned.csv", index=False)
