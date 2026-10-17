import type { AggregateMessage } from "../worker/protocol.js";
import type { MeasureSpec, ViewDef } from "../data/aggregate.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import { formatMeasure, measureSymbol } from "./views-panel.js";

export interface SlickTableInput {
  datasetName: string;
  sourceRows: number;
  view: ViewDef;
  result: AggregateMessage;
}

function measureLabel(result: AggregateMessage, measure: MeasureSpec, index: number): string {
  const column = result.measureNames[index] ?? "measure";
  return column === "count(*)" ? "Rows" : `${measureSymbol(measure)} ${column}`;
}

/**
 * Publication-style rendering of one aggregate view: a titled table with
 * formatted values, inline bars, a total row and a source note, exportable as
 * a standalone HTML file or a PNG. Render-only — the data never changes.
 */
export function openSlickTable(input: SlickTableInput): void {
  const { result, view } = input;
  const overlay = el("div", { class: "modal-overlay slick-overlay" });
  const modal = el("div", { class: "modal slick-modal" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, [view.name]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const maxima = result.measures.map((values) => {
    let max = 0;
    for (const value of values) {
      if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    }
    return max;
  });

  const table = el("table", { class: "slick-table" });
  const thead = el("thead");
  const headRow = el("tr");
  result.dimensionNames.forEach((name) => headRow.append(el("th", {}, [name])));
  view.measures.forEach((measure, index) =>
    headRow.append(el("th", { class: "slick-num" }, [measureLabel(result, measure, index)])),
  );
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (let row = 0; row < result.groupCount; row++) {
    const tr = el("tr");
    result.dimensionNames.forEach((_, d) => {
      tr.append(el("td", {}, [result.dimensions[d][row]]));
    });
    result.measures.forEach((values, m) => {
      const value = values[row];
      const td = el("td", { class: "slick-num" });
      const max = maxima[m];
      if (Number.isFinite(value) && max > 0) {
        const bar = el("span", { class: "slick-bar" });
        const fill = el("span", { class: "slick-bar-fill" });
        fill.style.width = `${Math.max(1, (Math.abs(value) / max) * 100)}%`;
        bar.append(fill);
        td.append(bar);
      }
      td.append(el("span", { class: "slick-value" }, [formatMeasure(value, view.measures[m])]));
      tr.append(td);
    });
    tbody.append(tr);
  }
  const totalRow = el("tr", { class: "slick-total" });
  result.dimensionNames.forEach((_, d) => totalRow.append(el("td", {}, [d === 0 ? "Total" : ""])));
  result.totals.forEach((value, m) =>
    totalRow.append(el("td", { class: "slick-num" }, [formatMeasure(value, view.measures[m])])),
  );
  tbody.append(totalRow);
  table.append(tbody);
  modal.append(table);

  const note = el("div", { class: "slick-note" }, [
    `Source: ${input.datasetName} · ${result.groupCount.toLocaleString()} groups · ${
      input.sourceRows.toLocaleString()
    } filtered rows · generated ${new Date().toISOString().slice(0, 10)} · TurboFuzz`,
  ]);
  modal.append(note);

  const footer = el("div", { class: "clean-footer" });
  const html = el("button", { class: "ghost", type: "button" }, ["Export HTML"]);
  html.addEventListener("click", () => exportHtml(input, measureLabels(result, view.measures)));
  const png = el("button", { class: "ghost", type: "button" }, ["Export PNG"]);
  png.addEventListener("click", () => exportPng(input, measureLabels(result, view.measures)));
  const close = el("button", { class: "primary", type: "button" }, ["Close"]);
  footer.append(html, png, el("span", { class: "grow" }), close);
  modal.append(footer);

  const dismiss = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") dismiss();
  };
  closeButton.addEventListener("click", dismiss);
  close.addEventListener("click", dismiss);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dismiss();
  });
  document.addEventListener("keydown", onKey);

  overlay.append(modal);
  document.body.append(overlay);
  setupDialog(overlay, view.name);
}

function measureLabels(result: AggregateMessage, measures: readonly MeasureSpec[]): string[] {
  return measures.map((measure, index) => measureLabel(result, measure, index));
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function safeName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "view"
  );
}

function exportHtml(input: SlickTableInput, labels: readonly string[]): void {
  const { result, view } = input;
  const rows = result.labels
    .map((_, row) => {
      const cells = result.dimensionNames
        .map((__, d) => `<td>${escapeHtml(result.dimensions[d][row])}</td>`)
        .join("");
      const measures = view.measures
        .map((measure, m) => `<td class="num">${escapeHtml(formatMeasure(result.measures[m][row], measure))}</td>`)
        .join("");
      return `<tr>${cells}${measures}</tr>`;
    })
    .join("\n");
  const total = [...result.totals]
    .map((value, m) => `<td class="num">${escapeHtml(formatMeasure(value, view.measures[m]))}</td>`)
    .join("");
  const dims = result.dimensionNames.map((name) => `<th>${escapeHtml(name)}</th>`).join("");
  const measures = labels.map((label) => `<th class="num">${escapeHtml(label)}</th>`).join("");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(view.name)}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; color: #1c2430; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  p.sub { color: #62707f; margin: 0 0 18px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #e6eaef; text-align: left; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #62707f; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 700; border-top: 2px solid #c9d2db; }
  footer { margin-top: 16px; color: #62707f; font-size: 12px; }
</style>
</head>
<body>
<h1>${escapeHtml(view.name)}</h1>
<p class="sub">Source: ${escapeHtml(input.datasetName)} · ${result.groupCount.toLocaleString()} groups · ${input.sourceRows.toLocaleString()} filtered rows</p>
<table>
<thead><tr>${dims}${measures}</tr></thead>
<tbody>
${rows}
<tr class="total"><td>Total</td>${"<td></td>".repeat(Math.max(0, result.dimensionNames.length - 1))}${total}</tr>
</tbody>
</table>
<footer>Generated ${new Date().toISOString().slice(0, 10)} · TurboFuzz</footer>
</body>
</html>`;
  download(`${safeName(view.name)}.html`, new Blob([html], { type: "text/html;charset=utf-8" }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportPng(input: SlickTableInput, labels: readonly string[]): void {
  const { result, view } = input;
  const width = 1600;
  const rowHeight = 44;
  const maxRows = 20;
  const rows = Math.min(result.groupCount, maxRows);
  const height = 240 + (rows + 1) * rowHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1c2430";
  ctx.font = "600 34px system-ui, sans-serif";
  ctx.fillText(view.name.slice(0, 60), 60, 80);
  ctx.font = "18px system-ui, sans-serif";
  ctx.fillStyle = "#62707f";
  ctx.fillText(
    `Source: ${input.datasetName} · ${result.groupCount.toLocaleString()} groups · ${input.sourceRows.toLocaleString()} filtered rows`,
    60,
    112,
  );

  const dimCount = result.dimensionNames.length;
  const colCount = dimCount + view.measures.length;
  const tableLeft = 60;
  const tableWidth = width - 120;
  const colWidth = tableWidth / Math.max(1, colCount);
  const headerY = 160;
  const bodyTop = headerY + 20;

  let maxima = result.measures.map((values) => {
    let max = 0;
    for (const value of values) {
      if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    }
    return max;
  });

  ctx.font = "600 15px system-ui, sans-serif";
  result.dimensionNames.forEach((name, d) => {
    ctx.fillStyle = "#62707f";
    ctx.fillText(name.toUpperCase(), tableLeft + d * colWidth, headerY);
  });
  labels.forEach((label, m) => {
    ctx.fillStyle = "#62707f";
    const text = label.toUpperCase();
    const textWidth = ctx.measureText(text).width;
    ctx.fillText(text, tableLeft + (dimCount + m) * colWidth + colWidth - textWidth - 10, headerY);
  });

  for (let row = 0; row < rows; row++) {
    const y = bodyTop + row * rowHeight;
    if (row % 2 === 1) {
      ctx.fillStyle = "#f6f8fa";
      ctx.fillRect(tableLeft, y, tableWidth, rowHeight);
    }
    ctx.fillStyle = "#1c2430";
    ctx.font = "16px system-ui, sans-serif";
    result.dimensions.forEach((values, d) => {
      ctx.fillText(String(values[row]).slice(0, Math.floor(colWidth / 9)), tableLeft + d * colWidth, y + 28);
    });
    view.measures.forEach((measure, m) => {
      const value = result.measures[m][row];
      const max = maxima[m] ?? 0;
      const cellX = tableLeft + (dimCount + m) * colWidth;
      if (Number.isFinite(value) && max > 0) {
        const barWidth = (Math.abs(value) / max) * (colWidth - 20);
        ctx.fillStyle = "rgba(37, 99, 235, 0.25)";
        ctx.fillRect(cellX, y + 2, barWidth, rowHeight - 4);
      }
      ctx.fillStyle = "#1c2430";
      const text = formatMeasure(value, measure);
      const textWidth = ctx.measureText(text).width;
      ctx.fillText(text, cellX + colWidth - textWidth - 10, y + 28);
    });
  }

  const totalY = bodyTop + rows * rowHeight;
  ctx.strokeStyle = "#c9d2db";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tableLeft, totalY);
  ctx.lineTo(tableLeft + tableWidth, totalY);
  ctx.stroke();
  ctx.font = "700 16px system-ui, sans-serif";
  ctx.fillStyle = "#1c2430";
  ctx.fillText("Total", tableLeft, totalY + 28);
  view.measures.forEach((measure, m) => {
    const text = formatMeasure(result.totals[m], measure);
    const cellX = tableLeft + (dimCount + m) * colWidth;
    const textWidth = ctx.measureText(text).width;
    ctx.fillText(text, cellX + colWidth - textWidth - 10, totalY + 28);
  });

  ctx.fillStyle = "#62707f";
  ctx.font = "14px system-ui, sans-serif";
  const truncated =
    result.groupCount > rows ? ` · top ${rows} of ${result.groupCount.toLocaleString()} groups` : "";
  ctx.fillText(
    `Generated ${new Date().toISOString().slice(0, 10)} · TurboFuzz${truncated}`,
    60,
    height - 24,
  );

  canvas.toBlob((blob) => {
    if (blob !== null) download(`${safeName(view.name)}.png`, blob);
  }, "image/png");
}
