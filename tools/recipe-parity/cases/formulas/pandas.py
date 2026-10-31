# TurboFuzz pandas recipe — generated from the applied Recipe.
# Requirements: pip install pandas  (pandas >= 2.0 for format="mixed" parsing)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → Python date objects (datetime64, midnight);
#   datetime → datetime64[ns] (naive timestamps are read as UTC);
#   time → Python time; duration → timedelta64.
# Nulls: pandas NaN/NaT; unparseable values become NaN/NaT via errors="coerce".
# Non-equivalent steps (review before trusting the output):
#   ! type: solar → boolean — map the exact source spellings

import pandas as pd

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pd.read_csv("input.csv")

# Logical types
df["price"] = pd.to_numeric(df["price"], errors="coerce")
df["qty"] = pd.to_numeric(df["qty"], errors="coerce")
df["ordered"] = pd.to_datetime(df["ordered"], errors="coerce").dt.date
df["shipped"] = pd.to_datetime(df["shipped"], errors="coerce").dt.date
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
df.insert(9, "total", _derive(df.to_dict("records"), _f1, "number"))
# new column "ratio" = [price] / [qty]
def _f2(r):
    return _bin("/", _read(r["price"], "number"), _read(r["qty"], "number"), "number", "number")
df.insert(10, "ratio", _derive(df.to_dict("records"), _f2, "number"))
# new column "power" = -[qty] ^ 2 + 0.1 + 0.2
def _f3(r):
    return _bin("+", _bin("+", _bin("^", _neg(_read(r["qty"], "number")), 2, "number", "number"), 0.1, "number", "number"), 0.2, "number", "number")
df.insert(11, "power", _derive(df.to_dict("records"), _f3, "number"))
# new column "full" = [first] & " " & [last]
def _f4(r):
    return _bin("&", _bin("&", _read(r["first"], "text"), " ", "text", "text"), _read(r["last"], "text"), "text", "text")
df.insert(12, "full", _derive(df.to_dict("records"), _f4, "text"))
# new column "joined" = CONCAT([first], [qty], TRUE)
def _f5(r):
    return _call("CONCAT", [lambda: _read(r["first"], "text"), lambda: _read(r["qty"], "number"), lambda: True], ["text", "number", "bool"])
df.insert(13, "joined", _derive(df.to_dict("records"), _f5, "text"))
# new column "upper" = UPPER([first])
def _f6(r):
    return _call("UPPER", [lambda: _read(r["first"], "text")], ["text"])
df.insert(14, "upper", _derive(df.to_dict("records"), _f6, "text"))
# new column "lower" = LOWER([status])
def _f7(r):
    return _call("LOWER", [lambda: _read(r["status"], "text")], ["text"])
df.insert(15, "lower", _derive(df.to_dict("records"), _f7, "text"))
# new column "trimmed" = TRIM("  a   b ") & [last]
def _f8(r):
    return _bin("&", _call("TRIM", [lambda: "  a   b "], ["text"]), _read(r["last"], "text"), "text", "text")
df.insert(16, "trimmed", _derive(df.to_dict("records"), _f8, "text"))
# new column "len" = LEN([last])
def _f9(r):
    return _call("LEN", [lambda: _read(r["last"], "text")], ["text"])
df.insert(17, "len", _derive(df.to_dict("records"), _f9, "number"))
# new column "left" = LEFT([last], 3)
def _f10(r):
    return _call("LEFT", [lambda: _read(r["last"], "text"), lambda: 3], ["text", "number"])
df.insert(18, "left", _derive(df.to_dict("records"), _f10, "text"))
# new column "right" = RIGHT([last])
def _f11(r):
    return _call("RIGHT", [lambda: _read(r["last"], "text")], ["text"])
df.insert(19, "right", _derive(df.to_dict("records"), _f11, "text"))
# new column "mid" = MID([last], 2, 3)
def _f12(r):
    return _call("MID", [lambda: _read(r["last"], "text"), lambda: 2, lambda: 3], ["text", "number", "number"])
df.insert(20, "mid", _derive(df.to_dict("records"), _f12, "text"))
# new column "at" = FIND("@", [email])
def _f13(r):
    return _call("FIND", [lambda: "@", lambda: _read(r["email"], "text")], ["text", "text"])
df.insert(21, "at", _derive(df.to_dict("records"), _f13, "number"))
# new column "user" = LEFT([email], FIND("@", [email]) - 1)
def _f14(r):
    return _call("LEFT", [lambda: _read(r["email"], "text"), lambda: _bin("-", _call("FIND", [lambda: "@", lambda: _read(r["email"], "text")], ["text", "text"]), 1, "number", "number")], ["text", "number"])
df.insert(22, "user", _derive(df.to_dict("records"), _f14, "text"))
# new column "has" = CONTAINS([email], "X.ORG")
def _f15(r):
    return _call("CONTAINS", [lambda: _read(r["email"], "text"), lambda: "X.ORG"], ["text", "text"])
df.insert(23, "has", _derive(df.to_dict("records"), _f15, "bool"))
# new column "is_open" = [status] = "open"
def _f16(r):
    return _bin("=", _read(r["status"], "text"), "open", "text", "text")
df.insert(24, "is_open", _derive(df.to_dict("records"), _f16, "bool"))
# new column "not_open" = [status] <> "open"
def _f17(r):
    return _bin("<>", _read(r["status"], "text"), "open", "text", "text")
df.insert(25, "not_open", _derive(df.to_dict("records"), _f17, "bool"))
# new column "big" = [price] > 3
def _f18(r):
    return _bin(">", _read(r["price"], "number"), 3, "number", "number")
df.insert(26, "big", _derive(df.to_dict("records"), _f18, "bool"))
# new column "label" = IF([status] = "closed", "Done", "Open")
def _f19(r):
    return _call("IF", [lambda: _bin("=", _read(r["status"], "text"), "closed", "text", "text"), lambda: "Done", lambda: "Open"], ["bool", "text", "text"])
df.insert(27, "label", _derive(df.to_dict("records"), _f19, "text"))
# new column "maybe" = IF([price] >= 4, "Big")
def _f20(r):
    return _call("IF", [lambda: _bin(">=", _read(r["price"], "number"), 4, "number", "number"), lambda: "Big"], ["bool", "text"])
df.insert(28, "maybe", _derive(df.to_dict("records"), _f20, "text"))
# new column "mixed" = IF([qty] > 3, [qty], "few")
def _f21(r):
    return _call("IF", [lambda: _bin(">", _read(r["qty"], "number"), 3, "number", "number"), lambda: _read(r["qty"], "number"), lambda: "few"], ["bool", "number", "text"])
df.insert(29, "mixed", _derive(df.to_dict("records"), _f21, "text"))
# new column "both" = AND([qty] > 0, [solar])
def _f22(r):
    return _call("AND", [lambda: _bin(">", _read(r["qty"], "number"), 0, "number", "number"), lambda: _read(r["solar"], "bool")], ["bool", "bool"])
df.insert(30, "both", _derive(df.to_dict("records"), _f22, "bool"))
# new column "either" = OR([qty] = 0, [solar])
def _f23(r):
    return _call("OR", [lambda: _bin("=", _read(r["qty"], "number"), 0, "number", "number"), lambda: _read(r["solar"], "bool")], ["bool", "bool"])
df.insert(31, "either", _derive(df.to_dict("records"), _f23, "bool"))
# new column "no_solar" = NOT([solar])
def _f24(r):
    return _call("NOT", [lambda: _read(r["solar"], "bool")], ["bool"])
df.insert(32, "no_solar", _derive(df.to_dict("records"), _f24, "bool"))
# new column "no_first" = ISBLANK([first])
def _f25(r):
    return _call("ISBLANK", [lambda: _read(r["first"], "text")], ["text"])
df.insert(33, "no_first", _derive(df.to_dict("records"), _f25, "bool"))
# new column "name" = COALESCE([first], [last], "?")
def _f26(r):
    return _call("COALESCE", [lambda: _read(r["first"], "text"), lambda: _read(r["last"], "text"), lambda: "?"], ["text", "text", "text"])
df.insert(34, "name", _derive(df.to_dict("records"), _f26, "text"))
# new column "status2" = IFBLANK([status], "Unknown")
def _f27(r):
    return _call("IFBLANK", [lambda: _read(r["status"], "text"), lambda: "Unknown"], ["text", "text"])
df.insert(35, "status2", _derive(df.to_dict("records"), _f27, "text"))
# new column "r0" = ROUND(2.5) + ROUND(-2.5)
def _f28(r):
    return _bin("+", _call("ROUND", [lambda: 2.5], ["number"]), _call("ROUND", [lambda: _neg(2.5)], ["number"]), "number", "number")
df.insert(36, "r0", _derive(df.to_dict("records"), _f28, "number"))
# new column "r2" = ROUND([price] * 1.07, 2)
def _f29(r):
    return _call("ROUND", [lambda: _bin("*", _read(r["price"], "number"), 1.07, "number", "number"), lambda: 2], ["number", "number"])
df.insert(37, "r2", _derive(df.to_dict("records"), _f29, "number"))
# new column "rneg" = ROUND(1234, -2)
def _f30(r):
    return _call("ROUND", [lambda: 1234, lambda: _neg(2)], ["number", "number"])
df.insert(38, "rneg", _derive(df.to_dict("records"), _f30, "number"))
# new column "abs" = ABS(-[qty])
def _f31(r):
    return _call("ABS", [lambda: _neg(_read(r["qty"], "number"))], ["number"])
df.insert(39, "abs", _derive(df.to_dict("records"), _f31, "number"))
# new column "lo" = MIN([price], [qty])
def _f32(r):
    return _call("MIN", [lambda: _read(r["price"], "number"), lambda: _read(r["qty"], "number")], ["number", "number"])
df.insert(40, "lo", _derive(df.to_dict("records"), _f32, "number"))
# new column "hi" = MAX([price], [qty])
def _f33(r):
    return _call("MAX", [lambda: _read(r["price"], "number"), lambda: _read(r["qty"], "number")], ["number", "number"])
df.insert(41, "hi", _derive(df.to_dict("records"), _f33, "number"))
# new column "year" = YEAR([ordered])
def _f34(r):
    return _call("YEAR", [lambda: _read(r["ordered"], "date")], ["date"])
df.insert(42, "year", _derive(df.to_dict("records"), _f34, "number"))
# new column "month" = MONTH([ordered])
def _f35(r):
    return _call("MONTH", [lambda: _read(r["ordered"], "date")], ["date"])
df.insert(43, "month", _derive(df.to_dict("records"), _f35, "number"))
# new column "day" = DAY([ordered])
def _f36(r):
    return _call("DAY", [lambda: _read(r["ordered"], "date")], ["date"])
df.insert(44, "day", _derive(df.to_dict("records"), _f36, "number"))
# new column "wd1" = WEEKDAY([ordered])
def _f37(r):
    return _call("WEEKDAY", [lambda: _read(r["ordered"], "date")], ["date"])
df.insert(45, "wd1", _derive(df.to_dict("records"), _f37, "number"))
# new column "wd2" = WEEKDAY([ordered], 2)
def _f38(r):
    return _call("WEEKDAY", [lambda: _read(r["ordered"], "date"), lambda: 2], ["date", "number"])
df.insert(46, "wd2", _derive(df.to_dict("records"), _f38, "number"))
# new column "wd3" = WEEKDAY([ordered], 3)
def _f39(r):
    return _call("WEEKDAY", [lambda: _read(r["ordered"], "date"), lambda: 3], ["date", "number"])
df.insert(47, "wd3", _derive(df.to_dict("records"), _f39, "number"))
# new column "days" = [shipped] - [ordered]
def _f40(r):
    return _bin("-", _read(r["shipped"], "date"), _read(r["ordered"], "date"), "date", "date")
df.insert(48, "days", _derive(df.to_dict("records"), _f40, "number"))
# new column "later" = [ordered] + 30
def _f41(r):
    return _bin("+", _read(r["ordered"], "date"), 30, "date", "number")
df.insert(49, "later", _derive(df.to_dict("records"), _f41, "date"))
# new column "dd" = DATEDIF([ordered], [shipped], "d")
def _f42(r):
    return _call("DATEDIF", [lambda: _read(r["ordered"], "date"), lambda: _read(r["shipped"], "date"), lambda: "d"], ["date", "date", "text"])
df.insert(50, "dd", _derive(df.to_dict("records"), _f42, "number"))
# new column "yy" = DATEDIF(DATE(2020, 2, 29), [shipped], "y")
def _f43(r):
    return _call("DATEDIF", [lambda: _call("DATE", [lambda: 2020, lambda: 2, lambda: 29], ["number", "number", "number"]), lambda: _read(r["shipped"], "date"), lambda: "y"], ["date", "date", "text"])
df.insert(51, "yy", _derive(df.to_dict("records"), _f43, "number"))
# new column "mm" = DATEDIF(DATE(2024, 1, 31), [shipped], "m")
def _f44(r):
    return _call("DATEDIF", [lambda: _call("DATE", [lambda: 2024, lambda: 1, lambda: 31], ["number", "number", "number"]), lambda: _read(r["shipped"], "date"), lambda: "m"], ["date", "date", "text"])
df.insert(52, "mm", _derive(df.to_dict("records"), _f44, "number"))
# new column "bad" = DATEDIF([shipped], [ordered], "d")
def _f45(r):
    return _call("DATEDIF", [lambda: _read(r["shipped"], "date"), lambda: _read(r["ordered"], "date"), lambda: "d"], ["date", "date", "text"])
df.insert(53, "bad", _derive(df.to_dict("records"), _f45, "number"))
# new column "made" = DATE(2024, 13, 1)
def _f46(r):
    return _call("DATE", [lambda: 2024, lambda: 13, lambda: 1], ["number", "number", "number"])
df.insert(54, "made", _derive(df.to_dict("records"), _f46, "date"))
# new column "age" = DATEDIF(DATE(2000, 1, 1), TODAY(), "y") > 20
def _f47(r):
    return _bin(">", _call("DATEDIF", [lambda: _call("DATE", [lambda: 2000, lambda: 1, lambda: 1], ["number", "number", "number"]), lambda: _call("TODAY", [], []), lambda: "y"], ["date", "date", "text"]), 20, "number", "number")
df.insert(55, "age", _derive(df.to_dict("records"), _f47, "bool"))

df.to_csv("cleaned.csv", index=False)
