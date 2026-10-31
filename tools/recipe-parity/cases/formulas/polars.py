# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Non-equivalent steps (review before trusting the output):
#   ! type: solar → boolean — map the exact source spellings

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv")

# Logical types
df = df.with_columns(pl.col("price").cast(pl.Float64, strict=False).alias("price"))
df = df.with_columns(pl.col("qty").cast(pl.Int64, strict=False).alias("qty"))
df = df.with_columns(pl.col("ordered").str.to_datetime(strict=False).dt.date().alias("ordered"))
df = df.with_columns(pl.col("shipped").str.to_datetime(strict=False).dt.date().alias("shipped"))
# “solar” was read as boolean; map the source spellings (yes/no, y/n, 1/0) to true/false explicitly

# Transform
# --- TurboFuzz formula helpers: the app's rules for new columns, row by row ---
import math as _math
from datetime import date as _date, datetime as _datetime, timedelta as _td, timezone as _tz
from decimal import Decimal as _Decimal

class _Err(Exception):
    pass

_DAY = 86_400_000
_TRUE = {"true", "yes", "y", "1", "t"}
_FALSE = {"false", "no", "n", "0", "f"}
_DATE = ("date", "datetime")

def _blank(v):
    if v is None:
        return True
    try:
        if v != v:  # NaN, NaT
            return True
    except Exception:
        pass
    if str(v) in ("<NA>", "NaT"):
        return True
    return isinstance(v, str) and v == ""

def _ms(v):
    if isinstance(v, _datetime):
        return (v if v.tzinfo else v.replace(tzinfo=_tz.utc)).timestamp() * 1000
    if isinstance(v, _date):
        return _datetime(v.year, v.month, v.day, tzinfo=_tz.utc).timestamp() * 1000
    if hasattr(v, "to_pydatetime"):
        return _ms(v.to_pydatetime())
    s = str(v).strip().replace("T", " ").replace("Z", "")
    try:
        return _ms(_datetime.fromisoformat(s))
    except ValueError:
        return None

def _read(v, t):
    if _blank(v):
        return None
    if t == "number":
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        return x if _math.isfinite(x) else None
    if t in _DATE:
        return _ms(v)
    if t == "bool":
        if isinstance(v, bool) or type(v).__name__ == "bool_":
            return bool(v)
        s = str(v).strip().lower()
        return True if s in _TRUE else False if s in _FALSE else None
    if isinstance(v, float) and v.is_integer():
        return _numtext(v)
    return str(v)

def _numtext(v):
    x = float(f"{float(v):.15g}")
    if x.is_integer() and abs(x) < 1e21:
        return str(int(x))
    s = repr(x)
    if "e" in s and 1e-6 <= abs(x) < 1e21:
        s = format(_Decimal(s), "f")
    return s.replace("e-0", "e-").replace("e+0", "e+")

def _datetext(ms, with_time):
    d = _datetime.fromtimestamp(ms / 1000, tz=_tz.utc)
    return d.strftime("%Y-%m-%d %H:%M:%S") if with_time else d.strftime("%Y-%m-%d")

def _text(v, t):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return _datetext(v, t == "datetime" and v % _DAY != 0) if t in _DATE else _numtext(v)
    return v

def _num(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = v.strip()
    if s == "":
        return None
    try:
        x = float(s)
    except ValueError:
        x = float("nan")
    if not _math.isfinite(x):
        raise _Err(f"“{s[:20] + '…' if len(s) > 20 else s}” is not a number")
    return x

def _bool(v):
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    return v.strip().lower() in _TRUE

def _neg(v):
    x = _num(v)
    return None if x is None else -x

def _pos(v):
    return _num(v)

def _bin(op, x, y, ta, tb):
    if op == "&":
        s = _text(x, ta) + _text(y, tb)
        return s or None
    if op in ("=", "<>", "<", "<=", ">", ">="):
        if x is None or y is None:
            return op == "<>"
        if (ta == "text" or tb == "text") and not (ta == "number" and tb == "number"):
            p, q = _text(x, ta).lower(), _text(y, tb).lower()
        else:
            try:
                p = (1.0 if x else 0.0) if isinstance(x, bool) else _num(x)
                q = (1.0 if y else 0.0) if isinstance(y, bool) else _num(y)
            except _Err:
                return op == "<>"
        c = -1 if p < q else 1 if p > q else 0
        return {"=": c == 0, "<>": c != 0, "<": c < 0, "<=": c <= 0, ">": c > 0, ">=": c >= 0}[op]
    a, b = _num(x), _num(y)
    if a is None or b is None:
        return None
    if op == "+":
        return a * (_DAY if tb in _DATE and ta not in _DATE else 1) + b * (_DAY if ta in _DATE and tb not in _DATE else 1)
    if op == "-":
        if ta in _DATE and tb in _DATE:
            return (a - b) / _DAY
        return a - b * (_DAY if ta in _DATE else 1)
    if op == "*":
        return a * b
    if op == "/":
        if b == 0:
            raise _Err("divide by zero")
        return a / b
    try:
        r = _math.pow(a, b)
    except (OverflowError, ValueError):
        raise _Err("the power is out of range")
    if not _math.isfinite(r):
        raise _Err("the power is out of range")
    return r

def _call(fn, args, ts):
    n = lambda k: _num(args[k]())
    def text(k):
        v = args[k]()
        return None if v is None else _text(v, ts[k])
    def opt(k, fallback):
        if k >= len(args):
            return fallback
        v = n(k)
        return fallback if v is None else v
    def day(k):
        v = n(k)
        if v is None:
            return None
        return _datetime.fromtimestamp((v if ts[k] in _DATE else v * _DAY) / 1000, tz=_tz.utc)
    if fn == "IF":
        c = args[0]()
        return args[1]() if _bool(c) else (args[2]() if len(args) > 2 else None)
    if fn in ("AND", "OR"):
        want = fn == "AND"
        for a in args:
            if _bool(a()) != want:
                return not want
        return want
    if fn == "NOT":
        return not _bool(args[0]())
    if fn == "ROUND":
        x, d = n(0), opt(1, 0)
        if x is None:
            return None
        f = 10 ** int(d)
        return _math.copysign(_math.floor(abs(x) * f + 1e-9 + 0.5), x) / f if x != 0 else 0.0
    if fn == "ABS":
        x = n(0)
        return None if x is None else abs(x)
    if fn in ("MIN", "MAX"):
        best = None
        for k in range(len(args)):
            x = n(k)
            if x is not None and (best is None or (x > best if fn == "MAX" else x < best)):
                best = x
        return best
    if fn == "LEN":
        s = text(0)
        return 0 if s is None else len(s)
    if fn in ("LEFT", "RIGHT"):
        s, k = text(0), opt(1, 1)
        if s is None:
            return None
        if k < 0:
            raise _Err(f"{fn} needs a count of 0 or more")
        k = int(k)
        out = s[:k] if fn == "LEFT" else (s[len(s) - k:] if k else "")
        return out or None
    if fn == "MID":
        s, st, k = text(0), n(1), n(2)
        if s is None:
            return None
        if st is None or k is None or st < 1 or k < 0:
            raise _Err("MID needs a start of 1 or more and a count of 0 or more")
        out = s[int(st) - 1:int(st) - 1 + int(k)]
        return out or None
    if fn == "FIND":
        needle, hay, st = text(0), text(1), opt(2, 1)
        if hay is None:
            return None
        at = hay.find(needle or "", max(0, int(st) - 1))
        if at < 0:
            raise _Err(f"“{needle or ''}” not found")
        return at + 1
    if fn in ("UPPER", "LOWER", "TRIM"):
        s = text(0)
        if s is None:
            return None
        out = s.upper() if fn == "UPPER" else s.lower() if fn == "LOWER" else " ".join(p for p in s.split(" ") if p).strip()
        return out or None
    if fn == "CONCAT":
        s = "".join(text(k) or "" for k in range(len(args)))
        return s or None
    if fn == "CONTAINS":
        s, f = text(0), text(1)
        return s is not None and (f or "").lower() in s.lower()
    if fn in ("YEAR", "MONTH", "DAY"):
        d = day(0)
        if d is None:
            return None
        return float(d.year if fn == "YEAR" else d.month if fn == "MONTH" else d.day)
    if fn == "WEEKDAY":
        d, kind = day(0), opt(1, 1)
        if d is None:
            return None
        w = (d.weekday() + 1) % 7  # 0 = Sunday
        if kind == 2:
            return float(7 if w == 0 else w)
        if kind == 3:
            return float((w + 6) % 7)
        if kind == 1:
            return float(w + 1)
        raise _Err("WEEKDAY type is 1, 2 or 3")
    if fn == "DATEDIF":
        a, b, u = day(0), day(1), text(2)
        if a is None or b is None:
            return None
        if a > b:
            raise _Err("DATEDIF start is after the end")
        unit = (u or "").lower()
        if unit == "d":
            return float(_math.floor((b - a).total_seconds() * 1000 / _DAY))
        months = (b.year - a.year) * 12 + (b.month - a.month) - (1 if b.day < a.day else 0)
        if unit == "m":
            return float(months)
        if unit == "y":
            return float(months // 12)
        raise _Err('DATEDIF unit is "d", "m" or "y"')
    if fn == "DATE":
        y, m, d = n(0), n(1), n(2)
        if y is None or m is None or d is None:
            return None
        yy, mm = divmod(int(y) * 12 + int(m) - 1, 12)
        return (_datetime(yy, mm + 1, 1, tzinfo=_tz.utc) + _td(days=int(d) - 1)).timestamp() * 1000
    if fn == "TODAY":
        now = _datetime.now(_tz.utc)
        return _datetime(now.year, now.month, now.day, tzinfo=_tz.utc).timestamp() * 1000
    if fn == "ISBLANK":
        v = args[0]()
        return v is None or v == ""
    if fn in ("COALESCE", "IFBLANK"):
        for a in args:
            v = a()
            if v is not None and v != "":
                return v
        return None
    raise _Err(f"{fn} is not available")

def _derive(rows, f, t):
    """One new column's cells as text, the way the app writes them ("" left empty)."""
    out = []
    for r in rows:
        try:
            v = f(r)
        except _Err:
            v = None
        s = None if v is None else _text(v, t)
        out.append(s if s not in ("", None) else None)
    return out
# --- end of formula helpers ---
# new column "total" = [price] * [qty]
def _f1(r):
    return _bin("*", _read(r["price"], "number"), _read(r["qty"], "number"), "number", "number")
df = df.insert_column(9, pl.Series("total", _derive(df.iter_rows(named=True), _f1, "number"), dtype=pl.Utf8))
# new column "ratio" = [price] / [qty]
def _f2(r):
    return _bin("/", _read(r["price"], "number"), _read(r["qty"], "number"), "number", "number")
df = df.insert_column(10, pl.Series("ratio", _derive(df.iter_rows(named=True), _f2, "number"), dtype=pl.Utf8))
# new column "power" = -[qty] ^ 2 + 0.1 + 0.2
def _f3(r):
    return _bin("+", _bin("+", _bin("^", _neg(_read(r["qty"], "number")), 2, "number", "number"), 0.1, "number", "number"), 0.2, "number", "number")
df = df.insert_column(11, pl.Series("power", _derive(df.iter_rows(named=True), _f3, "number"), dtype=pl.Utf8))
# new column "full" = [first] & " " & [last]
def _f4(r):
    return _bin("&", _bin("&", _read(r["first"], "text"), " ", "text", "text"), _read(r["last"], "text"), "text", "text")
df = df.insert_column(12, pl.Series("full", _derive(df.iter_rows(named=True), _f4, "text"), dtype=pl.Utf8))
# new column "joined" = CONCAT([first], [qty], TRUE)
def _f5(r):
    return _call("CONCAT", [lambda: _read(r["first"], "text"), lambda: _read(r["qty"], "number"), lambda: True], ["text", "number", "bool"])
df = df.insert_column(13, pl.Series("joined", _derive(df.iter_rows(named=True), _f5, "text"), dtype=pl.Utf8))
# new column "upper" = UPPER([first])
def _f6(r):
    return _call("UPPER", [lambda: _read(r["first"], "text")], ["text"])
df = df.insert_column(14, pl.Series("upper", _derive(df.iter_rows(named=True), _f6, "text"), dtype=pl.Utf8))
# new column "lower" = LOWER([status])
def _f7(r):
    return _call("LOWER", [lambda: _read(r["status"], "text")], ["text"])
df = df.insert_column(15, pl.Series("lower", _derive(df.iter_rows(named=True), _f7, "text"), dtype=pl.Utf8))
# new column "trimmed" = TRIM("  a   b ") & [last]
def _f8(r):
    return _bin("&", _call("TRIM", [lambda: "  a   b "], ["text"]), _read(r["last"], "text"), "text", "text")
df = df.insert_column(16, pl.Series("trimmed", _derive(df.iter_rows(named=True), _f8, "text"), dtype=pl.Utf8))
# new column "len" = LEN([last])
def _f9(r):
    return _call("LEN", [lambda: _read(r["last"], "text")], ["text"])
df = df.insert_column(17, pl.Series("len", _derive(df.iter_rows(named=True), _f9, "number"), dtype=pl.Utf8))
# new column "left" = LEFT([last], 3)
def _f10(r):
    return _call("LEFT", [lambda: _read(r["last"], "text"), lambda: 3], ["text", "number"])
df = df.insert_column(18, pl.Series("left", _derive(df.iter_rows(named=True), _f10, "text"), dtype=pl.Utf8))
# new column "right" = RIGHT([last])
def _f11(r):
    return _call("RIGHT", [lambda: _read(r["last"], "text")], ["text"])
df = df.insert_column(19, pl.Series("right", _derive(df.iter_rows(named=True), _f11, "text"), dtype=pl.Utf8))
# new column "mid" = MID([last], 2, 3)
def _f12(r):
    return _call("MID", [lambda: _read(r["last"], "text"), lambda: 2, lambda: 3], ["text", "number", "number"])
df = df.insert_column(20, pl.Series("mid", _derive(df.iter_rows(named=True), _f12, "text"), dtype=pl.Utf8))
# new column "at" = FIND("@", [email])
def _f13(r):
    return _call("FIND", [lambda: "@", lambda: _read(r["email"], "text")], ["text", "text"])
df = df.insert_column(21, pl.Series("at", _derive(df.iter_rows(named=True), _f13, "number"), dtype=pl.Utf8))
# new column "user" = LEFT([email], FIND("@", [email]) - 1)
def _f14(r):
    return _call("LEFT", [lambda: _read(r["email"], "text"), lambda: _bin("-", _call("FIND", [lambda: "@", lambda: _read(r["email"], "text")], ["text", "text"]), 1, "number", "number")], ["text", "number"])
df = df.insert_column(22, pl.Series("user", _derive(df.iter_rows(named=True), _f14, "text"), dtype=pl.Utf8))
# new column "has" = CONTAINS([email], "X.ORG")
def _f15(r):
    return _call("CONTAINS", [lambda: _read(r["email"], "text"), lambda: "X.ORG"], ["text", "text"])
df = df.insert_column(23, pl.Series("has", _derive(df.iter_rows(named=True), _f15, "bool"), dtype=pl.Utf8))
# new column "is_open" = [status] = "open"
def _f16(r):
    return _bin("=", _read(r["status"], "text"), "open", "text", "text")
df = df.insert_column(24, pl.Series("is_open", _derive(df.iter_rows(named=True), _f16, "bool"), dtype=pl.Utf8))
# new column "not_open" = [status] <> "open"
def _f17(r):
    return _bin("<>", _read(r["status"], "text"), "open", "text", "text")
df = df.insert_column(25, pl.Series("not_open", _derive(df.iter_rows(named=True), _f17, "bool"), dtype=pl.Utf8))
# new column "big" = [price] > 3
def _f18(r):
    return _bin(">", _read(r["price"], "number"), 3, "number", "number")
df = df.insert_column(26, pl.Series("big", _derive(df.iter_rows(named=True), _f18, "bool"), dtype=pl.Utf8))
# new column "label" = IF([status] = "closed", "Done", "Open")
def _f19(r):
    return _call("IF", [lambda: _bin("=", _read(r["status"], "text"), "closed", "text", "text"), lambda: "Done", lambda: "Open"], ["bool", "text", "text"])
df = df.insert_column(27, pl.Series("label", _derive(df.iter_rows(named=True), _f19, "text"), dtype=pl.Utf8))
# new column "maybe" = IF([price] >= 4, "Big")
def _f20(r):
    return _call("IF", [lambda: _bin(">=", _read(r["price"], "number"), 4, "number", "number"), lambda: "Big"], ["bool", "text"])
df = df.insert_column(28, pl.Series("maybe", _derive(df.iter_rows(named=True), _f20, "text"), dtype=pl.Utf8))
# new column "mixed" = IF([qty] > 3, [qty], "few")
def _f21(r):
    return _call("IF", [lambda: _bin(">", _read(r["qty"], "number"), 3, "number", "number"), lambda: _read(r["qty"], "number"), lambda: "few"], ["bool", "number", "text"])
df = df.insert_column(29, pl.Series("mixed", _derive(df.iter_rows(named=True), _f21, "text"), dtype=pl.Utf8))
# new column "both" = AND([qty] > 0, [solar])
def _f22(r):
    return _call("AND", [lambda: _bin(">", _read(r["qty"], "number"), 0, "number", "number"), lambda: _read(r["solar"], "bool")], ["bool", "bool"])
df = df.insert_column(30, pl.Series("both", _derive(df.iter_rows(named=True), _f22, "bool"), dtype=pl.Utf8))
# new column "either" = OR([qty] = 0, [solar])
def _f23(r):
    return _call("OR", [lambda: _bin("=", _read(r["qty"], "number"), 0, "number", "number"), lambda: _read(r["solar"], "bool")], ["bool", "bool"])
df = df.insert_column(31, pl.Series("either", _derive(df.iter_rows(named=True), _f23, "bool"), dtype=pl.Utf8))
# new column "no_solar" = NOT([solar])
def _f24(r):
    return _call("NOT", [lambda: _read(r["solar"], "bool")], ["bool"])
df = df.insert_column(32, pl.Series("no_solar", _derive(df.iter_rows(named=True), _f24, "bool"), dtype=pl.Utf8))
# new column "no_first" = ISBLANK([first])
def _f25(r):
    return _call("ISBLANK", [lambda: _read(r["first"], "text")], ["text"])
df = df.insert_column(33, pl.Series("no_first", _derive(df.iter_rows(named=True), _f25, "bool"), dtype=pl.Utf8))
# new column "name" = COALESCE([first], [last], "?")
def _f26(r):
    return _call("COALESCE", [lambda: _read(r["first"], "text"), lambda: _read(r["last"], "text"), lambda: "?"], ["text", "text", "text"])
df = df.insert_column(34, pl.Series("name", _derive(df.iter_rows(named=True), _f26, "text"), dtype=pl.Utf8))
# new column "status2" = IFBLANK([status], "Unknown")
def _f27(r):
    return _call("IFBLANK", [lambda: _read(r["status"], "text"), lambda: "Unknown"], ["text", "text"])
df = df.insert_column(35, pl.Series("status2", _derive(df.iter_rows(named=True), _f27, "text"), dtype=pl.Utf8))
# new column "r0" = ROUND(2.5) + ROUND(-2.5)
def _f28(r):
    return _bin("+", _call("ROUND", [lambda: 2.5], ["number"]), _call("ROUND", [lambda: _neg(2.5)], ["number"]), "number", "number")
df = df.insert_column(36, pl.Series("r0", _derive(df.iter_rows(named=True), _f28, "number"), dtype=pl.Utf8))
# new column "r2" = ROUND([price] * 1.07, 2)
def _f29(r):
    return _call("ROUND", [lambda: _bin("*", _read(r["price"], "number"), 1.07, "number", "number"), lambda: 2], ["number", "number"])
df = df.insert_column(37, pl.Series("r2", _derive(df.iter_rows(named=True), _f29, "number"), dtype=pl.Utf8))
# new column "rneg" = ROUND(1234, -2)
def _f30(r):
    return _call("ROUND", [lambda: 1234, lambda: _neg(2)], ["number", "number"])
df = df.insert_column(38, pl.Series("rneg", _derive(df.iter_rows(named=True), _f30, "number"), dtype=pl.Utf8))
# new column "abs" = ABS(-[qty])
def _f31(r):
    return _call("ABS", [lambda: _neg(_read(r["qty"], "number"))], ["number"])
df = df.insert_column(39, pl.Series("abs", _derive(df.iter_rows(named=True), _f31, "number"), dtype=pl.Utf8))
# new column "lo" = MIN([price], [qty])
def _f32(r):
    return _call("MIN", [lambda: _read(r["price"], "number"), lambda: _read(r["qty"], "number")], ["number", "number"])
df = df.insert_column(40, pl.Series("lo", _derive(df.iter_rows(named=True), _f32, "number"), dtype=pl.Utf8))
# new column "hi" = MAX([price], [qty])
def _f33(r):
    return _call("MAX", [lambda: _read(r["price"], "number"), lambda: _read(r["qty"], "number")], ["number", "number"])
df = df.insert_column(41, pl.Series("hi", _derive(df.iter_rows(named=True), _f33, "number"), dtype=pl.Utf8))
# new column "year" = YEAR([ordered])
def _f34(r):
    return _call("YEAR", [lambda: _read(r["ordered"], "date")], ["date"])
df = df.insert_column(42, pl.Series("year", _derive(df.iter_rows(named=True), _f34, "number"), dtype=pl.Utf8))
# new column "month" = MONTH([ordered])
def _f35(r):
    return _call("MONTH", [lambda: _read(r["ordered"], "date")], ["date"])
df = df.insert_column(43, pl.Series("month", _derive(df.iter_rows(named=True), _f35, "number"), dtype=pl.Utf8))
# new column "day" = DAY([ordered])
def _f36(r):
    return _call("DAY", [lambda: _read(r["ordered"], "date")], ["date"])
df = df.insert_column(44, pl.Series("day", _derive(df.iter_rows(named=True), _f36, "number"), dtype=pl.Utf8))
# new column "wd1" = WEEKDAY([ordered])
def _f37(r):
    return _call("WEEKDAY", [lambda: _read(r["ordered"], "date")], ["date"])
df = df.insert_column(45, pl.Series("wd1", _derive(df.iter_rows(named=True), _f37, "number"), dtype=pl.Utf8))
# new column "wd2" = WEEKDAY([ordered], 2)
def _f38(r):
    return _call("WEEKDAY", [lambda: _read(r["ordered"], "date"), lambda: 2], ["date", "number"])
df = df.insert_column(46, pl.Series("wd2", _derive(df.iter_rows(named=True), _f38, "number"), dtype=pl.Utf8))
# new column "wd3" = WEEKDAY([ordered], 3)
def _f39(r):
    return _call("WEEKDAY", [lambda: _read(r["ordered"], "date"), lambda: 3], ["date", "number"])
df = df.insert_column(47, pl.Series("wd3", _derive(df.iter_rows(named=True), _f39, "number"), dtype=pl.Utf8))
# new column "days" = [shipped] - [ordered]
def _f40(r):
    return _bin("-", _read(r["shipped"], "date"), _read(r["ordered"], "date"), "date", "date")
df = df.insert_column(48, pl.Series("days", _derive(df.iter_rows(named=True), _f40, "number"), dtype=pl.Utf8))
# new column "later" = [ordered] + 30
def _f41(r):
    return _bin("+", _read(r["ordered"], "date"), 30, "date", "number")
df = df.insert_column(49, pl.Series("later", _derive(df.iter_rows(named=True), _f41, "date"), dtype=pl.Utf8))
# new column "dd" = DATEDIF([ordered], [shipped], "d")
def _f42(r):
    return _call("DATEDIF", [lambda: _read(r["ordered"], "date"), lambda: _read(r["shipped"], "date"), lambda: "d"], ["date", "date", "text"])
df = df.insert_column(50, pl.Series("dd", _derive(df.iter_rows(named=True), _f42, "number"), dtype=pl.Utf8))
# new column "yy" = DATEDIF(DATE(2020, 2, 29), [shipped], "y")
def _f43(r):
    return _call("DATEDIF", [lambda: _call("DATE", [lambda: 2020, lambda: 2, lambda: 29], ["number", "number", "number"]), lambda: _read(r["shipped"], "date"), lambda: "y"], ["date", "date", "text"])
df = df.insert_column(51, pl.Series("yy", _derive(df.iter_rows(named=True), _f43, "number"), dtype=pl.Utf8))
# new column "mm" = DATEDIF(DATE(2024, 1, 31), [shipped], "m")
def _f44(r):
    return _call("DATEDIF", [lambda: _call("DATE", [lambda: 2024, lambda: 1, lambda: 31], ["number", "number", "number"]), lambda: _read(r["shipped"], "date"), lambda: "m"], ["date", "date", "text"])
df = df.insert_column(52, pl.Series("mm", _derive(df.iter_rows(named=True), _f44, "number"), dtype=pl.Utf8))
# new column "bad" = DATEDIF([shipped], [ordered], "d")
def _f45(r):
    return _call("DATEDIF", [lambda: _read(r["shipped"], "date"), lambda: _read(r["ordered"], "date"), lambda: "d"], ["date", "date", "text"])
df = df.insert_column(53, pl.Series("bad", _derive(df.iter_rows(named=True), _f45, "number"), dtype=pl.Utf8))
# new column "made" = DATE(2024, 13, 1)
def _f46(r):
    return _call("DATE", [lambda: 2024, lambda: 13, lambda: 1], ["number", "number", "number"])
df = df.insert_column(54, pl.Series("made", _derive(df.iter_rows(named=True), _f46, "date"), dtype=pl.Utf8))
# new column "age" = DATEDIF(DATE(2000, 1, 1), TODAY(), "y") > 20
def _f47(r):
    return _bin(">", _call("DATEDIF", [lambda: _call("DATE", [lambda: 2000, lambda: 1, lambda: 1], ["number", "number", "number"]), lambda: _call("TODAY", [], []), lambda: "y"], ["date", "date", "text"]), 20, "number", "number")
df = df.insert_column(55, pl.Series("age", _derive(df.iter_rows(named=True), _f47, "bool"), dtype=pl.Utf8))

df.write_csv("cleaned.csv")
