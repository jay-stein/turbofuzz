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
_tf_encoding = "utf-16" if open("input.csv", "rb").read(2) in (b"\xff\xfe", b"\xfe\xff") else "utf-16-le"
def _tf_skip_lines(path, records, sep, encoding):
    # TurboFuzz does not count empty lines as rows; the readers count every line. This finds the line
    # of the first row after the `records` skipped ones.
    seen, line_no = 0, -1
    with open(path, encoding=encoding, errors="replace") as f:
        for line_no, line in enumerate(f):
            if line.replace(sep, "").replace('"', "").strip():
                if seen == records:
                    return line_no
                seen += 1
    return line_no + 1
_tf_skip = _tf_skip_lines("input.csv", 1, "\t", _tf_encoding)
import io
# Polars reads UTF-8 only: decode the file here and pass it on as UTF-8 bytes.
_tf_raw = open("input.csv", "rb").read().decode(_tf_encoding, errors="replace")
df = pl.read_csv(io.BytesIO(_tf_raw.encode("utf-8")), separator="\t", skip_rows=_tf_skip, new_columns=["city", "qty"], truncate_ragged_lines=True, infer_schema_length=None, schema_overrides={"city": pl.Utf8})
df = df.filter(~pl.all_horizontal(pl.all().is_null()))  # the importer skips rows with every cell empty
df = df.head(-1)  # the importer left out the last 1 row (totals or notes after the data)

# Missing values as TurboFuzz counts them (any case, padded with spaces)
_tf_missing = ["-", "--", "---", "----", "—", "–", "?", "??", "???", "...", "…", "####", "null", "nil", "none", "nan", "na", "n/a", "n.a", "n.a.", "#n/a", "undefined", "missing", "unknown", "unspecified", "tbd", "tba", "empty", "blank", "(empty)", "(blank)", "(null)", "[empty]", "[blank]", "[null]", "<na>", "<null>", "<none>", "not available", "not applicable", "not provided", "not specified", "no data", "no value", "no answer", "no response", "null value", "none supplied", "\\n", "#value!", "#div/0!", "#ref!", "#name?", "#num!", "#null!", "#error!", "error", "#error"]
_tf_keep = {}
df = df.with_columns([
    pl.when(pl.col(c).str.strip_chars().str.to_lowercase().is_in(_tf_missing) & ~pl.col(c).is_in(_tf_keep.get(c, [])))
    .then(None).otherwise(pl.col(c)).alias(c)
    for c in df.columns if df.schema[c] == pl.Utf8
])

df.write_csv("cleaned.csv")
