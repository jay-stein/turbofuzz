import { el } from "./dom.js";
import type { ColumnData } from "../data/column.js";
import type { Dataset } from "../data/dataset.js";
import { toDateInputValue } from "../parse/dates.js";
import { TYPE_LABELS } from "../types.js";

export function openStatsModal(dataset: Dataset): void {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, [`Stats — ${dataset.name}`]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const stats = dataset.stats;
  const emptyPct = stats.totalCells > 0 ? (stats.totalNullCells / stats.totalCells) * 100 : 0;
  const summary = el("div", { class: "stats-summary" });
  const items: [string, string][] = [
    ["Rows", dataset.rowCount.toLocaleString()],
    ["Columns", dataset.columnCount.toLocaleString()],
    ["Duplicate rows", stats.duplicateRows.toLocaleString()],
    ["Duplicate groups", stats.duplicateGroups.toLocaleString()],
    ["Empty rows", stats.emptyRows.toLocaleString()],
    ["Empty cells", `${stats.totalNullCells.toLocaleString()} (${emptyPct.toFixed(1)}%)`],
  ];
  for (const [label, value] of items) {
    const box = el("div", { class: "stat-box" });
    box.append(
      el("div", { class: "stat-value" }, [value]),
      el("div", { class: "stat-label" }, [label]),
    );
    summary.append(box);
  }
  modal.append(summary);

  const table = el("table", { class: "stats-table" });
  const headRow = el("tr");
  for (const label of ["Column", "Type", "Distinct", "Empty", "Details"]) {
    headRow.append(el("th", {}, [label]));
  }
  table.append(el("thead", {}, [headRow]));
  const tbody = el("tbody");
  table.append(tbody);
  modal.append(table);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  overlay.append(modal);
  document.body.append(overlay);

  // Fill column details after the modal paints: medians sort a copy of the
  // numeric values and can take a few tens of ms on very large columns.
  requestAnimationFrame(() => {
    for (const column of dataset.columns) {
      const row = el("tr");
      row.append(
        el("td", {}, [column.name]),
        el("td", {}, [TYPE_LABELS[column.type]]),
        el("td", { class: "num" }, [column.stats.distinct.toLocaleString()]),
        el("td", { class: "num" }, [column.stats.nulls.toLocaleString()]),
        el("td", { class: "details" }, [describeColumn(column)]),
      );
      tbody.append(row);
    }
  });
}

function describeColumn(column: ColumnData): string {
  switch (column.type) {
    case "integer":
    case "number":
    case "date":
      return describeNumeric(column);
    case "category":
    case "boolean":
      return describeCategories(column);
    default:
      return describeText(column);
  }
}

function describeNumeric(column: ColumnData): string {
  const stats = column.stats;
  if (stats.min === null || stats.max === null) return "—";
  if (column.type === "date") {
    return `${toDateInputValue(stats.min)} → ${toDateInputValue(stats.max)}`;
  }
  const parts = [`min ${format(stats.min)}`];
  const median = column.median();
  if (median !== null) parts.push(`median ${format(median)}`);
  if (stats.mean !== null) parts.push(`mean ${format(stats.mean)}`);
  if (stats.stddev !== null) parts.push(`σ ${format(stats.stddev)}`);
  parts.push(`max ${format(stats.max)}`);
  return parts.join(" · ");
}

function describeCategories(column: ColumnData): string {
  const categories = column.categories();
  const entries = categories.labels.map((label, index) => ({
    label,
    count: categories.counts[index],
  }));
  entries.sort((a, b) => b.count - a.count);
  return entries
    .slice(0, 4)
    .map((entry) => `${entry.label} ${entry.count.toLocaleString()}`)
    .join(" · ");
}

function describeText(column: ColumnData): string {
  const stats = column.stats;
  if (stats.avgLength === null || stats.minLength === null || stats.maxLength === null) return "—";
  return `length avg ${stats.avgLength.toFixed(1)} (${stats.minLength}–${stats.maxLength})`;
}

function format(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
