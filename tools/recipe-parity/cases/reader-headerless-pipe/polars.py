# TurboFuzz Polars recipe — generated from the applied Recipe.
# Written for Polars 2.1 (tested with Polars 2.1.0). Install: pip install "polars>=2.1,<3"
#   Also passes the same checks on Polars 1.44.2; versions older than that are untested.
# Input: the reader below repeats how TurboFuzz read your file (delimiter, encoding, rows above the header,
#   rows after the data). Point "input.csv" at your own file; a different export may need different options.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Every applied step is generated below.

import polars as pl

# Input: change the path to your own file; keep the options.
df = pl.read_csv("input.csv", separator="|", has_header=False, new_columns=["Column 1", "Column 2"], truncate_ragged_lines=True, schema_overrides={"Column 1": pl.Utf8})
df = df.filter(~pl.all_horizontal(pl.all().is_null()))  # the importer skips rows with every cell empty

# Missing values as TurboFuzz counts them (any case, padded with spaces)
_tf_missing = ["-", "--", "---", "----", "—", "–", "?", "??", "???", "...", "…", "####", "null", "nil", "none", "nan", "na", "n/a", "n.a", "n.a.", "#n/a", "undefined", "missing", "unknown", "unspecified", "tbd", "tba", "empty", "blank", "(empty)", "(blank)", "(null)", "[empty]", "[blank]", "[null]", "<na>", "<null>", "<none>", "not available", "not applicable", "not provided", "not specified", "no data", "no value", "no answer", "no response", "null value", "none supplied", "\\n", "#value!", "#div/0!", "#ref!", "#name?", "#num!", "#null!", "#error!", "error", "#error"]
_tf_keep = {}
df = df.with_columns([
    pl.when(pl.col(c).str.strip_chars().str.to_lowercase().is_in(_tf_missing) & ~pl.col(c).is_in(_tf_keep.get(c, [])))
    .then(None).otherwise(pl.col(c)).alias(c)
    for c in df.columns if df.schema[c] == pl.Utf8
])

df.write_csv("cleaned.csv")
