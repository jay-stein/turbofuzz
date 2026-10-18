import { parseDate, toDateInputValue, toDateTimeValue, type DateOrder } from "../parse/dates.js";
import { escapeFormula } from "./formula.js";
import { detectDecimalStyle, parseNumber, type NumberLocale } from "../parse/numbers.js";
import { castColumn, type CastPolicy, type CastTarget } from "./cast-ops.js";

export type CleanCaseStyle = "upper" | "lower" | "title";

export type CleanOp =
  | { kind: "trim" }
  | { kind: "case"; style: CleanCaseStyle }
  | { kind: "replace"; find: string; replacement: string; ignoreCase: boolean }
  | { kind: "toNumber"; locale: NumberLocale }
  | { kind: "repairDecimal"; locale: NumberLocale }
  | { kind: "escapeFormulas" }
  | { kind: "toDate"; order: DateOrder }
  | { kind: "toDateTime"; order: DateOrder }
  | {
      kind: "cast";
      target: CastTarget;
      policy: CastPolicy;
      locale?: NumberLocale;
      order?: DateOrder;
    };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyCase(value: string, style: CleanCaseStyle): string {
  switch (style) {
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    case "title":
      return value.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  }
}

/** Compiles an op to a single-value transform so regexes are built once, not per cell. */
function compileOp(op: CleanOp): (value: string) => string {
  switch (op.kind) {
    case "trim":
      return (value) => value.trim().replace(/\s+/g, " ");
    case "case":
      return (value) => applyCase(value, op.style);
    case "replace": {
      if (op.find === "") return (value) => value;
      if (op.ignoreCase) {
        const pattern = new RegExp(escapeRegExp(op.find), "gi");
        return (value) => value.replace(pattern, op.replacement);
      }
      const find = op.find;
      return (value) => value.split(find).join(op.replacement);
    }
    case "toNumber": {
      const locale = op.locale;
      return (value) => {
        const parsed = parseNumber(value, locale);
        return Number.isFinite(parsed) ? String(parsed) : value;
      };
    }
    case "repairDecimal": {
      // Rewrites only the values written in the *other* decimal convention,
      // leaving the column's dominant format untouched.
      const other: NumberLocale = op.locale === "dot" ? "comma" : "dot";
      return (value) => {
        if (detectDecimalStyle(value) !== other) return value;
        const parsed = parseNumber(value, other);
        if (!Number.isFinite(parsed)) return value;
        const canonical = String(parsed);
        return op.locale === "dot" ? canonical : canonical.replace(".", ",");
      };
    }
    case "toDate": {
      const order = op.order;
      return (value) => {
        const parsed = parseDate(value, order);
        return Number.isFinite(parsed) ? toDateInputValue(parsed) : value;
      };
    }
    case "toDateTime": {
      const order = op.order;
      return (value) => {
        const parsed = parseDate(value, order);
        return Number.isFinite(parsed) ? toDateTimeValue(parsed) : value;
      };
    }
    case "escapeFormulas":
      return (value) => escapeFormula(value);
    case "cast":
      return (value) => value;
  }
}

/**
 * Non-destructive value clean: returns a new array with each op applied in
 * order. The input array is never mutated.
 */
export function applyCleanOps(values: readonly string[], ops: readonly CleanOp[]): string[] {
  let out = values.slice();
  for (const op of ops) {
    if (op.kind === "cast") {
      out = castColumn(out, {
        target: op.target,
        policy: op.policy,
        locale: op.locale,
        dateOrder: op.order,
      }).values;
      continue;
    }
    const transform = compileOp(op);
    for (let i = 0; i < out.length; i++) out[i] = transform(out[i]);
  }
  return out;
}

const opKey = (op: CleanOp): string => JSON.stringify(op);

/** True when `next` keeps the exact prefix the worker already applied. */
export function isCleanOpPrefix(
  prior: readonly CleanOp[],
  next: readonly CleanOp[],
): boolean {
  if (prior.length > next.length) return false;
  for (let index = 0; index < prior.length; index++) {
    if (opKey(prior[index]) !== opKey(next[index])) return false;
  }
  return true;
}

export interface IncrementalCleanResult {
  values: string[];
  /** False when only the suffix was applied to the current values. */
  replayed: boolean;
}

/**
 * Apply a new clean list without replaying the prefix the worker already
 * applied. Reorder/removal/policy changes still replay from the pristine
 * source, so the result is byte-identical to a full pass.
 */
export function applyCleanOpsIncremental(
  current: readonly string[],
  source: readonly string[],
  prior: readonly CleanOp[],
  next: readonly CleanOp[],
): IncrementalCleanResult {
  if (isCleanOpPrefix(prior, next)) {
    const suffix = next.slice(prior.length);
    return {
      values: suffix.length === 0 ? current.slice() : applyCleanOps(current, suffix),
      replayed: false,
    };
  }
  return { values: applyCleanOps(source, next), replayed: true };
}
const CAST_TARGET_LABELS: Record<CastTarget, string> = {
  integer: "integer",
  number: "number",
  date: "date",
  datetime: "date & time",
  time: "time of day",
  duration: "duration",
  boolean: "boolean",
};

const CAST_POLICY_LABELS: Record<CastPolicy, string> = {
  coerce: "invalid values become blank",
  keep: "invalid values stay as text",
  reject: "cancel if any value fails",
};

export function describeCleanOp(op: CleanOp): string {
  switch (op.kind) {
    case "trim":
      return "Trim whitespace (strip ends, collapse runs)";
    case "case":
      return op.style === "upper"
        ? "Change case to UPPERCASE"
        : op.style === "lower"
          ? "Change case to lowercase"
          : "Change case to Title Case";
    case "replace":
      return `Replace text “${op.find}” → “${op.replacement}”${
        op.ignoreCase ? " (case-insensitive)" : " (exact match)"
      }`;
    case "toNumber":
      return `Convert to number (${op.locale === "comma" ? "decimal comma, 1.234,56" : "decimal point, 1,234.56"})`;
    case "repairDecimal":
      return op.locale === "dot"
        ? "Repair decimal-comma values (613,26 → 613.26)"
        : "Repair decimal-point values (1.23 → 1,23)";
    case "escapeFormulas":
      return "Escape formula-like cells (=1+1 → '=1+1)";
    case "toDate":
      return `Convert to date (date only, ${op.order === "dmy" ? "day first DD/MM/YYYY" : "month first MM/DD/YYYY"})`;
    case "toDateTime":
      return `Convert to date & time (keeps the clock, stored as UTC — ${
        op.order === "dmy" ? "day first" : "month first"
      })`;
    case "cast":
      return `Convert to ${CAST_TARGET_LABELS[op.target]} (${CAST_POLICY_LABELS[op.policy]})`;
  }
}

/** Technical signature shown as the second line of a recorded step. */
export function describeCleanOpDetail(op: CleanOp): string {
  switch (op.kind) {
    case "trim":
      return "trim()";
    case "case":
      return `case(style=${op.style})`;
    case "replace":
      return `replace(find=${JSON.stringify(op.find)}, with=${JSON.stringify(op.replacement)}, ignoreCase=${op.ignoreCase})`;
    case "toNumber":
      return `toNumber(locale=${op.locale})`;
    case "repairDecimal":
      return `repairDecimal(locale=${op.locale})`;
    case "escapeFormulas":
      return "escapeFormulas()";
    case "toDate":
      return `toDate(order=${op.order})`;
    case "toDateTime":
      return `toDateTime(order=${op.order})`;
    case "cast":
      return `cast(target=${op.target}, policy=${op.policy}, locale=${op.locale ?? "auto"}, order=${
        op.order ?? "auto"
      })`;
  }
}
