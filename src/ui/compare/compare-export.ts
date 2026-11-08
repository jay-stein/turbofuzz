import type { ChangeTables, Table } from "../../data/compare/export.js";
import type { ShiftReport } from "../../data/compare/shift.js";
import { looksLikeIdName } from "../../data/identifier.js";
import { escapeFormula } from "../../data/formula.js";
import { toDateInputValue } from "../../parse/dates.js";
import { TYPE_LABELS } from "../../types.js";
import { buildXlsx, type Sheet } from "../xlsx-writer.js";
import { describeRun, ignoredName, type ReportInput } from "./compare-report.js";

const nf = new Intl.NumberFormat("en");
const num = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function csvCell(value: string): string {
  const safe = escapeFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A table as CSV: UTF-8 with a BOM so Excel reads accents, CRLF line ends, formula-like cells escaped. */
export function tableCsv(table: Table): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** File-name safe: letters, digits, dot, dash and underscore. */
export function fileStem(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "data";
}

export function exportBaseName(input: ReportInput): string {
  return `compare_${fileStem(input.setup.a.name)}_vs_${fileStem(input.setup.b.name)}`;
}

/** A difference with its sign: +1,234.5, −20, or 0. */
function signed(value: number): string {
  if (Math.abs(value) < 0.005) return "0";
  return `${value > 0 ? "+" : "−"}${num.format(Math.abs(value))}`;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "" : `${((part / whole) * 100).toFixed(1)}%`;
}

/** The headline numbers as label / value lines (the workbook's Summary sheet). */
function summaryRows(input: ReportInput, tables: ChangeTables): string[][] {
  const { report, setup } = input;
  const rows = report.rows;
  const lines: string[][] = [
    ["A (before)", setup.a.name],
    ["B (after)", setup.b.name],
    ["How", describeRun(input)],
    ["Rows in A", nf.format(rows.a)],
    ["Rows in B", nf.format(rows.b)],
    ["Matched", nf.format(rows.matched)],
    ["Identical", `${nf.format(rows.identical)} (${pct(rows.identical, rows.matched)} of matched)`],
    ["Changed", `${nf.format(rows.changed)} (${pct(rows.changed, rows.matched)} of matched)`],
    ["Only in A (removed)", nf.format(rows.onlyA)],
    ["Only in B (added)", nf.format(rows.onlyB)],
  ];
  if (report.duplicateKeys.a + report.duplicateKeys.b > 0) lines.push(["Repeated keys", `${nf.format(report.duplicateKeys.a)} in A, ${nf.format(report.duplicateKeys.b)} in B`]);
  if (report.emptyKeys.a + report.emptyKeys.b > 0) lines.push(["Empty keys", `${nf.format(report.emptyKeys.a)} in A, ${nf.format(report.emptyKeys.b)} in B`]);
  for (const name of report.columns.added) lines.push(["Column added", name]);
  for (const name of report.columns.removed) lines.push(["Column removed", name]);
  for (const pair of report.columns.renamed) lines.push(["Column renamed", `${pair.a} → ${pair.b}`]);
  for (const pair of report.columns.ignored) lines.push(["Column ignored", ignoredName(pair)]);
  for (const change of report.columns.retyped) lines.push(["Column retyped", `${change.name}: ${TYPE_LABELS[change.a]} → ${TYPE_LABELS[change.b]}`]);
  for (const change of report.changes) lines.push([`Changed: ${change.name}`, `${nf.format(change.changed)} rows (${pct(change.changed, rows.matched)})`]);
  if (tables.truncated > 0) lines.push(["Note", `The Changes sheet stops at ${nf.format(tables.changes.rows.length)} lines; ${nf.format(tables.truncated)} more are left out.`]);
  return lines;
}

function shiftRows(shift: ShiftReport): string[][] {
  return shift.columns.map((column) => {
    if (column.kind === "numeric") {
      const format = (v: number): string => (column.family === "date" ? (Number.isFinite(v) ? toDateInputValue(v) : "") : num.format(v));
      return [
        column.name,
        column.family === "date" ? "dates" : "numbers",
        column.level === "none" ? "no real shift" : column.level,
        `PSI ${column.psi.toFixed(3)}${column.smd === null || column.family === "date" ? "" : `; mean ${Math.abs(column.smd) < 0.005 ? "0.00" : `${column.smd > 0 ? "+" : "−"}${Math.abs(column.smd).toFixed(2)}`} SD`}`,
        `mean ${format(column.a.mean)}, median ${format(column.a.median)}`,
        `mean ${format(column.b.mean)}, median ${format(column.b.median)}`,
      ];
    }
    const top = column.values.slice(0, 3);
    return [
      column.name,
      "categories",
      column.level === "none" ? "no real shift" : column.level,
      `Cramér's V ${column.v.toFixed(3)}`,
      top.map((v) => `${v.label} ${(v.a * 100).toFixed(1)}%`).join(", "),
      top.map((v) => `${v.label} ${(v.b * 100).toFixed(1)}%`).join(", "),
    ];
  });
}

/** The workbook: Summary, Changes, Only in A, Only in B and (when computed) Big Picture. */
export async function changesWorkbook(input: ReportInput, tables: ChangeTables, shift: ShiftReport | null): Promise<Uint8Array> {
  const sheets: Sheet[] = [
    { name: "Summary", headers: ["Item", "Value"], rows: summaryRows(input, tables) },
    { name: "Changes", headers: tables.changes.headers, rows: tables.changes.rows },
    { name: "Only in A", headers: tables.onlyA.headers, rows: tables.onlyA.rows },
    { name: "Only in B", headers: tables.onlyB.headers, rows: tables.onlyB.rows },
  ];
  if (shift !== null) {
    sheets.push({ name: "Big Picture", headers: ["column", "kind", "shift", "measure", "A", "B"], rows: shiftRows(shift) });
  }
  return buildXlsx(sheets);
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function htmlTable(headers: readonly string[], rows: readonly (readonly string[])[], numeric: readonly number[] = []): string {
  const th = headers.map((h, i) => `<th${numeric.includes(i) ? ' class="n"' : ""}>${esc(h)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell, i) => `<td${numeric.includes(i) ? ' class="n"' : ""}>${esc(cell)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * The comparison as one self-contained HTML page (no scripts, no links out):
 * the headline counts, key warnings, changes by column with their most
 * common old → new values, column changes, totals and what shifted. It holds
 * counts and summaries, not the rows themselves.
 */
export function reportHtml(input: ReportInput, shift: ShiftReport | null, created: Date = new Date()): string {
  const { report, setup, key } = input;
  const rows = report.rows;
  const title = `${setup.a.name} → ${setup.b.name}`;
  const parts: string[] = [];
  parts.push(`<header><p class="kicker">Comparison report</p><h1>${esc(title)}</h1><p class="dim">${esc(describeRun(input))} · made ${esc(created.toISOString().slice(0, 16).replace("T", " "))} UTC</p></header>`);
  parts.push(
    `<section class="tiles">${[
      ["Identical", nf.format(rows.identical), `${pct(rows.identical, rows.matched)} of matched`],
      ["Changed", nf.format(rows.changed), `${pct(rows.changed, rows.matched)} of matched`],
      ["Only in A (removed)", nf.format(rows.onlyA), "not in B"],
      ["Only in B (added)", nf.format(rows.onlyB), "new in B"],
      ["Rows", `${nf.format(rows.a)} → ${nf.format(rows.b)}`, `${nf.format(rows.matched)} matched`],
    ]
      .map(([label, value, sub]) => `<div class="tile"><span class="dim">${esc(label!)}</span><b>${esc(value!)}</b><span class="dim">${esc(sub!)}</span></div>`)
      .join("")}</section>`,
  );
  const warnings: string[] = [];
  for (const [side, d, e] of [["A", report.duplicateKeys.a, report.emptyKeys.a], ["B", report.duplicateKeys.b, report.emptyKeys.b]] as const) {
    if (d > 0) warnings.push(`${nf.format(d)} rows in ${side} repeat a key; repeats pair in file order.`);
    if (e > 0) warnings.push(`${nf.format(e)} rows in ${side} have no key, so they can't be matched.`);
  }
  if (warnings.length > 0) parts.push(`<section class="warn"><h2>Check the key before trusting the numbers</h2><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></section>`);
  if (key.kind !== "content" && report.changes.length > 0) {
    parts.push(
      `<section><h2>Changes by column</h2>${htmlTable(
        ["Column", "Rows changed", "Share", "Most common changes"],
        report.changes.map((change) => [
          change.name,
          nf.format(change.changed),
          pct(change.changed, rows.matched),
          change.top.map((p) => `${p.from === "" ? "(empty)" : p.from} → ${p.to === "" ? "(empty)" : p.to} ×${nf.format(p.count)}`).join("; "),
        ]),
        [1, 2],
      )}</section>`,
    );
  } else if (key.kind === "content") {
    parts.push(`<section><h2>Changes by column</h2><p class="dim">Rows were matched on their whole content, so a changed row counts as one removed and one added.</p></section>`);
  }
  const schema = [
    ...report.columns.added.map((name) => ["Added", name]),
    ...report.columns.removed.map((name) => ["Removed", name]),
    ...report.columns.renamed.map((pair) => ["Renamed", `${pair.a} → ${pair.b}`]),
    ...report.columns.ignored.map((pair) => ["Ignored", ignoredName(pair)]),
    ...report.columns.retyped.map((c) => ["Retyped", `${c.name}: ${TYPE_LABELS[c.a]} → ${TYPE_LABELS[c.b]}`]),
  ];
  parts.push(`<section><h2>Columns</h2>${schema.length === 0 ? '<p class="dim">The same columns, with the same types, on both sides.</p>' : htmlTable(["Change", "Column"], schema)}</section>`);
  const keyPairs = new Set(key.kind === "pairs" ? key.pairs : []);
  const totals = report.totals.filter((total) => !keyPairs.has(total.pair) && !looksLikeIdName(total.name));
  if (totals.length > 0) {
    parts.push(
      `<section><h2>Totals check (sum)</h2>${htmlTable(
        ["Column", "A, all rows", "B, all rows", "B − A", "A, matched", "B, matched", "B − A, matched"],
        totals.map((t) => [t.name, num.format(t.a.sum), num.format(t.b.sum), signed(t.b.sum - t.a.sum), num.format(t.matched.a), num.format(t.matched.b), signed(t.matched.b - t.matched.a)]),
        [1, 2, 3, 4, 5, 6],
      )}</section>`,
    );
  }
  if (shift !== null) {
    parts.push(
      `<section><h2>Big Picture</h2><p class="dim">A and B compared as whole populations. Numbers: Population Stability Index and the mean difference in standard deviations; categories: Cramér's V. The verdict measures the size of a shift, not its statistical significance.</p>${htmlTable(
        ["Column", "Kind", "Shift", "Measure", "A", "B"],
        shiftRows(shift),
      )}</section>`,
    );
  }
  const style = `
:root{color-scheme:light}body{margin:0;background:#f6f7f9;color:#1c2430;font:14px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 24px}h1{margin:4px 0;font-size:22px}h2{margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#556170}
.kicker{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#556170}.dim{color:#556170}
section{margin-top:22px;padding:16px 18px;background:#fff;border:1px solid #d8dde3;border-radius:10px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;padding:0;background:none;border:none}
.tile{display:flex;flex-direction:column;gap:2px;padding:12px 14px;background:#fff;border:1px solid #d8dde3;border-radius:10px}.tile b{font-size:20px}
.warn{background:#fef3c7;border-color:#fbbf24}.warn h2{color:#7c4a03}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #eceff2;vertical-align:top}th{color:#556170;font-weight:600}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
@media print{body{background:#fff}section{break-inside:avoid}}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(`Comparison: ${title}`)}</title><style>${style}</style></head><body><main>${parts.join("")}<p class="dim" style="margin-top:24px">Made with TurboFuzz, in the browser. This page holds counts and summaries, not the rows themselves.</p></main></body></html>\n`;
}

/** Hands a file to the browser to save. */
export function download(data: BlobPart, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
