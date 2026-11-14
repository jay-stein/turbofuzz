# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Non-equivalent steps (review before trusting the output):
#   ~ type: when → date — values like 03/04/2024 are read month first; the type step does not record an order

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv", schema_overrides={"when": pl.Utf8})

# Logical types
_tf_formats = ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S%.f%#z", "%Y-%m-%dT%H:%M:%S%.f%#z", "%m/%d/%Y", "%m-%d-%Y", "%m.%d.%Y", "%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S", "%m/%d/%y", "%m-%d-%y", "%m.%d.%y", "%d %b %Y", "%d-%b-%Y", "%b %d, %Y", "%d %B %Y", "%B %d, %Y"]
def _tf_read(name, fmt):
    parsed = pl.col(name).str.to_datetime(fmt, strict=False, time_zone="UTC")
    return pl.when(parsed.dt.year() >= 100).then(parsed)  # %Y also takes 2-digit years; %y reads those
df = df.with_columns(pl.coalesce([_tf_read("when", f) for f in _tf_formats]).dt.replace_time_zone(None).dt.date().alias("when"))

df.write_csv("cleaned.csv")
