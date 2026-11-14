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
df = pd.read_csv("input.csv", dtype={"first": str, "last": str, "status": str, "email": str, "ordered": str, "shipped": str})

# Logical types
df["price"] = pd.to_numeric(df["price"], errors="coerce")
df["qty"] = pd.to_numeric(df["qty"], errors="coerce")
df["ordered"] = pd.to_datetime(df["ordered"], errors="coerce", format="mixed").dt.date
df["shipped"] = pd.to_datetime(df["shipped"], errors="coerce", format="mixed").dt.date
# “solar” was read as boolean; map the source spellings (yes/no, y/n, 1/0) to true/false explicitly

# Transform
# --- TurboFuzz formula helpers: the app's rules for new columns, row by row ---
import math as _math
import re as _re
import calendar as _cal
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

_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
_NO_FORMAT = "TEXT does not support this format"
_fmt_cache = {}

def _fmt_pieces(fmt):
    out, i = [], 0
    while i < len(fmt):
        c = fmt[i]
        if c == '"':
            j = fmt.find('"', i + 1)
            if j < 0:
                j = len(fmt)
            out.append((fmt[i + 1:j], True))
            i = j + 1
        elif c == "\\":
            out.append((fmt[i + 1] if i + 1 < len(fmt) else "", True))
            i += 2
        else:
            out.append((c, False))
            i += 1
    return out

def _fmt_place(c, lit):
    return (not lit) and c in ("0", "#", "?")

def _fmt_section(parts):
    s = {"pre": "", "suf": "", "imin": 0, "thou": False, "dmin": 0, "dmax": 0, "point": False, "pct": False, "lit": True}
    state = 0
    for k, (c, lit) in enumerate(parts):
        if _fmt_place(c, lit):
            if state == 2:
                return None
            state = 1
            s["lit"] = False
            if s["point"]:
                s["dmax"] += 1
                if c == "0":
                    s["dmin"] += 1
            elif c == "0":
                s["imin"] += 1
            continue
        nxt = parts[k + 1] if k + 1 < len(parts) else None
        if (not lit) and c == "." and (state == 1 or (state == 0 and nxt is not None and _fmt_place(nxt[0], nxt[1]))):
            if s["point"]:
                return None
            state = 1
            s["lit"] = False
            s["point"] = True
            continue
        if (not lit) and c == "," and state == 1:
            after = next((p for p in parts[k + 1:] if p[1] or p[0] != ","), None)
            if s["point"] or after is None or not _fmt_place(after[0], after[1]):
                return None
            s["thou"] = True
            continue
        if (not lit) and c == "%":
            s["pct"] = True
        if state == 1:
            state = 2
        if state == 0:
            s["pre"] += c
        else:
            s["suf"] += c
    return s

def _fmt_parse_number(parts, bare):
    if _re.search(r"[eE][+-]", bare):
        return ("error", _NO_FORMAT)
    sections, cur = [], []
    for part in parts:
        if (not part[1]) and part[0] == ";":
            sec = _fmt_section(cur)
            if sec is None:
                return ("error", _NO_FORMAT)
            sections.append(sec)
            cur = []
        else:
            cur.append(part)
    sec = _fmt_section(cur)
    if sec is None:
        return ("error", _NO_FORMAT)
    sections.append(sec)
    return ("number", sections[:3])

def _fmt_parse_date(fmt):
    toks, i = [], 0
    while i < len(fmt):
        c = fmt[i]
        lc = c.lower()
        if c == '"':
            j = fmt.find('"', i + 1)
            if j < 0:
                j = len(fmt)
            toks.append(["lit", fmt[i + 1:j]])
            i = j + 1
        elif c == "\\":
            toks.append(["lit", fmt[i + 1] if i + 1 < len(fmt) else ""])
            i += 2
        elif lc in ("y", "m", "d", "h", "s"):
            j = i
            while j < len(fmt) and fmt[j].lower() == lc:
                j += 1
            toks.append(["mo" if lc == "m" else lc, j - i])
            i = j
        elif lc == "a" and _re.match(r"am/pm", fmt[i:], _re.I):
            toks.append(["ampm", True, fmt[i:i + 5] == fmt[i:i + 5].lower()])
            i += 5
        elif lc == "a" and _re.match(r"a/p", fmt[i:], _re.I):
            toks.append(["ampm", False, fmt[i:i + 3] == fmt[i:i + 3].lower()])
            i += 3
        elif c in ("0", "#", "?"):
            return ("error", _NO_FORMAT)
        else:
            toks.append(["lit", c])
            i += 1
    real = [t for t in toks if t[0] != "lit"]
    for r, t in enumerate(real):
        if t[0] == "mo" and ((r > 0 and real[r - 1][0] == "h") or (r + 1 < len(real) and real[r + 1][0] == "s")):
            t[0] = "mi"
    return ("date", toks, any(t[0] == "ampm" for t in toks))

def _fmt_parse(fmt):
    if fmt in _fmt_cache:
        return _fmt_cache[fmt]
    if fmt.strip().lower() == "general":
        parsed = ("general",)
    else:
        parts = _fmt_pieces(fmt)
        bare = "".join(c for c, lit in parts if not lit)
        if _re.search(r"[0#?]", bare):
            parsed = _fmt_parse_number(parts, bare)
        elif _re.search(r"[ymdhs]", bare, _re.I) or _re.search(r"a/p", bare, _re.I):
            parsed = _fmt_parse_date(fmt)
        else:
            parsed = _fmt_parse_number(parts, bare)
    if len(_fmt_cache) >= 64:
        _fmt_cache.clear()
    _fmt_cache[fmt] = parsed
    return parsed

def _fmt_date(ms, toks, twelve):
    d = _datetime(1970, 1, 1, tzinfo=_tz.utc) + _td(milliseconds=ms)
    hour = d.hour
    out = []
    for t in toks:
        k = t[0]
        if k == "lit":
            out.append(t[1])
        elif k == "y":
            out.append(("%02d" % (d.year % 100)) if t[1] <= 2 else str(d.year).rjust(4, "0"))
        elif k == "mo":
            m, n = d.month - 1, t[1]
            out.append(str(m + 1) if n == 1 else ("%02d" % (m + 1)) if n == 2 else _MONTHS[m][:3] if n == 3 else _MONTHS[m] if n == 4 else _MONTHS[m][0])
        elif k == "d":
            w, n = (d.weekday() + 1) % 7, t[1]
            out.append(str(d.day) if n == 1 else ("%02d" % d.day) if n == 2 else _WEEKDAYS[w][:3] if n == 3 else _WEEKDAYS[w])
        elif k == "h":
            h = ((hour % 12) or 12) if twelve else hour
            out.append(str(h) if t[1] == 1 else "%02d" % h)
        elif k == "mi":
            out.append(str(d.minute) if t[1] == 1 else "%02d" % d.minute)
        elif k == "s":
            out.append(str(d.second) if t[1] == 1 else "%02d" % d.second)
        else:
            word = ("AM" if hour < 12 else "PM") if t[1] else ("A" if hour < 12 else "P")
            out.append(word.lower() if t[2] else word)
    return "".join(out)

def _group3(s):
    parts = []
    while len(s) > 3:
        parts.insert(0, s[-3:])
        s = s[:-3]
    parts.insert(0, s)
    return ",".join(parts)

def _fmt_number(value, sections):
    negative = value < 0
    sec = sections[0]
    sign = "-" if negative else ""
    if len(sections) >= 2 and negative:
        sec = sections[1]
        sign = ""
    elif len(sections) >= 3 and value == 0:
        sec = sections[2]
    if sec["lit"]:
        return sign + sec["pre"] + sec["suf"]
    x = abs(value)
    if sec["pct"]:
        x *= 100
    dmax = sec["dmax"]
    shifted = x * _math.pow(10, dmax) + 0.5 + 1e-9
    if not _math.isfinite(shifted) or not _math.floor(shifted) < 1e15:
        raise _Err("TEXT: the number is too large for this format")
    scaled = _math.floor(shifted)
    digits = str(scaled).rjust(dmax + 1, "0")
    whole = digits[:len(digits) - dmax].lstrip("0")
    decimals = digits[len(digits) - dmax:]
    while len(decimals) > sec["dmin"] and decimals.endswith("0"):
        decimals = decimals[:-1]
    if len(whole) < sec["imin"]:
        whole = whole.rjust(sec["imin"], "0")
    if sec["thou"]:
        whole = _group3(whole)
    return sign + sec["pre"] + whole + ("." + decimals if sec["point"] else "") + sec["suf"]

def _fmt(value, fmt, is_date):
    p = _fmt_parse(fmt)
    if p[0] == "error":
        raise _Err(p[1])
    if p[0] == "general":
        return _numtext(value)
    if p[0] == "date":
        return _fmt_date(value if is_date else value * _DAY, p[1], p[2])
    return _fmt_number(value, p[1])

_NUM_PLAIN = _re.compile(r"[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?")
_NUM_GROUPED = _re.compile(r"[+-]?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]*)?")

def _value(s):
    t = s.strip()
    percent = False
    if t.endswith("%"):
        percent = True
        t = t[:-1].strip()
    t = _re.sub(r"^([+-]?)\s*[$€£]\s*", r"\1", t)
    if _NUM_GROUPED.fullmatch(t):
        t = t.replace(",", "")
    x = float(t) if _NUM_PLAIN.fullmatch(t) else float("nan")
    if not _math.isfinite(x):
        raise _Err(f"“{s[:20] + '…' if len(s) > 20 else s}” is not a number")
    return x / 100 if percent else x

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
    if fn == "TEXT":
        v, f = args[0](), text(1)
        if v is None or f is None:
            return None
        if isinstance(v, bool):
            return "TRUE" if v else "FALSE"
        if isinstance(v, str):
            return v
        return _fmt(float(v), f, ts[0] in _DATE) or None
    if fn == "VALUE":
        s = text(0)
        return None if s is None else _value(s)
    if fn == "SUBSTITUTE":
        s = text(0)
        if s is None:
            return None
        old, new = text(1), text(2)
        if old is None:
            return s
        if len(args) > 3:
            which = n(3)
            if which is None or which < 1:
                raise _Err("SUBSTITUTE needs an instance of 1 or more")
            at, nxt = -1, 0
            for _ in range(int(which)):
                at = s.find(old, nxt)
                if at < 0:
                    break
                nxt = at + len(old)
            out = s if at < 0 else s[:at] + (new or "") + s[at + len(old):]
        else:
            out = s.replace(old, new or "")
        return out or None
    if fn == "REPLACE":
        s, st, k, new = text(0), n(1), n(2), text(3)
        if s is None:
            return None
        if st is None or k is None or st < 1 or k < 0:
            raise _Err("REPLACE needs a start of 1 or more and a count of 0 or more")
        chars = list(s)
        out = "".join(chars[:int(st) - 1]) + (new or "") + "".join(chars[int(st) - 1 + int(k):])
        return out or None
    if fn == "PROPER":
        s = text(0)
        return None if s is None else s.title()
    if fn == "SEARCH":
        needle, hay, st = text(0), text(1), opt(2, 1)
        if hay is None:
            return None
        at = hay.lower().find((needle or "").lower(), max(0, int(st) - 1))
        if at < 0:
            raise _Err(f"“{needle or ''}” not found")
        return at + 1
    if fn == "EXACT":
        return (text(0) or "") == (text(1) or "")
    if fn in ("TEXTBEFORE", "TEXTAFTER"):
        s, d, which = text(0), text(1), opt(2, 1)
        if s is None:
            return None
        if d is None:
            raise _Err(f"{fn} needs a delimiter")
        k = int(which)
        if k == 0:
            raise _Err(f"{fn} needs an instance other than 0")
        at = -1
        if k > 0:
            nxt = 0
            for _ in range(k):
                at = s.find(d, nxt)
                if at < 0:
                    break
                nxt = at + len(d)
        else:
            at = s.rfind(d)
            for _ in range(1, -k):
                if at < 0:
                    break
                at = s.rfind(d, 0, at)
        if at < 0:
            raise _Err(f"“{d}” not found")
        out = s[:at] if fn == "TEXTBEFORE" else s[at + len(d):]
        return out or None
    if fn == "TEXTJOIN":
        d = text(0)
        skip = _bool(args[1]())
        parts = []
        for k in range(2, len(args)):
            p = text(k)
            if p is None and skip:
                continue
            parts.append(p or "")
        return (d or "").join(parts) or None
    if fn == "INT":
        x = n(0)
        return None if x is None else float(_math.floor(x))
    if fn in ("TRUNC", "ROUNDDOWN", "ROUNDUP"):
        x, d = n(0), opt(1, 0)
        if x is None:
            return None
        f = _math.pow(10, int(d))
        scaled = abs(x) * f
        r = _math.ceil(scaled - 1e-9) if fn == "ROUNDUP" else _math.floor(scaled + 1e-9)
        return _math.copysign(1.0, x) * r / f if x != 0 else 0.0
    if fn == "MOD":
        a, b = n(0), n(1)
        if a is None or b is None:
            return None
        if b == 0:
            raise _Err("divide by zero")
        return a - b * _math.floor(a / b)
    if fn == "SQRT":
        x = n(0)
        if x is None:
            return None
        if x < 0:
            raise _Err("SQRT needs a number of 0 or more")
        return _math.sqrt(x)
    if fn == "POWER":
        a, b = n(0), n(1)
        if a is None or b is None:
            return None
        try:
            r = _math.pow(a, b)
        except (OverflowError, ValueError):
            raise _Err("the power is out of range")
        if not _math.isfinite(r):
            raise _Err("the power is out of range")
        return r
    if fn == "LN":
        x = n(0)
        if x is None:
            return None
        if x <= 0:
            raise _Err("LN needs a number above 0")
        return _math.log(x)
    if fn in ("CEILING", "FLOOR"):
        x, m = n(0), opt(1, 1)
        if x is None:
            return None
        if m == 0 or x == 0:
            return 0.0
        if x > 0 and m < 0:
            raise _Err(f"{fn} needs a positive multiple for a positive number")
        return _math.ceil(x / m - 1e-9) * m if fn == "CEILING" else _math.floor(x / m + 1e-9) * m
    if fn in ("SUM", "AVERAGE"):
        total, count = 0.0, 0
        for k in range(len(args)):
            x = n(k)
            if x is not None:
                total += x
                count += 1
        if fn == "SUM":
            return total
        if count == 0:
            raise _Err("AVERAGE needs at least one number")
        return total / count
    if fn == "IFS":
        k = 0
        while k + 1 < len(args):
            if _bool(args[k]()):
                return args[k + 1]()
            k += 2
        raise _Err("IFS: no test is true")
    if fn == "SWITCH":
        k = 1
        while k + 1 < len(args):
            if _bin("=", args[0](), args[k](), ts[0], ts[k]) is True:
                return args[k + 1]()
            k += 2
        if len(args) % 2 == 0:
            return args[-1]()
        raise _Err("SWITCH: no case matches")
    if fn == "IFERROR":
        try:
            return args[0]()
        except _Err:
            return args[1]()
    if fn in ("ISNUMBER", "ISTEXT"):
        try:
            v = args[0]()
        except _Err:
            return False
        if fn == "ISNUMBER":
            return isinstance(v, (int, float)) and not isinstance(v, bool)
        return isinstance(v, str)
    if fn in ("HOUR", "MINUTE", "SECOND"):
        d = day(0)
        if d is None:
            return None
        return float(d.hour if fn == "HOUR" else d.minute if fn == "MINUTE" else d.second)
    if fn in ("EDATE", "EOMONTH"):
        d, m = day(0), n(1)
        if d is None or m is None:
            return None
        y, mo = divmod(d.year * 12 + (d.month - 1) + int(m), 12)
        try:
            last = _cal.monthrange(y, mo + 1)[1]
            dd = last if fn == "EOMONTH" else min(d.day, last)
            return _datetime(y, mo + 1, dd, tzinfo=_tz.utc).timestamp() * 1000
        except (ValueError, OverflowError):
            raise _Err("the date is out of range")
    if fn == "WEEKNUM":
        d, kind = day(0), opt(1, 1)
        if d is None:
            return None
        if kind == 21:
            return float(d.isocalendar()[1])
        if kind not in (1, 2):
            raise _Err("WEEKNUM type is 1, 2 or 21")
        jan = _datetime(d.year, 1, 1, tzinfo=_tz.utc)
        start = (((jan.weekday() + 1) % 7) - (0 if kind == 1 else 1) + 7) % 7
        return float(((d.date() - jan.date()).days + start) // 7 + 1)
    if fn == "DAYS":
        e, b = day(0), day(1)
        if e is None or b is None:
            return None
        return float((e.date() - b.date()).days)
    if fn == "NOW":
        return float(_math.floor(_datetime.now(_tz.utc).timestamp() * 1000))
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

def _window(fn, values, count):
    """A whole-column function over the column's values in stored order (as the app)."""
    nums = []
    for v in values:
        try:
            nums.append(_num(v))
        except _Err:
            nums.append(None)
    if fn == "PREVIOUS":
        return [None] + list(values[:-1])
    if fn == "RUNNINGSUM":
        out, total = [], 0.0
        for x in nums:
            if x is None:
                out.append(None)
            else:
                total += x
                out.append(total)
        return out
    if fn == "PERCENTOFTOTAL":
        total = sum(x for x in nums if x is not None)
        return [None if x is None else (_Err("divide by zero") if total == 0 else (x / total) * 100) for x in nums]
    if fn == "RANK":
        first = {}
        for k, x in enumerate(sorted((x for x in nums if x is not None), reverse=True)):
            first.setdefault(x, k + 1)
        return [None if x is None else float(first[x]) for x in nums]
    if fn in ("COLUMNMEAN", "COLUMNMEDIAN", "COLUMNSTDEV"):
        present = [x for x in nums if x is not None]
        if not present:
            return [None for _ in nums]
        total = 0.0
        for x in present:
            total += x
        mean = total / len(present)
        if fn == "COLUMNMEAN":
            result = mean
        elif fn == "COLUMNMEDIAN":
            srt = sorted(present)
            mid = len(srt) // 2
            result = srt[mid] if len(srt) % 2 == 1 else (srt[mid - 1] + srt[mid]) / 2
        elif len(present) < 2:
            result = _Err("COLUMNSTDEV needs at least two values")
        else:
            squares = 0.0
            for x in present:
                squares += (x - mean) * (x - mean)
            result = _math.sqrt(squares / (len(present) - 1))
        return [result for _ in nums]
    if fn == "BIN":
        present = [x for x in nums if x is not None]
        if count < 1:
            return [_Err("BIN needs a count of 1 or more") for _ in nums]
        lo, hi = (min(present), max(present)) if present else (0.0, 0.0)
        width = (hi - lo) / int(count)
        return [None if x is None else (1.0 if width == 0 else float(max(1, _math.ceil((x - lo) / width)))) for x in nums]
    return [_Err(f"{fn} is not available") for _ in nums]

def _w(W, k, i):
    v = W[k][i]
    if isinstance(v, _Err):
        raise v
    return v

def _derive(rows, f, t, windows=()):
    """One new column's cells as text, the way the app writes them ("" left empty)."""
    rows = list(rows)
    W = [_window(fn, [_read(r[c], ct) for r in rows], count) for fn, c, ct, count in windows]
    out = []
    for i, r in enumerate(rows):
        try:
            v = f(r, i, W)
        except _Err:
            v = None
        s = None if v is None else _text(v, t)
        out.append(s if s not in ("", None) else None)
    return out
# --- end of formula helpers ---
# new column "total" = [price] * [qty]
def _f1(r, i, W):
    return _bin("*", _read(r["price"], "number"), _read(r["qty"], "number"), "number", "number")
df.insert(9, "total", _derive(df.to_dict("records"), _f1, "number", []))
# new column "ratio" = [price] / [qty]
def _f2(r, i, W):
    return _bin("/", _read(r["price"], "number"), _read(r["qty"], "number"), "number", "number")
df.insert(10, "ratio", _derive(df.to_dict("records"), _f2, "number", []))
# new column "power" = -[qty] ^ 2 + 0.1 + 0.2
def _f3(r, i, W):
    return _bin("+", _bin("+", _bin("^", _neg(_read(r["qty"], "number")), 2, "number", "number"), 0.1, "number", "number"), 0.2, "number", "number")
df.insert(11, "power", _derive(df.to_dict("records"), _f3, "number", []))
# new column "full" = [first] & " " & [last]
def _f4(r, i, W):
    return _bin("&", _bin("&", _read(r["first"], "text"), " ", "text", "text"), _read(r["last"], "text"), "text", "text")
df.insert(12, "full", _derive(df.to_dict("records"), _f4, "text", []))
# new column "joined" = CONCAT([first], [qty], TRUE)
def _f5(r, i, W):
    return _call("CONCAT", [lambda: _read(r["first"], "text"), lambda: _read(r["qty"], "number"), lambda: True], ["text", "number", "bool"])
df.insert(13, "joined", _derive(df.to_dict("records"), _f5, "text", []))
# new column "upper" = UPPER([first])
def _f6(r, i, W):
    return _call("UPPER", [lambda: _read(r["first"], "text")], ["text"])
df.insert(14, "upper", _derive(df.to_dict("records"), _f6, "text", []))
# new column "lower" = LOWER([status])
def _f7(r, i, W):
    return _call("LOWER", [lambda: _read(r["status"], "text")], ["text"])
df.insert(15, "lower", _derive(df.to_dict("records"), _f7, "text", []))
# new column "trimmed" = TRIM("  a   b ") & [last]
def _f8(r, i, W):
    return _bin("&", _call("TRIM", [lambda: "  a   b "], ["text"]), _read(r["last"], "text"), "text", "text")
df.insert(16, "trimmed", _derive(df.to_dict("records"), _f8, "text", []))
# new column "len" = LEN([last])
def _f9(r, i, W):
    return _call("LEN", [lambda: _read(r["last"], "text")], ["text"])
df.insert(17, "len", _derive(df.to_dict("records"), _f9, "number", []))
# new column "left" = LEFT([last], 3)
def _f10(r, i, W):
    return _call("LEFT", [lambda: _read(r["last"], "text"), lambda: 3], ["text", "number"])
df.insert(18, "left", _derive(df.to_dict("records"), _f10, "text", []))
# new column "right" = RIGHT([last])
def _f11(r, i, W):
    return _call("RIGHT", [lambda: _read(r["last"], "text")], ["text"])
df.insert(19, "right", _derive(df.to_dict("records"), _f11, "text", []))
# new column "mid" = MID([last], 2, 3)
def _f12(r, i, W):
    return _call("MID", [lambda: _read(r["last"], "text"), lambda: 2, lambda: 3], ["text", "number", "number"])
df.insert(20, "mid", _derive(df.to_dict("records"), _f12, "text", []))
# new column "at" = FIND("@", [email])
def _f13(r, i, W):
    return _call("FIND", [lambda: "@", lambda: _read(r["email"], "text")], ["text", "text"])
df.insert(21, "at", _derive(df.to_dict("records"), _f13, "number", []))
# new column "user" = LEFT([email], FIND("@", [email]) - 1)
def _f14(r, i, W):
    return _call("LEFT", [lambda: _read(r["email"], "text"), lambda: _bin("-", _call("FIND", [lambda: "@", lambda: _read(r["email"], "text")], ["text", "text"]), 1, "number", "number")], ["text", "number"])
df.insert(22, "user", _derive(df.to_dict("records"), _f14, "text", []))
# new column "has" = CONTAINS([email], "X.ORG")
def _f15(r, i, W):
    return _call("CONTAINS", [lambda: _read(r["email"], "text"), lambda: "X.ORG"], ["text", "text"])
df.insert(23, "has", _derive(df.to_dict("records"), _f15, "bool", []))
# new column "is_open" = [status] = "open"
def _f16(r, i, W):
    return _bin("=", _read(r["status"], "text"), "open", "text", "text")
df.insert(24, "is_open", _derive(df.to_dict("records"), _f16, "bool", []))
# new column "not_open" = [status] <> "open"
def _f17(r, i, W):
    return _bin("<>", _read(r["status"], "text"), "open", "text", "text")
df.insert(25, "not_open", _derive(df.to_dict("records"), _f17, "bool", []))
# new column "big" = [price] > 3
def _f18(r, i, W):
    return _bin(">", _read(r["price"], "number"), 3, "number", "number")
df.insert(26, "big", _derive(df.to_dict("records"), _f18, "bool", []))
# new column "label" = IF([status] = "closed", "Done", "Open")
def _f19(r, i, W):
    return _call("IF", [lambda: _bin("=", _read(r["status"], "text"), "closed", "text", "text"), lambda: "Done", lambda: "Open"], ["bool", "text", "text"])
df.insert(27, "label", _derive(df.to_dict("records"), _f19, "text", []))
# new column "maybe" = IF([price] >= 4, "Big")
def _f20(r, i, W):
    return _call("IF", [lambda: _bin(">=", _read(r["price"], "number"), 4, "number", "number"), lambda: "Big"], ["bool", "text"])
df.insert(28, "maybe", _derive(df.to_dict("records"), _f20, "text", []))
# new column "mixed" = IF([qty] > 3, [qty], "few")
def _f21(r, i, W):
    return _call("IF", [lambda: _bin(">", _read(r["qty"], "number"), 3, "number", "number"), lambda: _read(r["qty"], "number"), lambda: "few"], ["bool", "number", "text"])
df.insert(29, "mixed", _derive(df.to_dict("records"), _f21, "text", []))
# new column "both" = AND([qty] > 0, [solar])
def _f22(r, i, W):
    return _call("AND", [lambda: _bin(">", _read(r["qty"], "number"), 0, "number", "number"), lambda: _read(r["solar"], "bool")], ["bool", "bool"])
df.insert(30, "both", _derive(df.to_dict("records"), _f22, "bool", []))
# new column "either" = OR([qty] = 0, [solar])
def _f23(r, i, W):
    return _call("OR", [lambda: _bin("=", _read(r["qty"], "number"), 0, "number", "number"), lambda: _read(r["solar"], "bool")], ["bool", "bool"])
df.insert(31, "either", _derive(df.to_dict("records"), _f23, "bool", []))
# new column "no_solar" = NOT([solar])
def _f24(r, i, W):
    return _call("NOT", [lambda: _read(r["solar"], "bool")], ["bool"])
df.insert(32, "no_solar", _derive(df.to_dict("records"), _f24, "bool", []))
# new column "no_first" = ISBLANK([first])
def _f25(r, i, W):
    return _call("ISBLANK", [lambda: _read(r["first"], "text")], ["text"])
df.insert(33, "no_first", _derive(df.to_dict("records"), _f25, "bool", []))
# new column "name" = COALESCE([first], [last], "?")
def _f26(r, i, W):
    return _call("COALESCE", [lambda: _read(r["first"], "text"), lambda: _read(r["last"], "text"), lambda: "?"], ["text", "text", "text"])
df.insert(34, "name", _derive(df.to_dict("records"), _f26, "text", []))
# new column "status2" = IFBLANK([status], "Unknown")
def _f27(r, i, W):
    return _call("IFBLANK", [lambda: _read(r["status"], "text"), lambda: "Unknown"], ["text", "text"])
df.insert(35, "status2", _derive(df.to_dict("records"), _f27, "text", []))
# new column "r0" = ROUND(2.5) + ROUND(-2.5)
def _f28(r, i, W):
    return _bin("+", _call("ROUND", [lambda: 2.5], ["number"]), _call("ROUND", [lambda: _neg(2.5)], ["number"]), "number", "number")
df.insert(36, "r0", _derive(df.to_dict("records"), _f28, "number", []))
# new column "r2" = ROUND([price] * 1.07, 2)
def _f29(r, i, W):
    return _call("ROUND", [lambda: _bin("*", _read(r["price"], "number"), 1.07, "number", "number"), lambda: 2], ["number", "number"])
df.insert(37, "r2", _derive(df.to_dict("records"), _f29, "number", []))
# new column "rneg" = ROUND(1234, -2)
def _f30(r, i, W):
    return _call("ROUND", [lambda: 1234, lambda: _neg(2)], ["number", "number"])
df.insert(38, "rneg", _derive(df.to_dict("records"), _f30, "number", []))
# new column "abs" = ABS(-[qty])
def _f31(r, i, W):
    return _call("ABS", [lambda: _neg(_read(r["qty"], "number"))], ["number"])
df.insert(39, "abs", _derive(df.to_dict("records"), _f31, "number", []))
# new column "lo" = MIN([price], [qty])
def _f32(r, i, W):
    return _call("MIN", [lambda: _read(r["price"], "number"), lambda: _read(r["qty"], "number")], ["number", "number"])
df.insert(40, "lo", _derive(df.to_dict("records"), _f32, "number", []))
# new column "hi" = MAX([price], [qty])
def _f33(r, i, W):
    return _call("MAX", [lambda: _read(r["price"], "number"), lambda: _read(r["qty"], "number")], ["number", "number"])
df.insert(41, "hi", _derive(df.to_dict("records"), _f33, "number", []))
# new column "year" = YEAR([ordered])
def _f34(r, i, W):
    return _call("YEAR", [lambda: _read(r["ordered"], "date")], ["date"])
df.insert(42, "year", _derive(df.to_dict("records"), _f34, "number", []))
# new column "month" = MONTH([ordered])
def _f35(r, i, W):
    return _call("MONTH", [lambda: _read(r["ordered"], "date")], ["date"])
df.insert(43, "month", _derive(df.to_dict("records"), _f35, "number", []))
# new column "day" = DAY([ordered])
def _f36(r, i, W):
    return _call("DAY", [lambda: _read(r["ordered"], "date")], ["date"])
df.insert(44, "day", _derive(df.to_dict("records"), _f36, "number", []))
# new column "wd1" = WEEKDAY([ordered])
def _f37(r, i, W):
    return _call("WEEKDAY", [lambda: _read(r["ordered"], "date")], ["date"])
df.insert(45, "wd1", _derive(df.to_dict("records"), _f37, "number", []))
# new column "wd2" = WEEKDAY([ordered], 2)
def _f38(r, i, W):
    return _call("WEEKDAY", [lambda: _read(r["ordered"], "date"), lambda: 2], ["date", "number"])
df.insert(46, "wd2", _derive(df.to_dict("records"), _f38, "number", []))
# new column "wd3" = WEEKDAY([ordered], 3)
def _f39(r, i, W):
    return _call("WEEKDAY", [lambda: _read(r["ordered"], "date"), lambda: 3], ["date", "number"])
df.insert(47, "wd3", _derive(df.to_dict("records"), _f39, "number", []))
# new column "days" = [shipped] - [ordered]
def _f40(r, i, W):
    return _bin("-", _read(r["shipped"], "date"), _read(r["ordered"], "date"), "date", "date")
df.insert(48, "days", _derive(df.to_dict("records"), _f40, "number", []))
# new column "later" = [ordered] + 30
def _f41(r, i, W):
    return _bin("+", _read(r["ordered"], "date"), 30, "date", "number")
df.insert(49, "later", _derive(df.to_dict("records"), _f41, "date", []))
# new column "dd" = DATEDIF([ordered], [shipped], "d")
def _f42(r, i, W):
    return _call("DATEDIF", [lambda: _read(r["ordered"], "date"), lambda: _read(r["shipped"], "date"), lambda: "d"], ["date", "date", "text"])
df.insert(50, "dd", _derive(df.to_dict("records"), _f42, "number", []))
# new column "yy" = DATEDIF(DATE(2020, 2, 29), [shipped], "y")
def _f43(r, i, W):
    return _call("DATEDIF", [lambda: _call("DATE", [lambda: 2020, lambda: 2, lambda: 29], ["number", "number", "number"]), lambda: _read(r["shipped"], "date"), lambda: "y"], ["date", "date", "text"])
df.insert(51, "yy", _derive(df.to_dict("records"), _f43, "number", []))
# new column "mm" = DATEDIF(DATE(2024, 1, 31), [shipped], "m")
def _f44(r, i, W):
    return _call("DATEDIF", [lambda: _call("DATE", [lambda: 2024, lambda: 1, lambda: 31], ["number", "number", "number"]), lambda: _read(r["shipped"], "date"), lambda: "m"], ["date", "date", "text"])
df.insert(52, "mm", _derive(df.to_dict("records"), _f44, "number", []))
# new column "bad" = DATEDIF([shipped], [ordered], "d")
def _f45(r, i, W):
    return _call("DATEDIF", [lambda: _read(r["shipped"], "date"), lambda: _read(r["ordered"], "date"), lambda: "d"], ["date", "date", "text"])
df.insert(53, "bad", _derive(df.to_dict("records"), _f45, "number", []))
# new column "made" = DATE(2024, 13, 1)
def _f46(r, i, W):
    return _call("DATE", [lambda: 2024, lambda: 13, lambda: 1], ["number", "number", "number"])
df.insert(54, "made", _derive(df.to_dict("records"), _f46, "date", []))
# new column "age" = DATEDIF(DATE(2000, 1, 1), TODAY(), "y") > 20
def _f47(r, i, W):
    return _bin(">", _call("DATEDIF", [lambda: _call("DATE", [lambda: 2000, lambda: 1, lambda: 1], ["number", "number", "number"]), lambda: _call("TODAY", [], []), lambda: "y"], ["date", "date", "text"]), 20, "number", "number")
df.insert(55, "age", _derive(df.to_dict("records"), _f47, "bool", []))
# new column "n" = ROWNUMBER()
def _f48(r, i, W):
    return float(i + 1)
df.insert(56, "n", _derive(df.to_dict("records"), _f48, "number", []))
# new column "rank" = RANK([price])
def _f49(r, i, W):
    return _w(W, 0, i)
df.insert(57, "rank", _derive(df.to_dict("records"), _f49, "number", [("RANK", "price", "number", 0)]))
# new column "share" = PERCENTOFTOTAL([price])
def _f50(r, i, W):
    return _w(W, 0, i)
df.insert(58, "share", _derive(df.to_dict("records"), _f50, "number", [("PERCENTOFTOTAL", "price", "number", 0)]))
# new column "running" = RUNNINGSUM([qty])
def _f51(r, i, W):
    return _w(W, 0, i)
df.insert(59, "running", _derive(df.to_dict("records"), _f51, "number", [("RUNNINGSUM", "qty", "number", 0)]))
# new column "change" = [qty] - PREVIOUS([qty])
def _f52(r, i, W):
    return _bin("-", _read(r["qty"], "number"), _w(W, 0, i), "number", "number")
df.insert(60, "change", _derive(df.to_dict("records"), _f52, "number", [("PREVIOUS", "qty", "number", 0)]))
# new column "prev_name" = PREVIOUS([first])
def _f53(r, i, W):
    return _w(W, 0, i)
df.insert(61, "prev_name", _derive(df.to_dict("records"), _f53, "text", [("PREVIOUS", "first", "text", 0)]))
# new column "band" = BIN([qty], 3)
def _f54(r, i, W):
    return _w(W, 0, i)
df.insert(62, "band", _derive(df.to_dict("records"), _f54, "number", [("BIN", "qty", "number", 3)]))

df.to_csv("cleaned.csv", index=False)
