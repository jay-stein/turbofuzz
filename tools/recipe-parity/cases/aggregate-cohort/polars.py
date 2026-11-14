# TurboFuzz Polars recipe — generated from the applied Recipe.
# Written for Polars 2.1 (tested with Polars 2.1.0). Install: pip install "polars>=2.1,<3"
#   Also passes the same checks on Polars 1.44.2; versions older than that are untested.
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Every applied step is generated below.

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv", schema_overrides={"customer": pl.Utf8, "day": pl.Utf8})

# Missing values as TurboFuzz counts them (any case, padded with spaces)
_tf_missing = ["-", "--", "---", "----", "—", "–", "?", "??", "???", "...", "…", "####", "null", "nil", "none", "nan", "na", "n/a", "n.a", "n.a.", "#n/a", "undefined", "missing", "unknown", "unspecified", "tbd", "tba", "empty", "blank", "(empty)", "(blank)", "(null)", "[empty]", "[blank]", "[null]", "<na>", "<null>", "<none>", "not available", "not applicable", "not provided", "not specified", "no data", "no value", "no answer", "no response", "null value", "none supplied", "\\n", "#value!", "#div/0!", "#ref!", "#name?", "#num!", "#null!", "#error!", "error", "#error"]
_tf_keep = {}
df = df.with_columns([
    pl.when(pl.col(c).str.strip_chars().str.to_lowercase().is_in(_tf_missing) & ~pl.col(c).is_in(_tf_keep.get(c, [])))
    .then(None).otherwise(pl.col(c)).alias(c)
    for c in df.columns if df.schema[c] == pl.Utf8
])

# Transform
_tf_formats = ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S%.f%#z", "%Y-%m-%dT%H:%M:%S%.f%#z", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%y", "%d-%m-%y", "%d.%m.%y", "%d %b %Y", "%d-%b-%Y", "%b %d, %Y", "%d %B %Y", "%B %d, %Y"]
def _tf_read(name, fmt):
    parsed = pl.col(name).cast(pl.Utf8).str.to_datetime(fmt, strict=False, time_zone="UTC")
    return pl.when(parsed.dt.year() >= 100).then(parsed)  # %Y also takes 2-digit years; %y reads those
df = df.group_by([pl.coalesce([_tf_read("day", f) for f in _tf_formats]).dt.replace_time_zone(None).min().over(pl.col("customer")).dt.truncate("1mo").alias("_group0")]).agg([
    pl.col("qty").sum().alias("sum(qty)"),
])
df = df.sort("_group0")
df = df.with_columns(pl.col("_group0").dt.strftime("%Y-%m").alias("_group0"))
df = df.rename({"_group0": "day · cohort by customer (month)"})

df.write_csv("cleaned.csv")
