# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Every applied step is generated below.

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv", schema_overrides={"postcode": pl.Utf8, "order_date": pl.Utf8})

# Missing values as TurboFuzz counts them (any case, padded with spaces)
_tf_missing = ["-", "--", "---", "----", "—", "–", "?", "??", "???", "...", "…", "####", "null", "nil", "none", "nan", "na", "n/a", "n.a", "n.a.", "#n/a", "undefined", "missing", "unknown", "unspecified", "tbd", "tba", "empty", "blank", "(empty)", "(blank)", "(null)", "[empty]", "[blank]", "[null]", "<na>", "<null>", "<none>", "not available", "not applicable", "not provided", "not specified", "no data", "no value", "no answer", "no response", "null value", "none supplied", "\\n", "#value!", "#div/0!", "#ref!", "#name?", "#num!", "#null!", "#error!", "error", "#error"]
_tf_keep = {}
df = df.with_columns([
    pl.when(pl.col(c).str.strip_chars().str.to_lowercase().is_in(_tf_missing) & ~pl.col(c).is_in(_tf_keep.get(c, [])))
    .then(None).otherwise(pl.col(c)).alias(c)
    for c in df.columns if df.schema[c] == pl.Utf8
])

# Clean: order_date
_tf_formats = ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S%.f%#z", "%Y-%m-%dT%H:%M:%S%.f%#z", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%y", "%d-%m-%y", "%d.%m.%y", "%d %b %Y", "%d-%b-%Y", "%b %d, %Y", "%d %B %Y", "%B %d, %Y"]
def _tf_read(name, fmt):
    parsed = pl.col(name).cast(pl.Utf8).str.to_datetime(fmt, strict=False, time_zone="UTC")
    return pl.when(parsed.dt.year() >= 100).then(parsed)  # %Y also takes 2-digit years; %y reads those
df = df.with_columns(pl.coalesce(pl.coalesce([_tf_read("order_date", f) for f in _tf_formats]).dt.strftime("%Y-%m-%d"), pl.col("order_date")).alias("order_date"))

df.write_csv("cleaned.csv")
