import type { Finding } from "./findings.js";
import { IMPACT, TITLES, maskToWords, n, plural } from "./dq-copy.js";
import { maskValue } from "./mask-value.js";
import { columnScore, type ColumnScore, type DQScore, type ScoreCheck } from "./score.js";
import { TYPE_LABELS, type ColumnType } from "../types.js";
import type { ColumnMeta } from "../worker/protocol.js";

/**
 * ONE issue list for the Quality page. Scored checks that fail become "fix"
 * issues, advisory findings become "review", and duplicates stay "info". Each issue
 * carries plain evidence, a measurable impact line and, where a safe automatic fix
 * exists, the steps that run it.
 */
export type IssueSeverity = "fix" | "review" | "info";

export type IssueKind =
  | "variants"
  | "placeholders"
  | "unreadable"
  | "offFormat"
  | "dateFormat"
  | "numberSymbols"
  | "outOfRange"
  | "empty"
  | "duplicates"
  | "review"
  | "other";

/** One undoable change an issue's fix performs. Each runs as its own Recipe step. */
export interface FixPreviewLine {
  from: string;
  to: string;
  count: number;
}

export type FixStep =
  | {
      kind: "standardise";
      column: number;
      pairs: [string, string][];
      preview: FixPreviewLine[];
      /** All groups with every spelling, for the one-by-one review. */
      groups?: { spellings: { value: string; count: number }[] }[];
    }
  | { kind: "placeholders"; column: number; tokens: string[]; preview: FixPreviewLine[] }
  | { kind: "convert"; column: number; to: ColumnType }
  | { kind: "dateFormat"; column: number; order: "dmy" | "mdy"; preview: FixPreviewLine[] }
  | { kind: "numberSymbols"; column: number; locale: "dot" | "comma"; preview: FixPreviewLine[] };

export type DistClass = "variant" | "target" | "placeholder" | "neutral";

export interface DistRow {
  label: string;
  count: number;
  cls: DistClass;
}

/** The NOW and AFTER CLEAN groups of a spelling or placeholder issue. */
export interface DistData {
  now: DistRow[];
  after: DistRow[];
}

export interface PageIssue {
  id: string;
  severity: IssueSeverity;
  kind: IssueKind;
  column: number | null;
  columnName: string | null;
  title: string;
  /** One plain evidence line (counts, never raw masks). */
  evidence: string;
  /** One measurable consequence, or null. */
  impact: string | null;
  /** Points the fix would add to the overall score; only for "fix" issues with a real fix. */
  points: number | null;
  /** Up to three example values, masked when the column may be sensitive. */
  examples: string[];
  dist: DistData | null;
  fixes: FixStep[];
  /** Button text for the fix, or null when there is nothing to apply. */
  fixLabel: string | null;
  /** True when the fix only does safe, reversible tidying (spelling, placeholders). */
  batchSafe: boolean;
  check?: ScoreCheck;
  finding?: Finding;
  /** Rows the issue touches (for ordering and the health strip). */
  rows: number;
  /** An empty-cells issue on a column treated as optional (shown as info, never ranked). */
  optional?: boolean;
}

export interface ColumnHealth {
  column: number;
  name: string;
  type: ColumnType;
  /** Rows with a problem that can be fixed. */
  fixRows: number;
  /** Rows worth reviewing (empty, probable codes). */
  reviewRows: number;
  /** Shares of all rows, 0..1: fixable problems, things to review, and the clean rest. */
  fixShare: number;
  reviewShare: number;
  cleanShare: number;
  chips: string[];
  sensitive: boolean;
  /** This column's own score (0-100) and how it was made; null without a score. */
  score?: ColumnScore | null;
}

export interface IssueInputs {
  score: DQScore;
  metas: readonly ColumnMeta[];
  rowCount: number;
  review: readonly Finding[];
  /** Columns the engine flagged (and the user has not dismissed), by index. */
  sensitiveColumns: ReadonlySet<number>;
}

const MAX_DIST_ROWS = 8;

function weightSum(score: DQScore): number {
  return score.dimensions.reduce(
    (sum, d) => sum + (d.score === null || d.weight <= 0 ? 0 : d.weight),
    0,
  );
}

/** Points the overall score gains if every failing cell in `check` is fixed. */
function gain(score: DQScore, check: ScoreCheck, weight: number, total: number): number {
  const applicable = check.pass + check.fail;
  if (applicable === 0 || total <= 0) return 0;
  return (check.fail / applicable) * (weight / total) * 100;
}

function placeholderTokens(meta: ColumnMeta): { label: string; count: number }[] {
  return meta.nullTokens.filter((token) => token.label.trim() !== "" && token.count > 0);
}

function distFor(meta: ColumnMeta): DistData | null {
  const variants = meta.variants ?? null;
  const tokens = placeholderTokens(meta);
  if ((variants === null || variants.minorityRows === 0) && tokens.length === 0) return null;
  const now: DistRow[] = [];
  const after: DistRow[] = [];
  for (const group of variants?.examples ?? []) {
    const [canonical, ...rest] = group.spellings;
    if (canonical === undefined) continue;
    now.push({ label: canonical.value, count: canonical.count, cls: "target" });
    for (const other of rest) now.push({ label: other.value, count: other.count, cls: "variant" });
    after.push({
      label: canonical.value,
      count: group.spellings.reduce((sum, s) => sum + s.count, 0),
      cls: "target",
    });
  }
  now.sort((a, b) => b.count - a.count);
  after.sort((a, b) => b.count - a.count);
  const missing = tokens.reduce((sum, token) => sum + token.count, 0);
  for (const token of tokens) now.push({ label: token.label, count: token.count, cls: "placeholder" });
  if (missing > 0) after.push({ label: "(missing)", count: missing, cls: "placeholder" });
  return { now: now.slice(0, MAX_DIST_ROWS * 2), after };
}

function examplesFor(meta: ColumnMeta, mask: boolean, values: readonly string[]): string[] {
  const shown = values.filter((v) => v.trim() !== "").slice(0, 3);
  return mask ? shown.map(maskValue) : shown;
}

/** Builds the single ranked issue list. */
export function buildIssues(input: IssueInputs): PageIssue[] {
  const { score, metas, rowCount, review, sensitiveColumns } = input;
  const total = weightSum(score);
  const weights = new Map(score.dimensions.map((d) => [d.dimension, d.weight] as const));
  const issues: PageIssue[] = [];
  const handledPlaceholders = new Set<number>();
  const rangeColumns = new Set<number>();

  // --- spelling variants (merged with placeholders in the same column) ---
  for (const dimension of score.dimensions) {
    for (const check of dimension.checks) {
      if (check.fail === 0 || check.column === null) continue;
      const meta = metas[check.column];
      if (meta === undefined) continue;
      const column = check.column;
      const sensitive = sensitiveColumns.has(column);
      const points = gain(score, check, weights.get(dimension.dimension) ?? 0, total);

      if (check.id.startsWith("consistency.variants.")) {
        const variants = meta.variants;
        if (variants === null || variants === undefined) continue;
        const tokens = placeholderTokens(meta);
        const cells = tokens.reduce((sum, token) => sum + token.count, 0);
        const spellings = variants.mappings.length + variants.groups;
        const fixes: FixStep[] = [
          {
            kind: "standardise",
            column,
            pairs: variants.mappings.map((m) => [m.from, m.to] as [string, string]),
            preview: [...variants.mappings].sort((a, b) => b.count - a.count).slice(0, 5),
            ...(variants.detail === undefined ? {} : { groups: variants.detail }),
          },
        ];
        if (cells > 0) {
          fixes.push({
            kind: "placeholders",
            column,
            tokens: tokens.map((t) => t.label),
            preview: tokens.slice(0, 5).map((t) => ({ from: t.label, to: "(empty)", count: t.count })),
          });
          handledPlaceholders.add(column);
        }
        issues.push({
          id: `variants.${column}`,
          severity: "fix",
          kind: "variants",
          column,
          columnName: meta.name,
          title:
            cells > 0
              ? TITLES.variantsAndPlaceholders(meta.name, spellings, variants.groups, cells)
              : TITLES.variants(meta.name, spellings, variants.groups),
          evidence: `${n(variants.minorityRows)} ${plural(variants.minorityRows, "row", "rows")} use a less common spelling${
            cells > 0 ? `, and ${n(cells)} ${plural(cells, "cell holds", "cells hold")} placeholder text` : ""
          }`,
          impact: IMPACT.variants(meta.name, meta.stats.distinct, meta.stats.distinct - variants.mappings.length),
          points,
          examples: [],
          dist: distFor(meta),
          fixes,
          fixLabel: cells > 0 ? "Standardise…" : "Standardise…",
          batchSafe: true,
          check,
          rows: variants.minorityRows + cells,
        });
        continue;
      }

      if (check.id.startsWith("validity.range.")) {
        const range = meta.rangeViolation;
        if (range === null || range === undefined) continue;
        rangeColumns.add(column);
        issues.push({
          id: `range.${column}`,
          severity: "fix",
          kind: "outOfRange",
          column,
          columnName: meta.name,
          title: `“${meta.name}” has ${n(range.count)} ${plural(range.count, "value", "values")} outside ${range.min} to ${range.max}`,
          evidence: `${range.sentence}. Examples: ${range.examples.join(", ")}`,
          impact: `${n(range.count)} ${plural(range.count, "row", "rows")} would distort averages and charts of this column`,
          points,
          examples: range.examples,
          dist: null,
          fixes: [],
          fixLabel: "Show rows",
          batchSafe: false,
          check,
          rows: range.count,
        });
        continue;
      }

      if (check.id.startsWith("validity.symbols.")) {
        const symbols = meta.numberSymbols;
        if (symbols === null || symbols === undefined) continue;
        issues.push({
          id: `symbols.${column}`,
          severity: "fix",
          kind: "numberSymbols",
          column,
          columnName: meta.name,
          title: `“${meta.name}” mixes plain numbers with currency or thousands formatting`,
          evidence: `${n(symbols.withSymbol)} with a symbol or separator (e.g. “${symbols.example}”) · ${n(symbols.plain)} plain`,
          impact: `${n(symbols.withSymbol)} ${plural(symbols.withSymbol, "value", "values")} would stay as text in an export or a join until the symbols are removed`,
          points,
          examples: [symbols.example],
          dist: {
            now: [
              { label: "plain number", count: symbols.plain, cls: "target" },
              { label: "with symbol", count: symbols.withSymbol, cls: "variant" },
            ],
            after: [{ label: "plain number", count: symbols.total, cls: "target" }],
          },
          fixes: [
            {
              kind: "numberSymbols",
              column,
              locale: meta.numberLocale,
              preview: [{ from: symbols.example, to: "plain number", count: symbols.withSymbol }],
            },
          ],
          fixLabel: "Strip symbols…",
          batchSafe: true,
          check,
          rows: symbols.minority,
        });
        continue;
      }

      if (check.id.startsWith("validity.dateformat.")) {
        const formats = meta.dateFormats;
        if (formats === null || formats === undefined) continue;
        const lead = formats.formats[0];
        const rows = formats.minority;
        // Standardising to a date would drop a time of day, so mixed times get no automatic fix.
        const hasTime = formats.formats.some((f) => f.label.includes("hh:mm"));
        const fixable = !formats.ambiguous && !hasTime;
        issues.push({
          id: `dateformat.${column}`,
          severity: fixable ? "fix" : "review",
          kind: "dateFormat",
          column,
          columnName: meta.name,
          title: `“${meta.name}” writes dates ${formats.formats.length} different ways`,
          evidence: !fixable
            ? `${formats.formats.map((f) => `${f.label} ×${n(f.count)}`).join(" · ")}. ${
                formats.ambiguous
                  ? "Day and month order cannot be told apart from the values"
                  : "Some values carry a time of day"
              }, so no automatic fix is offered.`
            : formats.formats.map((f) => `${f.label} ×${n(f.count)}`).join(" · "),
          impact: `${n(rows)} ${plural(rows, "date is", "dates are")} not in ${lead?.label ?? "the main format"}, so sorting and grouping as text will disagree`,
          points: fixable ? points : null,
          examples: formats.formats.slice(0, 3).map((f) => f.example),
          dist: {
            now: formats.formats.map((f, index) => ({
              label: f.label,
              count: f.count,
              cls: index === 0 ? ("target" as const) : ("variant" as const),
            })),
            after: [{ label: "yyyy-mm-dd", count: formats.total, cls: "target" as const }],
          },
          fixes:
            fixable && formats.order !== null
              ? [
                  {
                    kind: "dateFormat",
                    column,
                    order: formats.order,
                    preview: formats.formats.slice(1, 6).map((f) => ({ from: f.example, to: "yyyy-mm-dd", count: f.count })),
                  },
                ]
              : fixable
                ? [
                    {
                      kind: "dateFormat",
                      column,
                      order: "dmy",
                      preview: formats.formats.slice(1, 6).map((f) => ({ from: f.example, to: "yyyy-mm-dd", count: f.count })),
                    },
                  ]
                : [],
          fixLabel: fixable ? "Standardise to yyyy-mm-dd…" : null,
          batchSafe: fixable,
          check,
          rows,
        });
        continue;
      }

      if (check.id.startsWith("validity.") && !check.id.startsWith("validity.downgrade")) {
        const conformance = meta.conformance ?? null;
        const pattern = meta.pattern ?? null;
        if (conformance !== null && conformance.nonConforming > 0 && check.convertTo === undefined && check.fixBlocked === undefined) {
          // Junk inside an intended-type column the user may want to keep as text.
          issues.push({
            id: `unreadable.${column}`,
            severity: "fix",
            kind: "unreadable",
            column,
            columnName: meta.name,
            title: TITLES.unreadable(meta.name, conformance.nonConforming, TYPE_LABELS[conformance.intended]),
            evidence: `${n(conformance.nonConforming)} of ${n(check.pass + check.fail)} values do not parse as ${TYPE_LABELS[conformance.intended]}`,
            impact: IMPACT.unreadable(conformance.nonConforming),
            points,
            examples: examplesFor(meta, sensitive, conformance.examples),
            dist: null,
            fixes: [],
            fixLabel: "Show rows",
            batchSafe: false,
            check,
            rows: conformance.nonConforming,
          });
        } else if (conformance !== null && conformance.nonConforming > 0) {
          const blocked = check.fixBlocked !== undefined;
          issues.push({
            id: `unreadable.${column}`,
            severity: blocked ? "review" : "fix",
            kind: "unreadable",
            column,
            columnName: meta.name,
            title: TITLES.unreadable(meta.name, conformance.nonConforming, TYPE_LABELS[conformance.intended]),
            evidence: blocked
              ? check.fixBlocked ?? ""
              : `${n(conformance.nonConforming)} of ${n(check.pass + check.fail)} values do not parse as ${TYPE_LABELS[conformance.intended]}`,
            impact: IMPACT.unreadable(conformance.nonConforming),
            points: blocked ? null : points,
            examples: examplesFor(meta, sensitive, conformance.examples),
            dist: null,
            fixes: check.convertTo !== undefined ? [{ kind: "convert", column, to: check.convertTo }] : [],
            fixLabel: check.convertTo !== undefined ? `Convert to ${TYPE_LABELS[check.convertTo]}…` : "Show rows",
            batchSafe: false,
            check,
            rows: conformance.nonConforming,
          });
        } else if (pattern !== null && pattern.offCount > 0) {
          issues.push({
            id: `offformat.${column}`,
            severity: "fix",
            kind: "offFormat",
            column,
            columnName: meta.name,
            title: TITLES.offFormat(meta.name, pattern.offCount),
            evidence: `${n(pattern.offCount)} ${plural(pattern.offCount, "value does", "values do")} not follow the usual shape: ${maskToWords(pattern.mask)}`,
            impact: IMPACT.offFormat(pattern.offCount),
            points,
            examples: examplesFor(meta, sensitive, pattern.examples),
            dist: null,
            fixes: [],
            fixLabel: "Show rows",
            batchSafe: false,
            check,
            rows: pattern.offCount,
          });
        } else {
          issues.push({
            id: `validity.${column}`,
            severity: "fix",
            kind: "other",
            column,
            columnName: meta.name,
            title: `“${meta.name}” has ${n(check.fail)} ${plural(check.fail, "value", "values")} that do not fit`,
            evidence: check.detail,
            impact: null,
            points,
            examples: [],
            dist: null,
            fixes: [],
            fixLabel: "Show rows",
            batchSafe: false,
            check,
            rows: check.fail,
          });
        }
        continue;
      }

      if (check.id.startsWith("validity.downgrade")) {
        const blocked = check.fixBlocked !== undefined;
        issues.push({
          id: `downgrade.${column}`,
          severity: blocked ? "review" : "fix",
          kind: "unreadable",
          column,
          columnName: meta.name,
          title: `“${meta.name}” looks like ${check.convertTo === undefined ? "another type" : TYPE_LABELS[check.convertTo]} stored as text`,
          evidence: blocked ? check.fixBlocked ?? "" : check.detail,
          impact: IMPACT.unreadable(check.fail),
          points: blocked ? null : points,
          examples: [],
          dist: null,
          fixes: check.convertTo !== undefined ? [{ kind: "convert", column, to: check.convertTo }] : [],
          fixLabel: check.convertTo !== undefined ? `Convert to ${TYPE_LABELS[check.convertTo]}…` : null,
          batchSafe: false,
          check,
          rows: check.fail,
        });
        continue;
      }
    }
  }

  // --- placeholders stored as text, in columns not already covered above ---
  metas.forEach((meta, column) => {
    if (meta.role === "provenance" || handledPlaceholders.has(column)) return;
    const tokens = placeholderTokens(meta);
    const cells = tokens.reduce((sum, token) => sum + token.count, 0);
    if (cells === 0) return;
    issues.push({
      id: `placeholders.${column}`,
      severity: "fix",
      kind: "placeholders",
      column,
      columnName: meta.name,
      title: TITLES.placeholders(meta.name, cells),
      evidence: tokens
        .slice(0, 4)
        .map((token) => `“${token.label}” ×${n(token.count)}`)
        .join(" · "),
      impact: IMPACT.placeholders(cells, tokens.map((t) => t.label)),
      points: null,
      examples: [],
      dist: distFor(meta),
      fixes: [
        {
          kind: "placeholders",
          column,
          tokens: tokens.map((t) => t.label),
          preview: tokens.slice(0, 5).map((t) => ({ from: t.label, to: "(empty)", count: t.count })),
        },
      ],
      fixLabel: "Convert to empty…",
      batchSafe: true,
      rows: cells,
    });
  });

  // --- truly empty cells (placeholder text is shown above, not here) ---
  metas.forEach((meta, column) => {
    if (meta.role === "provenance") return;
    const emptyCheck = score.dimensions
      .find((d) => d.dimension === "completeness")
      ?.checks.find((c) => c.id === `completeness.${column}`);
    if (emptyCheck === undefined) return;
    const placeholders = placeholderTokens(meta).reduce((sum, token) => sum + token.count, 0);
    const empty = Math.max(0, meta.stats.nulls - placeholders);
    if (empty === 0) return;
    const optional = score.optionalColumns.includes(column);
    issues.push({
      id: `empty.${column}`,
      severity: optional ? "info" : "review",
      kind: "empty",
      column,
      columnName: meta.name,
      title: TITLES.empty(meta.name, empty),
      evidence: `${n(empty)} of ${n(rowCount)} rows have no value in this column`,
      impact: IMPACT.empty(empty, rowCount),
      points: null,
      examples: [],
      dist: null,
      fixes: [],
      fixLabel: "Review empties",
      batchSafe: false,
      check: emptyCheck,
      rows: empty,
      ...(optional ? { optional: true } : {}),
    });
  });

  // --- advisory findings from the shared findings list ---
  for (const finding of review) {
    const column = finding.impact.columns[0] ?? null;
    // An impossible value (age 999) is already a fix item; do not list the sentinel twice.
    if (finding.id.startsWith("sentinel.") && column !== null && rangeColumns.has(column)) continue;
    issues.push({
      id: `review.${finding.id}`,
      severity: "review",
      kind: "review",
      column,
      columnName: column === null ? null : (metas[column]?.name ?? null),
      title: finding.title,
      evidence: finding.evidence.map((entry) => `${entry.metric}: ${entry.value}`).join(" · "),
      impact: finding.id.startsWith("sentinel.") ? IMPACT.placeholderCode(finding.impact.rows) : null,
      points: null,
      examples: [],
      dist: null,
      fixes: [],
      fixLabel: finding.fixLabel ?? null,
      batchSafe: false,
      finding,
      rows: finding.impact.rows,
    });
  }

  // --- exact duplicate rows (info) ---
  const duplicates = score.dimensions
    .find((d) => d.dimension === "uniqueness")
    ?.checks.find((c) => c.id === "uniqueness.rows");
  if (duplicates !== undefined && duplicates.fail > 0) {
    issues.push({
      id: "duplicates",
      severity: "info",
      kind: "duplicates",
      column: null,
      columnName: null,
      title: TITLES.duplicates(duplicates.fail),
      evidence: duplicates.detail,
      impact: IMPACT.duplicates(duplicates.fail),
      points: null,
      examples: [],
      dist: null,
      fixes: [],
      fixLabel: "Show duplicates",
      batchSafe: false,
      check: duplicates,
      rows: duplicates.fail,
    });
  }

  const rank = { fix: 0, review: 1, info: 2 } as const;
  return issues.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (b.points ?? 0) - (a.points ?? 0) ||
      b.rows - a.rows,
  );
}

/** One health card per column, worst first. */
export function buildColumnHealth(
  metas: readonly ColumnMeta[],
  issues: readonly PageIssue[],
  rowCount: number,
  sensitiveColumns: ReadonlySet<number>,
  dqScore?: DQScore,
): ColumnHealth[] {
  const health: ColumnHealth[] = [];
  metas.forEach((meta, column) => {
    if (meta.role === "provenance") return;
    const mine = issues.filter((issue) => issue.column === column);
    const fixRows = Math.min(
      rowCount,
      mine.filter((i) => i.severity === "fix").reduce((sum, i) => sum + i.rows, 0),
    );
    const reviewRows = Math.min(
      Math.max(0, rowCount - fixRows),
      mine.filter((i) => i.severity === "review").reduce((sum, i) => sum + i.rows, 0),
    );
    const populated = Math.max(1, rowCount);
    const chips: string[] = [];
    for (const issue of mine.filter((i) => i.severity !== "info")) {
      const short =
        issue.kind === "variants"
          ? `${n(issue.rows)} variants`
          : issue.kind === "placeholders"
            ? `${n(issue.rows)} blanks`
            : issue.kind === "unreadable"
              ? `${n(issue.rows)} unreadable`
              : issue.kind === "offFormat"
                ? `${n(issue.rows)} odd`
                : issue.kind === "empty"
                  ? `${n(issue.rows)} empty`
                  : `${n(issue.rows)} to review`;
      chips.push(short);
    }
    const sensitive = sensitiveColumns.has(column);
    health.push({
      column,
      name: meta.name,
      type: meta.type,
      fixRows,
      reviewRows,
      fixShare: fixRows / populated,
      reviewShare: reviewRows / populated,
      cleanShare: Math.max(0, 1 - (fixRows + reviewRows) / populated),
      // At most two chips; a sensitivity chip counts toward them.
      chips: chips.slice(0, sensitive ? 1 : 2),
      sensitive,
      score: dqScore === undefined ? null : columnScore(dqScore, column),
    });
  });
  return health.sort(
    (a, b) =>
      b.fixRows / Math.max(1, rowCount) - a.fixRows / Math.max(1, rowCount) ||
      b.reviewRows - a.reviewRows ||
      a.column - b.column,
  );
}
