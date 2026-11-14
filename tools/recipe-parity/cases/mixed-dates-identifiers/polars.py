# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Every applied step is generated below.

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv", schema_overrides={"postcode": pl.Utf8, "order_date": pl.Utf8})

# Clean: order_date
_tf_formats = ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S%.f%#z", "%Y-%m-%dT%H:%M:%S%.f%#z", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%y", "%d-%m-%y", "%d.%m.%y", "%d %b %Y", "%d-%b-%Y", "%b %d, %Y", "%d %B %Y", "%B %d, %Y"]
def _tf_read(name, fmt):
    parsed = pl.col(name).str.to_datetime(fmt, strict=False, time_zone="UTC")
    return pl.when(parsed.dt.year() >= 100).then(parsed)  # %Y also takes 2-digit years; %y reads those
df = df.with_columns(pl.coalesce(pl.coalesce([_tf_read("order_date", f) for f in _tf_formats]).dt.strftime("%Y-%m-%d"), pl.col("order_date")).alias("order_date"))

df.write_csv("cleaned.csv")
