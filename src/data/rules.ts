import type { ColumnData } from "./column.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ScoreCheck, ScoreDimension } from "./score.js";
import { suggestPairs } from "./pair-checks.js";

/**
 * User-kept expectations. A rule is plain data interpreted by `evaluateRule`; there
 * is no eval and no `new Function`. Columns are referred to by name so a rules file
 * keeps working on next month's export.
 */
export type RuleType = "notNull" | "unique" | "range" | "inList" | "regex" | "length" | "compare";
export type RuleSeverity = "critical" | "major" | "minor";
export type CompareOperator = "gte" | "gt" | "eq";

export interface Rule {
  id: string;
  type: RuleType;
  column: string;
  severity: RuleSeverity;
  /** Share of compared values allowed to fail before the rule fails (0.005 = 0.5%). */
  allowedFailure: number;
  min?: number;
  max?: number;
  values?: string[];
  pattern?: string;
  /** Second column for `compare`: the column must be >= / > / = this one. */
  other?: string;
  operator?: CompareOperator;
  /** Proposed by the recommender, not yet accepted by the user. */
  suggested?: boolean;
}

export interface RuleResult {
  id: string;
  fail: number;
  compared: number;
  examples: string[];
  /** Why the rule could not run (column missing, bad pattern); null when it ran. */
  error: string | null;
}

const MAX_PATTERN = 200;
const MAX_EXAMPLES = 3;

/** Nested quantifiers such as (a+)+ can take exponential time; refuse them. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

/** A human reason the rule cannot be saved, or null when it is fine. */
export function validateRule(rule: Rule): string | null {
  if (rule.column.trim() === "") return "Pick a column.";
  if (rule.allowedFailure < 0 || rule.allowedFailure > 1) return "The allowed failure share is between 0% and 100%.";
  switch (rule.type) {
    case "range":
      if (rule.min === undefined && rule.max === undefined) return "Give a minimum, a maximum or both.";
      if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) return "The minimum is above the maximum.";
      return null;
    case "inList":
      return (rule.values ?? []).length === 0 ? "List at least one allowed value." : null;
    case "regex": {
      const pattern = rule.pattern ?? "";
      if (pattern === "") return "Write a pattern.";
      if (pattern.length > MAX_PATTERN) return `Keep the pattern under ${MAX_PATTERN} characters.`;
      if (NESTED_QUANTIFIER.test(pattern)) return "Nested repeats such as (a+)+ can hang the page; simplify the pattern.";
      try {
        new RegExp(`^(?:${pattern})$`);
      } catch {
        return "That pattern is not valid.";
      }
      return null;
    }
    case "length":
      if (rule.min === undefined && rule.max === undefined) return "Give a minimum length, a maximum or both.";
      return null;
    case "compare":
      return rule.other === undefined || rule.other === "" ? "Pick the column to compare with." : null;
    default:
      return null;
  }
}

export function ruleDimension(rule: Rule): ScoreDimension {
  switch (rule.type) {
    case "notNull":
      return "completeness";
    case "unique":
      return "uniqueness";
    case "compare":
      return "consistency";
    default:
      return "validity";
  }
}

const OPERATOR_SYMBOL: Record<CompareOperator, string> = { gte: "≥", gt: ">", eq: "=" };

/** One plain sentence for the rule. */
export function describeRule(rule: Rule): string {
  const name = `“${rule.column}”`;
  switch (rule.type) {
    case "notNull":
      return `${name} is never empty`;
    case "unique":
      return `${name} is unique`;
    case "range":
      return `${name} is ${rule.min !== undefined && rule.max !== undefined ? `between ${rule.min} and ${rule.max}` : rule.min !== undefined ? `at least ${rule.min}` : `at most ${rule.max}`}`;
    case "inList": {
      const values = rule.values ?? [];
      const shown = values.slice(0, 4).join(", ");
      return `${name} is one of ${shown}${values.length > 4 ? `, +${values.length - 4} more` : ""}`;
    }
    case "regex":
      return `${name} matches ${rule.pattern ?? ""}`;
    case "length":
      return `${name} is ${rule.min !== undefined && rule.max !== undefined ? `${rule.min} to ${rule.max}` : rule.min !== undefined ? `at least ${rule.min}` : `at most ${rule.max}`} characters long`;
    case "compare":
      return `${name} ${OPERATOR_SYMBOL[rule.operator ?? "gte"]} “${rule.other ?? ""}”`;
  }
}

/** Runs one rule over the loaded columns. Pure; never throws. */
export function evaluateRule(rule: Rule, columns: readonly ColumnData[], rowCount: number): RuleResult {
  const empty = (error: string): RuleResult => ({ id: rule.id, fail: 0, compared: 0, examples: [], error });
  const invalid = validateRule(rule);
  if (invalid !== null) return empty(invalid);
  const column = columns.find((candidate) => candidate.name === rule.column);
  if (column === undefined) return empty(`Column “${rule.column}” is not in this file.`);
  let fail = 0;
  let compared = 0;
  const examples: string[] = [];
  const note = (raw: string): void => {
    fail++;
    if (examples.length < MAX_EXAMPLES && !examples.includes(raw)) examples.push(raw);
  };

  switch (rule.type) {
    case "notNull": {
      compared = rowCount;
      for (let row = 0; row < rowCount; row++) if (column.nullMask.get(row)) fail++;
      break;
    }
    case "unique": {
      const seen = new Set<string>();
      for (let row = 0; row < rowCount; row++) {
        if (column.nullMask.get(row)) continue;
        compared++;
        const value = column.raw[row].trim();
        if (seen.has(value)) note(value);
        else seen.add(value);
      }
      break;
    }
    case "range": {
      const numbers = column.numbers();
      for (let row = 0; row < rowCount; row++) {
        const value = numbers[row];
        if (!Number.isFinite(value)) continue;
        compared++;
        if ((rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max)) note(column.raw[row]);
      }
      break;
    }
    case "inList": {
      const allowed = new Set((rule.values ?? []).map((value) => value.trim()));
      for (let row = 0; row < rowCount; row++) {
        if (column.nullMask.get(row)) continue;
        compared++;
        const value = column.raw[row].trim();
        if (!allowed.has(value)) note(value);
      }
      break;
    }
    case "regex": {
      const expression = new RegExp(`^(?:${rule.pattern ?? ""})$`);
      for (let row = 0; row < rowCount; row++) {
        if (column.nullMask.get(row)) continue;
        compared++;
        const value = column.raw[row].trim();
        if (!expression.test(value)) note(value);
      }
      break;
    }
    case "length": {
      for (let row = 0; row < rowCount; row++) {
        if (column.nullMask.get(row)) continue;
        compared++;
        const value = column.raw[row].trim();
        if ((rule.min !== undefined && value.length < rule.min) || (rule.max !== undefined && value.length > rule.max)) note(value);
      }
      break;
    }
    case "compare": {
      const other = columns.find((candidate) => candidate.name === rule.other);
      if (other === undefined) return empty(`Column “${rule.other ?? ""}” is not in this file.`);
      const left = column.numbers();
      const right = other.numbers();
      const operator = rule.operator ?? "gte";
      for (let row = 0; row < rowCount; row++) {
        const x = left[row];
        const y = right[row];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        compared++;
        const ok = operator === "gte" ? x >= y : operator === "gt" ? x > y : x === y;
        if (!ok) note(`${column.raw[row]} vs ${other.raw[row]}`);
      }
      break;
    }
  }
  return { id: rule.id, fail, compared, examples, error: null };
}

/** The scored check an accepted rule contributes. Within the allowed share it passes. */
export function ruleToCheck(rule: Rule, result: RuleResult, columnIndex: number | null): ScoreCheck {
  const share = result.compared === 0 ? 0 : result.fail / result.compared;
  const withinAllowance = share <= rule.allowedFailure;
  const allowance = rule.allowedFailure > 0 ? ` · up to ${(rule.allowedFailure * 100).toFixed(1).replace(/\.0$/, "")}% may fail` : "";
  const detail =
    result.error !== null
      ? result.error
      : `${result.fail.toLocaleString()} of ${result.compared.toLocaleString()} fail${result.examples.length > 0 ? ` (e.g. ${result.examples.join(", ")})` : ""}${allowance} · ${rule.severity}`;
  return {
    id: `rule.${rule.id}`,
    dimension: ruleDimension(rule),
    label: describeRule(rule),
    detail,
    pass: result.error !== null ? 0 : result.compared - (withinAllowance ? 0 : result.fail),
    fail: result.error !== null || withinAllowance ? 0 : result.fail,
    na: 0,
    column: columnIndex,
    filter: null,
    fixLabel: null,
  };
}

let nextId = 1;
export function newRuleId(): string {
  return `r${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

/**
 * Rules worth proposing from the profile alone: not-null where a column is complete,
 * unique for key-like columns, a range with a margin for numbers, an allowed list for
 * small closed sets, and end-after-start for name pairs. Everything is marked
 * `suggested`; the user accepts the ones they want.
 */
export function recommendRules(metas: readonly ColumnMeta[], rowCount: number): Rule[] {
  if (rowCount === 0) return [];
  const out: Rule[] = [];
  const add = (rule: Omit<Rule, "id" | "allowedFailure" | "suggested"> & { allowedFailure?: number }): void => {
    out.push({ id: newRuleId(), allowedFailure: 0, suggested: true, ...rule });
  };
  metas.forEach((meta) => {
    if (meta.role === "provenance") return;
    const { stats } = meta;
    if (stats.nulls === 0) add({ type: "notNull", column: meta.name, severity: "major" });
    if (rowCount > 20 && stats.nulls === 0 && stats.distinct === rowCount && (meta.type === "identifier" || meta.type === "integer" || meta.type === "string")) {
      add({ type: "unique", column: meta.name, severity: "critical" });
    }
    if ((meta.type === "integer" || meta.type === "number") && stats.min !== null && stats.max !== null && stats.max > stats.min) {
      const margin = (stats.max - stats.min) * 0.1;
      const round = (value: number): number => Math.round(value * 1000) / 1000;
      add({ type: "range", column: meta.name, severity: "minor", min: round(stats.min - margin), max: round(stats.max + margin), allowedFailure: 0.005 });
    }
    const categories = meta.categories;
    if (categories !== null && categories.labels.length >= 2 && categories.labels.length <= 20) {
      const covered = categories.counts.reduce((sum, count) => sum + count, 0);
      const populated = rowCount - stats.nulls;
      if (populated > 0 && covered / populated >= 0.99) {
        add({ type: "inList", column: meta.name, severity: "major", values: [...categories.labels], allowedFailure: 0.005 });
      }
    }
  });
  for (const pair of suggestPairs(metas)) {
    add({ type: "compare", column: metas[pair.a].name, other: metas[pair.b].name, operator: "gte", severity: "major" });
  }
  return out;
}

/** column names + types, joined: the same file layout next month gives the same string. */
export function schemaFingerprint(metas: readonly ColumnMeta[]): string {
  const text = metas.map((meta) => `${meta.name}:${meta.type}`).join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${metas.length}-${(hash >>> 0).toString(16)}`;
}

export const RULES_FILE_VERSION = 1;

export interface RulesFile {
  version: number;
  fingerprint: string;
  columns: { name: string; type: string }[];
  rules: Rule[];
}

export function serialiseRules(rules: readonly Rule[], metas: readonly ColumnMeta[]): string {
  const file: RulesFile = {
    version: RULES_FILE_VERSION,
    fingerprint: schemaFingerprint(metas),
    columns: metas.map((meta) => ({ name: meta.name, type: meta.type })),
    rules: rules.map((rule) => {
      const { suggested: _suggested, ...kept } = rule;
      return kept;
    }),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const RULE_TYPES: readonly RuleType[] = ["notNull", "unique", "range", "inList", "regex", "length", "compare"];
const SEVERITIES: readonly RuleSeverity[] = ["critical", "major", "minor"];

/** Reads a rules file; every rule is checked, bad ones are dropped and counted. */
export function parseRulesFile(text: string): { file: RulesFile; dropped: number } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That file is not valid JSON." };
  }
  if (data === null || typeof data !== "object") return { error: "That is not a rules file." };
  const record = data as Record<string, unknown>;
  if (record.version !== RULES_FILE_VERSION) return { error: `Unsupported rules file version (${String(record.version)}).` };
  if (!Array.isArray(record.rules)) return { error: "The rules file has no rules." };
  const rules: Rule[] = [];
  let dropped = 0;
  for (const item of record.rules) {
    const raw = item as Partial<Rule> | null;
    if (
      raw === null ||
      typeof raw !== "object" ||
      typeof raw.column !== "string" ||
      !RULE_TYPES.includes(raw.type as RuleType) ||
      !SEVERITIES.includes(raw.severity as RuleSeverity)
    ) {
      dropped++;
      continue;
    }
    const rule: Rule = {
      id: newRuleId(),
      type: raw.type as RuleType,
      column: raw.column,
      severity: raw.severity as RuleSeverity,
      allowedFailure: typeof raw.allowedFailure === "number" ? raw.allowedFailure : 0,
      ...(typeof raw.min === "number" ? { min: raw.min } : {}),
      ...(typeof raw.max === "number" ? { max: raw.max } : {}),
      ...(Array.isArray(raw.values) ? { values: raw.values.map(String) } : {}),
      ...(typeof raw.pattern === "string" ? { pattern: raw.pattern } : {}),
      ...(typeof raw.other === "string" ? { other: raw.other } : {}),
      ...(raw.operator === "gte" || raw.operator === "gt" || raw.operator === "eq" ? { operator: raw.operator } : {}),
    };
    if (validateRule(rule) !== null) {
      dropped++;
      continue;
    }
    rules.push(rule);
  }
  const columns = Array.isArray(record.columns)
    ? (record.columns as { name?: unknown; type?: unknown }[])
        .filter((c) => typeof c?.name === "string" && typeof c?.type === "string")
        .map((c) => ({ name: String(c.name), type: String(c.type) }))
    : [];
  return {
    file: { version: RULES_FILE_VERSION, fingerprint: typeof record.fingerprint === "string" ? record.fingerprint : "", columns, rules },
    dropped,
  };
}

export interface RuleEmit {
  sodacl: string[];
  dbt: { column: string; test: string }[];
  gx: { expectation_type: string; kwargs: Record<string, unknown> }[];
  dqdl: string[];
  /** Rules with no faithful translation in at least one format, one line each. */
  support: string[];
}

const quote = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;

/** Pipeline-format lines for the rules; anything not expressible goes to `support`. */
export function emitRules(rules: readonly Rule[]): RuleEmit {
  const out: RuleEmit = { sodacl: [], dbt: [], gx: [], dqdl: [], support: [] };
  for (const rule of rules) {
    const name = rule.column;
    const tolerant = rule.allowedFailure > 0;
    const pct = (rule.allowedFailure * 100).toString();
    switch (rule.type) {
      case "notNull":
        out.sodacl.push(tolerant ? `missing_percent(${quote(name)}) <= ${pct}` : `missing_count(${quote(name)}) = 0`);
        out.dbt.push({ column: name, test: "not_null" });
        out.gx.push({ expectation_type: "expect_column_values_to_not_be_null", kwargs: { column: name, ...(tolerant ? { mostly: 1 - rule.allowedFailure } : {}) } });
        out.dqdl.push(tolerant ? `Completeness ${quote(name)} >= ${1 - rule.allowedFailure}` : `IsComplete ${quote(name)}`);
        break;
      case "unique":
        out.sodacl.push(`duplicate_count(${quote(name)}) = 0`);
        out.dbt.push({ column: name, test: "unique" });
        out.gx.push({ expectation_type: "expect_column_values_to_be_unique", kwargs: { column: name } });
        out.dqdl.push(`IsUnique ${quote(name)}`);
        break;
      case "range":
        out.sodacl.push(
          [
            `invalid_count(${quote(name)}) = 0:`,
            ...(rule.min !== undefined ? [`      valid min: ${rule.min}`] : []),
            ...(rule.max !== undefined ? [`      valid max: ${rule.max}`] : []),
          ].join("\n"),
        );
        out.gx.push({ expectation_type: "expect_column_values_to_be_between", kwargs: { column: name, ...(rule.min !== undefined ? { min_value: rule.min } : {}), ...(rule.max !== undefined ? { max_value: rule.max } : {}), ...(tolerant ? { mostly: 1 - rule.allowedFailure } : {}) } });
        out.dqdl.push(`ColumnValues ${quote(name)} between ${rule.min ?? "-inf"} and ${rule.max ?? "inf"}`);
        out.support.push(`${describeRule(rule)}: no dbt built-in; use dbt_utils.accepted_range`);
        break;
      case "inList":
        out.sodacl.push(`invalid_count(${quote(name)}) = 0:\n      valid values: [${(rule.values ?? []).map(quote).join(", ")}]`);
        out.dbt.push({ column: name, test: `accepted_values: {values: [${(rule.values ?? []).map(quote).join(", ")}]}` });
        out.gx.push({ expectation_type: "expect_column_values_to_be_in_set", kwargs: { column: name, value_set: rule.values ?? [], ...(tolerant ? { mostly: 1 - rule.allowedFailure } : {}) } });
        out.dqdl.push(`ColumnValues ${quote(name)} in [${(rule.values ?? []).map(quote).join(", ")}]`);
        break;
      case "regex":
        out.sodacl.push(`invalid_count(${quote(name)}) = 0:\n      valid regex: ${rule.pattern ?? ""}`);
        out.gx.push({ expectation_type: "expect_column_values_to_match_regex", kwargs: { column: name, regex: `^(?:${rule.pattern ?? ""})$` } });
        out.dqdl.push(`ColumnValues ${quote(name)} matches ${quote(rule.pattern ?? "")}`);
        out.support.push(`${describeRule(rule)}: no dbt built-in; use dbt_expectations.expect_column_values_to_match_regex`);
        break;
      case "length":
        out.gx.push({ expectation_type: "expect_column_value_lengths_to_be_between", kwargs: { column: name, ...(rule.min !== undefined ? { min_value: rule.min } : {}), ...(rule.max !== undefined ? { max_value: rule.max } : {}) } });
        out.dqdl.push(`ColumnLength ${quote(name)} between ${rule.min ?? 0} and ${rule.max ?? "inf"}`);
        out.support.push(`${describeRule(rule)}: not translated to SodaCL or dbt`);
        break;
      case "compare":
        out.gx.push({ expectation_type: rule.operator === "eq" ? "expect_column_pair_values_to_be_equal" : "expect_column_pair_values_A_to_be_greater_than_B", kwargs: { column_A: name, column_B: rule.other ?? "", or_equal: rule.operator !== "gt" } });
        out.dqdl.push(`ColumnValues ${quote(name)} ${OPERATOR_SYMBOL[rule.operator ?? "gte"] === "≥" ? ">=" : OPERATOR_SYMBOL[rule.operator ?? "gte"]} ${quote(rule.other ?? "")}`);
        out.support.push(`${describeRule(rule)}: not translated to SodaCL or dbt (needs a custom test)`);
        break;
    }
  }
  return out;
}
