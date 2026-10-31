/**
 * New-column formulas as Python for the pandas and Polars recipes. Each formula becomes
 * a small function over one row (`def _f1(r): return …`); one shared helper block ports
 * the app's rules (blank in, blank out; comparisons with a blank; text compared without
 * case; date arithmetic in days; every function; an error leaves the cell empty), so
 * both scripts give the app's result. Row by row is slower than vectorised code, but a
 * recipe runs once and must agree with the app cell for cell.
 */

import { compileFormula, typeOf, WINDOW_FUNCTIONS, type FormulaColumnInfo, type Node } from "./column-formula.js";

const py = (value: string): string => JSON.stringify(value);

/**
 * The formula as a Python expression over the row dict `r` and its index `i`; whole-column
 * functions read `W` (worked out by _derive from `windows`, a Python list literal).
 */
export function formulaPython(formula: string, columns: readonly FormulaColumnInfo[]): { expr: string; type: string; windows: string } | null {
  const compiled = compileFormula(formula, columns);
  if (!compiled.ok) return null;
  const t = (n: Node): string => typeOf(n, columns);
  const windows: string[] = [];
  const emit = (n: Node): string => {
    switch (n.k) {
      case "num": return String(n.v);
      case "str": return n.v === "" ? "None" : py(n.v);
      case "bool": return n.v ? "True" : "False";
      case "col": return `_read(r[${py(n.name)}], ${py(t(n))})`;
      case "un": return `_neg(${emit(n.a)})`.replace(/^_neg/, n.op === "-" ? "_neg" : "_pos");
      case "bin": return `_bin(${py(n.op)}, ${emit(n.a)}, ${emit(n.b)}, ${py(t(n.a))}, ${py(t(n.b))})`;
      case "call": {
        if (n.fn === "ROWNUMBER") return "float(i + 1)";
        const col = n.args[0];
        if (WINDOW_FUNCTIONS.has(n.fn) && col?.k === "col") {
          const count = n.fn === "BIN" ? (n.args[1] as { v: number }).v : 0;
          windows.push(`(${py(n.fn)}, ${py(col.name)}, ${py(t(col))}, ${count})`);
          return `_w(W, ${windows.length - 1}, i)`;
        }
        return `_call(${py(n.fn)}, [${n.args.map((a) => `lambda: ${emit(a)}`).join(", ")}], [${n.args.map((a) => py(t(a))).join(", ")}])`;
      }
    }
  };
  const expr = emit(compiled.ast);
  return { expr, type: compiled.type, windows: `[${windows.join(", ")}]` };
}

/** The helpers every formula column uses; written once per script. */
export const FORMULA_PRELUDE: readonly string[] = String.raw`# --- TurboFuzz formula helpers: the app's rules for new columns, row by row ---
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
# --- end of formula helpers ---`.split("\n");
