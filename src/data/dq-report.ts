import type { DQScore } from "./score.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { emitRules, type Rule } from "./rules.js";

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
export const SCORE_VERSION = 3;

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

export function dqReportJson(report: DQReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
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
  const parts = [
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
      table(
        ["Column", "Type", "Score", "Filled"],
        (report.columnTable ?? []).map((c) => [c.name, c.type, c.score === null ? "n/a" : c.score.toFixed(0), `${Math.round(c.fill * 100)}%`]),
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
.meta{color:#57606a}@media print{body{margin:0}section{break-inside:avoid}}
</style></head><body>
<h1>Data quality report: ${esc(report.dataset)}</h1>
<p class="meta">${report.rows.toLocaleString()} rows &middot; ${report.columns.toLocaleString()} columns &middot; generated ${esc(report.generatedAt)} by TurboFuzz, computed in the browser</p>
<p><span class="score">${esc(score)}</span> / 100 <span class="band">${esc(report.band ?? "not applicable")}</span>${report.bandReason ? ` &mdash; ${esc(report.bandReason)}` : ""}</p>
${parts}
<p class="meta">Score version ${report.scoreVersion ?? SCORE_VERSION}. Flagged columns show counts only; no values from them appear in this file.</p>
</body></html>
`;
}

/** A short plain message for whoever supplies the data, ready to paste into an email. */
export function supplierMessage(report: DQReport): string {
  const issues = (report.issues ?? []).filter((issue) => issue.severity === "fix").slice(0, 8);
  const lines = [`Hi,`, ``, `I ran ${report.dataset} (${report.rows.toLocaleString()} rows) through a data quality check${report.overall === null ? "" : ` and it scored ${report.overall.toFixed(1)} out of 100`}.`];
  if (issues.length === 0) {
    lines.push(``, `Nothing needs fixing on this one.`);
  } else {
    lines.push(``, `These things need fixing at the source:`);
    for (const issue of issues) lines.push(`- ${issue.title} (${issue.rows.toLocaleString()} ${issue.rows === 1 ? "row" : "rows"})`);
    lines.push(``, `I can send the list of affected rows as a CSV if that helps.`);
  }
  lines.push(``, `Thanks`);
  return `${lines.join("\n")}\n`;
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
