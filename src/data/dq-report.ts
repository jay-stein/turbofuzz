import type { DQScore } from "./score.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { emitRules, type Rule } from "./rules.js";
import { provenanceRows, type ReportProvenance } from "./provenance.js";
import type { DQBaseline } from "./dq-baseline.js";

export interface DQReport {
  dataset: string;
  rows: number;
  columns: number;
  generatedAt: string;
  overall: number | null;
  band: string | null;
  dimensions: {
    dimension: string;
    label: string;
    score: number | null;
    weight: number;
    pass: number;
    fail: number;
    na: number;
    note: string | null;
  }[];
  checks: {
    dimension: string;
    label: string;
    detail: string;
    pass: number;
    fail: number;
    na: number;
  }[];
  /** Fields below are only ever added; older readers can ignore them. */
  scoreVersion?: number;
  bandReason?: string | null;
  issues?: ReportIssue[];
  columnTable?: ReportColumn[];
  sensitive?: { name: string; class: string; label: string }[];
  rules?: { text: string; fail: number; compared: number; severity: string }[];
  trend?: { at: string; overall: number | null }[];
  /** Where the numbers came from: the file and its SHA-256, how it was read, what changed since, the score settings, the build. */
  provenance?: ReportProvenance;
  /** The raw load (the file as read, before any step) against the data now, and the score after each step. */
  cleaning?: ReportCleaning;
}

/** One side of the before and after, rounded as the report shows it. */
export interface ReportSnapshot {
  overall: number | null;
  band: string | null;
  rows: number;
  /** Rows failing at least one check; null when not counted. */
  rowsAffected: number | null;
  emptyCells: number;
  duplicateRows: number;
  issues: number;
  dimensions: { dimension: string; label: string; score: number | null }[];
  columns: { name: string; score: number | null; fill: number }[];
}

export interface ReportCleaning {
  before: ReportSnapshot;
  after: ReportSnapshot;
  /** In the order applied; points are the difference from the step before, from the rounded scores. */
  steps: { label: string; overall: number | null; points: number | null }[];
}

export interface ReportIssue {
  severity: string;
  title: string;
  /** Left empty for flagged columns so no value can leak. */
  evidence: string;
  rows: number;
}

export interface ReportColumn {
  name: string;
  type: string;
  score: number | null;
  /** Share of rows populated, 0..1. */
  fill: number;
}

/** Bumped when the scoring rules change in a way that moves scores. */
export const SCORE_VERSION = 4;

/** What the report adds beyond the score. Everything is optional. */
export interface ReportExtras {
  bandReason?: string | null;
  issues?: (ReportIssue & { column: number | null })[];
  columnTable?: (ReportColumn & { column: number })[];
  sensitive?: { name: string; class: string; label: string }[];
  rules?: { text: string; fail: number; compared: number; severity: string }[];
  trend?: { at: number; overall: number | null }[];
  /** Columns flagged as possibly sensitive: their example values are left out. */
  sensitiveColumns?: ReadonlySet<number>;
  provenance?: ReportProvenance;
  cleaning?: { before: DQBaseline; after: DQBaseline; steps: readonly { label: string; overall: number | null }[] };
}

const round1 = (value: number | null): number | null => (value === null ? null : Math.round(value * 10) / 10);

function snapshot(side: DQBaseline): ReportSnapshot {
  return {
    overall: round1(side.overall),
    band: side.band,
    rows: side.rowCount,
    rowsAffected: side.rowsAffected,
    emptyCells: side.emptyCells,
    duplicateRows: side.duplicateRows,
    issues: side.issues,
    dimensions: side.dimensions.map((entry) => ({ dimension: entry.dimension, label: entry.label, score: round1(entry.score) })),
    columns: side.columns.map((column) => ({ name: column.name, score: column.score === null ? null : Math.round(column.score), fill: column.fill })),
  };
}

/** The report's before and after, with each step's points taken from the rounded scores so they add up. */
export function reportCleaning(input: NonNullable<ReportExtras["cleaning"]>): ReportCleaning {
  const before = snapshot(input.before);
  let last = before.overall;
  const steps = input.steps.map((step) => {
    const overall = round1(step.overall);
    const points = last === null || overall === null ? null : Math.round((overall - last) * 10) / 10;
    last = overall ?? last;
    return { label: step.label, overall, points };
  });
  return { before, after: snapshot(input.after), steps };
}

/** Report payload from the current score (pure; no data leaves the browser). */
export function buildDQReport(
  score: DQScore,
  dataset: string,
  rows: number,
  columns: number,
  generatedAt = new Date().toISOString(),
  extras: ReportExtras = {},
): DQReport {
  const hidden = extras.sensitiveColumns ?? new Set<number>();
  return {
    scoreVersion: SCORE_VERSION,
    ...(extras.bandReason !== undefined ? { bandReason: extras.bandReason } : {}),
    ...(extras.issues === undefined
      ? {}
      : {
          issues: extras.issues.map(({ column, ...issue }) =>
            column !== null && hidden.has(column) ? { ...issue, evidence: "" } : issue,
          ),
        }),
    ...(extras.columnTable === undefined
      ? {}
      : { columnTable: extras.columnTable.map(({ column: _column, ...row }) => row) }),
    ...(extras.sensitive === undefined ? {} : { sensitive: extras.sensitive }),
    ...(extras.rules === undefined ? {} : { rules: extras.rules }),
    ...(extras.provenance === undefined ? {} : { provenance: extras.provenance }),
    ...(extras.cleaning === undefined ? {} : { cleaning: reportCleaning(extras.cleaning) }),
    ...(extras.trend === undefined
      ? {}
      : { trend: extras.trend.map((point) => ({ at: new Date(point.at).toISOString(), overall: point.overall })) }),
    dataset,
    rows,
    columns,
    generatedAt,
    overall: score.overall === null ? null : Math.round(score.overall * 10) / 10,
    band: score.band,
    dimensions: score.dimensions.map((dimension) => ({
      dimension: dimension.dimension,
      label: dimension.label,
      score: dimension.score === null ? null : Math.round(dimension.score * 10) / 10,
      weight: dimension.weight,
      pass: dimension.checks.reduce((sum, check) => sum + check.pass, 0),
      fail: dimension.checks.reduce((sum, check) => sum + check.fail, 0),
      na: dimension.checks.reduce((sum, check) => sum + check.na, 0),
      note: dimension.note,
    })),
    checks: score.dimensions.flatMap((dimension) =>
      dimension.checks.map((check) => ({
        dimension: dimension.dimension,
        label: check.label,
        // Details can quote example values; a flagged column shows counts only.
        detail:
          check.column !== null && hidden.has(check.column)
            ? `${check.fail.toLocaleString()} of ${(check.pass + check.fail).toLocaleString()} fail (values hidden: possibly sensitive)`
            : check.detail,
        pass: check.pass,
        fail: check.fail,
        na: check.na,
      })),
    ),
  };
}

export function dqReportMarkdown(report: DQReport): string {
  const lines: string[] = [];
  lines.push(`# Data quality report — ${report.dataset}`);
  lines.push("");
  lines.push(
    `- Rows: ${report.rows.toLocaleString()} · Columns: ${report.columns.toLocaleString()}`,
  );
  lines.push(
    `- Overall quality: ${report.overall === null ? "n/a" : report.overall.toFixed(1)} (${
      report.band ?? "not applicable"
    }) — weighted mean of applicable dimensions, N.A. excluded`,
  );
  lines.push(`- Generated: ${report.generatedAt} · by TurboFuzz (fully offline)`);
  lines.push("");
  if (cleaned(report)) {
    const table = (head: string[], rows: string[][]): void => {
      lines.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`), "");
    };
    lines.push("## Before and after cleaning", "", "Raw load is the file as read, before any step.", "");
    table(["Measure", "Raw load", "After cleaning", "Change"], cleaningSummary(report.cleaning));
    table(["Dimension", "Raw load", "After cleaning", "Change"], cleaningDimensions(report.cleaning));
    lines.push("### Cleaning steps applied", "");
    table(["#", "Step", "Score after", "Points"], cleaningSteps(report.cleaning));
  }
  if (report.provenance !== undefined) {
    lines.push("## Provenance", "");
    for (const [label, value] of provenanceRows(report.provenance)) lines.push(`- ${label}: ${value}`);
    lines.push("");
  }
  lines.push("| Dimension | Score | Weight | Pass | Fail | N.A. |");
  lines.push("|---|---|---|---|---|---|");
  for (const dimension of report.dimensions) {
    lines.push(
      `| ${dimension.label} | ${
        dimension.score === null ? "n/a" : dimension.score.toFixed(1)
      } | ${dimension.weight} | ${dimension.pass.toLocaleString()} | ${dimension.fail.toLocaleString()} | ${dimension.na.toLocaleString()} |`,
    );
  }
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  for (const check of report.checks) {
    lines.push(
      `- ${check.label} — ${check.fail.toLocaleString()} fail · ${check.pass.toLocaleString()} pass${
        check.na > 0 ? ` · ${check.na.toLocaleString()} n/a` : ""
      } (${check.detail})`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

const BAND_WORDS: Record<string, string> = { good: "good", fair: "fair", poor: "needs work" };

/** True when the report carries a before and after worth showing: at least one step since the raw load. */
function cleaned(report: DQReport): report is DQReport & { cleaning: ReportCleaning } {
  return report.cleaning !== undefined && report.cleaning.steps.length > 0;
}

/** Measure, raw load, after cleaning, change: the rows of the before-and-after table. */
export function cleaningSummary(cleaning: ReportCleaning): string[][] {
  const { before, after } = cleaning;
  const count = (value: number | null): string => (value === null ? "n/a" : value.toLocaleString());
  const score = (value: number | null): string => (value === null ? "n/a" : value.toFixed(1));
  const change = (from: number | null, to: number | null, decimals = 0): string => {
    if (from === null || to === null) return "";
    const diff = Math.round((to - from) * 10 ** decimals) / 10 ** decimals;
    return diff === 0 ? "0" : `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(decimals)}`;
  };
  return [
    ["Score", score(before.overall), score(after.overall), change(before.overall, after.overall, 1)],
    ["Band", BAND_WORDS[before.band ?? ""] ?? "not applicable", BAND_WORDS[after.band ?? ""] ?? "not applicable", ""],
    ["Issues to fix or review", count(before.issues), count(after.issues), change(before.issues, after.issues)],
    ["Rows failing a check", count(before.rowsAffected), count(after.rowsAffected), change(before.rowsAffected, after.rowsAffected)],
    ["Empty cells", count(before.emptyCells), count(after.emptyCells), change(before.emptyCells, after.emptyCells)],
    ["Duplicate rows", count(before.duplicateRows), count(after.duplicateRows), change(before.duplicateRows, after.duplicateRows)],
    ["Rows", count(before.rows), count(after.rows), change(before.rows, after.rows)],
    ["Columns", count(before.columns.length), count(after.columns.length), change(before.columns.length, after.columns.length)],
  ];
}

/** Each dimension at load and now. */
export function cleaningDimensions(cleaning: ReportCleaning): string[][] {
  const score = (value: number | null | undefined): string => (value === null || value === undefined ? "n/a" : value.toFixed(1));
  return cleaning.after.dimensions.map((dimension) => {
    const was = cleaning.before.dimensions.find((entry) => entry.dimension === dimension.dimension)?.score ?? null;
    const now = dimension.score;
    const diff = was === null || now === null ? "" : `${now - was >= 0 ? "+" : "−"}${Math.abs(now - was).toFixed(1)}`;
    return [dimension.label, score(was), score(now), diff];
  });
}

/** Step, score after it, points it added. */
export function cleaningSteps(cleaning: ReportCleaning): string[][] {
  return cleaning.steps.map((step, index) => [
    String(index + 1),
    step.label,
    step.overall === null ? "n/a" : step.overall.toFixed(1),
    step.points === null ? "" : `${step.points >= 0 ? "+" : "−"}${Math.abs(step.points).toFixed(1)}`,
  ]);
}

/** A column's filled share and score at load, by name; null for a column added since. */
function atLoad(report: DQReport, name: string): { fill: number; score: number | null } | null {
  return report.cleaning?.before.columns.find((column) => column.name === name) ?? null;
}

const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One self-contained page: no scripts, no external files, print-friendly. It carries
 * the score, top issues, per-column table, sensitive columns (names only), rules and
 * trend, and none of the values behind a flagged column.
 */
export function dqReportHtml(report: DQReport): string {
  const score = report.overall === null ? "n/a" : report.overall.toFixed(1);
  const section = (title: string, body: string): string => (body === "" ? "" : `<section><h2>${esc(title)}</h2>${body}</section>`);
  const table = (head: string[], rows: string[][]): string =>
    rows.length === 0
      ? ""
      : `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`;
  const issues = (report.issues ?? []).slice(0, 12);
  const trend = report.trend ?? [];
  const withLoad = cleaned(report);
  const pct = (fill: number): string => `${Math.round(fill * 100)}%`;
  const parts = [
    withLoad
      ? section(
          "Before and after cleaning",
          `<p class="meta">Raw load is the file as read, before any step. ${report.cleaning.steps.length.toLocaleString()} cleaning ${report.cleaning.steps.length === 1 ? "step" : "steps"} applied since.</p>` +
            table(["Measure", "Raw load", "After cleaning", "Change"], cleaningSummary(report.cleaning)) +
            "<h3>Dimensions</h3>" +
            table(["Dimension", "Raw load", "After cleaning", "Change"], cleaningDimensions(report.cleaning)) +
            "<h3>Cleaning steps applied</h3>" +
            table(["#", "Step", "Score after", "Points"], cleaningSteps(report.cleaning)),
        )
      : "",
    section(
      "Provenance",
      report.provenance === undefined
        ? ""
        : `<table class="prov"><tbody>${provenanceRows(report.provenance)
            .map(([label, value]) => `<tr><th scope="row">${esc(label)}</th><td>${label.startsWith("SHA-256") ? `<code>${esc(value)}</code>` : esc(value)}</td></tr>`)
            .join("")}</tbody></table>`,
    ),
    section(
      "Dimensions",
      table(
        ["Dimension", "Score", "Weight", "Failing", "Passing"],
        report.dimensions.map((d) => [d.label, d.score === null ? "n/a" : d.score.toFixed(1), String(d.weight), d.fail.toLocaleString(), d.pass.toLocaleString()]),
      ),
    ),
    section(
      "Top issues",
      table(
        ["Severity", "Issue", "Rows", "Evidence"],
        issues.map((i) => [i.severity, i.title, i.rows.toLocaleString(), i.evidence]),
      ),
    ),
    section(
      "Columns",
      withLoad
        ? table(
            ["Column", "Type", "Score at load", "Score", "Filled at load", "Filled"],
            (report.columnTable ?? []).map((c) => {
              const load = atLoad(report, c.name);
              return [
                c.name,
                c.type,
                load === null ? "added" : load.score === null ? "n/a" : String(load.score),
                c.score === null ? "n/a" : c.score.toFixed(0),
                load === null ? "added" : pct(load.fill),
                pct(c.fill),
              ];
            }),
          )
        : table(
            ["Column", "Type", "Score", "Filled"],
            (report.columnTable ?? []).map((c) => [c.name, c.type, c.score === null ? "n/a" : c.score.toFixed(0), pct(c.fill)]),
          ),
    ),
    section(
      "Possibly sensitive columns (names only)",
      table(["Column", "Kind", "Suggested handling"], (report.sensitive ?? []).map((c) => [c.name, c.class, c.label])),
    ),
    section(
      "Rules",
      table(["Rule", "Severity", "Failing", "Checked"], (report.rules ?? []).map((r) => [r.text, r.severity, r.fail.toLocaleString(), r.compared.toLocaleString()])),
    ),
    section("Trend", table(["Load", "Score"], trend.map((t) => [new Date(t.at).toLocaleString(), t.overall === null ? "n/a" : t.overall.toFixed(1)]))),
    section(
      "All checks",
      table(
        ["Dimension", "Check", "Fail", "Pass"],
        report.checks.map((c) => [c.dimension, c.label, c.fail.toLocaleString(), c.pass.toLocaleString()]),
      ),
    ),
  ].join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Data quality report - ${esc(report.dataset)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#1b1f24}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #d0d7de;padding-bottom:4px}
.score{font-size:40px;font-weight:700;font-variant-numeric:tabular-nums}.band{font-weight:600;text-transform:capitalize}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f3f4f6}
.meta{color:#57606a}.prov th{width:200px;font-weight:600}.prov code{font:12px ui-monospace,monospace;word-break:break-all}@media print{body{margin:0}section{break-inside:avoid}}
h3{font-size:14px;margin:16px 0 6px}.cmp{display:flex;gap:16px;margin:16px 0 8px}.cmp div{flex:1;border:1px solid #d0d7de;border-radius:6px;padding:10px 14px}.cmp .after{border-color:#1a7f37}.cmp small{display:block;color:#57606a;text-transform:uppercase;letter-spacing:.05em;font-size:12px}.cmp b{font-size:30px;font-variant-numeric:tabular-nums}.up{color:#1a7f37;font-weight:600}
</style></head><body>
<h1>Data quality report: ${esc(report.dataset)}</h1>
<p class="meta">${report.rows.toLocaleString()} rows &middot; ${report.columns.toLocaleString()} columns &middot; generated ${esc(report.generatedAt)} by TurboFuzz, computed in the browser</p>
${
  withLoad
    ? `<div class="cmp"><div><small>Raw load</small><b>${esc(cleaningSummary(report.cleaning)[0]![1]!)}</b> / 100 ${esc(cleaningSummary(report.cleaning)[1]![1]!)}</div><div class="after"><small>After cleaning (${report.cleaning.steps.length.toLocaleString()} ${report.cleaning.steps.length === 1 ? "step" : "steps"})</small><b>${esc(score)}</b> / 100 ${esc(BAND_WORDS[report.band ?? ""] ?? "not applicable")} <span class="${cleaningSummary(report.cleaning)[0]![3]!.startsWith("+") ? "up" : "meta"}">${esc(cleaningSummary(report.cleaning)[0]![3]!)}</span></div></div>${report.bandReason ? `<p class="meta">${esc(report.bandReason)}</p>` : ""}`
    : `<p><span class="score">${esc(score)}</span> / 100 <span class="band">${esc(report.band ?? "not applicable")}</span>${report.bandReason ? ` &mdash; ${esc(report.bandReason)}` : ""}</p>`
}
${parts}
<p class="meta">Score version ${report.scoreVersion ?? SCORE_VERSION}. Flagged columns show counts only; no values from them appear in this file.</p>
</body></html>
`;
}

export function dqReportCsv(report: DQReport): string {
  const rows = [["dimension", "check", "detail", "pass", "fail", "na"].join(",")];
  const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  for (const check of report.checks) {
    rows.push(
      [check.dimension, check.label, check.detail, check.pass, check.fail, check.na]
        .map((value, index) => (index < 3 ? quote(String(value)) : String(value)))
        .join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}

export interface DQEmitters {
  sodacl: string;
  dbt: string;
  gx: string;
  dqdl: string;
  /** What could not be translated faithfully, one line per item. */
  support: string[];
}

const HEADER = "# Generated by TurboFuzz — the discovered clean baseline. Verify before use in a pipeline.";

/**
 * Emits the dataset's *discovered* expectations in pipeline formats (plan
 * §6/§7): complete columns become not-null checks, identifier columns become
 * unique checks, and anything conditional or heuristic lands in the support
 * list rather than being emitted wrong. Nothing leaves the browser.
 */
export function emitDQChecks(
  columns: readonly ColumnMeta[],
  tableName: string,
  userRules: readonly Rule[] = [],
): DQEmitters {
  const complete: string[] = [];
  const unique: string[] = [];
  const support: string[] = [];
  const slug = tableName.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "dataset";

  for (const meta of columns) {
    const nonNull = meta.stats.nulls === 0;
    const identifier = meta.type === "identifier";
    if (nonNull) {
      complete.push(meta.name);
      if (identifier && meta.stats.distinct >= 1) unique.push(meta.name);
    } else {
      support.push(
        `“${meta.name}”: ${meta.stats.nulls.toLocaleString()} empty cells today — emit missing_count("${meta.name}") with a threshold instead of not-null`,
      );
    }
    if ((meta.pattern?.offCount ?? 0) > 0) {
      support.push(
        `“${meta.name}”: dominant format ${meta.pattern?.mask ?? "?"} — regex checks need the pattern written out explicitly`,
      );
    }
    if (meta.suggestions.some((suggestion) => suggestion.kind === "typeConflict")) {
      support.push(`“${meta.name}”: values don't parse as the inferred type — fix the type first`);
    }
  }
  if (columns.length === 0) support.push("No columns loaded.");

  const sodaLines = [HEADER, `checks for ${slug}:`, "  - row_count > 0"];
  for (const name of complete) sodaLines.push(`  - missing_count("${name}") = 0`);
  const emitted = emitRules(userRules);
  for (const line of emitted.sodacl) sodaLines.push(`  - ${line}`);
  const soda = `${sodaLines.join("\n")}\n`;

  const dbtLines = [
    HEADER,
    "models:",
    `  - name: ${slug}`,
    "    columns:",
  ];
  for (const name of complete) {
    dbtLines.push(`      - name: ${name}`);
    dbtLines.push("        data_tests: [not_null]");
  }
  for (const name of unique) {
    dbtLines.push(`      - name: ${name}`);
    dbtLines.push("        data_tests: [unique]");
  }
  for (const entry of emitted.dbt) {
    dbtLines.push(`      - name: ${entry.column}`);
    dbtLines.push(`        data_tests: [${entry.test}]`);
  }
  if (complete.length === 0 && emitted.dbt.length === 0) dbtLines.push("      [] # no complete columns discovered yet");
  const dbt = `${dbtLines.join("\n")}\n`;

  const expectations = [
    ...complete.map((name) => ({
      expectation_type: "expect_column_values_to_not_be_null",
      kwargs: { column: name },
    })),
    ...unique.map((name) => ({
      expectation_type: "expect_column_values_to_be_unique",
      kwargs: { column: name },
    })),
    ...emitted.gx,
  ];
  const gx = `${JSON.stringify({ [slug]: { expectations } }, null, 2)}\n`;

  const rules: string[] = [];
  for (const name of complete) rules.push(`IsComplete "${name}"`);
  for (const name of unique) rules.push(`IsUnique "${name}"`);
  rules.push(...emitted.dqdl);
  support.push(...emitted.support);
  const dqdl = `${HEADER}\nRules=[${rules.join(", ")}]\n`;

  return { sodacl: soda, dbt, gx, dqdl, support };
}
