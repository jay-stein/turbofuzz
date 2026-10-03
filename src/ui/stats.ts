import { el } from "./dom.js";
import { toDateInputValue } from "../parse/dates.js";
import { TYPE_LABELS } from "../types.js";
import type { StatsMessage } from "../worker/protocol.js";

export interface StatsModal {
  fill(message: StatsMessage): void;
}

const SUMMARY_ITEMS = [
  "Rows",
  "Columns",
  "Duplicate rows",
  "Duplicate groups",
  "Empty rows",
  "Empty cells",
] as const;

export function openStatsModal(title: string): StatsModal {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, [`Stats — ${title}`]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const summary = el("div", { class: "stats-summary" });
  const summaryValues = new Map<string, HTMLElement>();
  for (const label of SUMMARY_ITEMS) {
    const box = el("div", { class: "stat-box" });
    const value = el("div", { class: "stat-value" }, ["…"]);
    box.append(value, el("div", { class: "stat-label" }, [label]));
    summary.append(box);
    summaryValues.set(label, value);
  }
  modal.append(summary);

  const table = el("table", { class: "stats-table" });
  const headRow = el("tr");
  for (const label of ["Column", "Type", "Distinct", "Empty", "Details"]) {
    headRow.append(el("th", {}, [label]));
  }
  table.append(el("thead", {}, [headRow]));
  const tbody = el("tbody");
  const loadingRow = el("tr");
  const loadingCell = el("td", { class: "details" }, ["Computing stats…"]);
  loadingCell.colSpan = 5;
  loadingRow.append(loadingCell);
  tbody.append(loadingRow);
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

  const fill = (message: StatsMessage): void => {
    const stats = message.stats;
    const emptyPct =
      stats.totalCells > 0 ? (stats.totalNullCells / stats.totalCells) * 100 : 0;
    const values: Record<(typeof SUMMARY_ITEMS)[number], string> = {
      Rows: message.rowCount.toLocaleString(),
      Columns: message.columnCount.toLocaleString(),
      "Duplicate rows": stats.duplicateRows.toLocaleString(),
      "Duplicate groups": stats.duplicateGroups.toLocaleString(),
      "Empty rows": stats.emptyRows.toLocaleString(),
      "Empty cells": `${stats.totalNullCells.toLocaleString()} (${emptyPct.toFixed(1)}%)`,
    };
    for (const [label, value] of Object.entries(values)) {
      summaryValues.get(label)!.textContent = value;
    }

    tbody.replaceChildren();
    for (const column of message.columns) {
      const row = el("tr");
      row.append(
        el("td", {}, [column.name]),
        el("td", {}, [TYPE_LABELS[column.type]]),
        el("td", { class: "num" }, [column.distinct.toLocaleString()]),
        el("td", { class: "num" }, [column.nulls.toLocaleString()]),
        el("td", { class: "details", title: describe(column) }, [describe(column)]),
      );
      tbody.append(row);
    }
  };

  return { fill };
}

function describe(column: StatsMessage["columns"][number]): string {
  if (column.type === "date") {
    if (column.min === null || column.max === null) return "—";
    return `${toDateInputValue(column.min)} → ${toDateInputValue(column.max)}`;
  }

  if (column.type === "category" || column.type === "boolean") {
    if (column.topValues === null || column.topValues.length === 0) return "—";
    return column.topValues
      .map((entry) => `${entry.label} ${entry.count.toLocaleString()}`)
      .join(" · ");
  }

  if (column.type === "string" || column.type === "identifier") {
    const parts: string[] = [];
    if (column.topValues !== null && column.topValues.length > 0) {
      parts.push(
        column.topValues
          .map((entry) => `${entry.label} ${entry.count.toLocaleString()}`)
          .join(" · "),
      );
    }
    if (column.avgLength !== null && column.minLength !== null && column.maxLength !== null) {
      parts.push(`len avg ${column.avgLength.toFixed(1)} (${column.minLength}–${column.maxLength})`);
    }
    return parts.length > 0 ? parts.join(" · ") : "—";
  }

  if (column.min === null || column.max === null) return "—";
  const parts = [`min ${format(column.min)}`];
  if (column.median !== null) parts.push(`median ${format(column.median)}`);
  if (column.mean !== null) parts.push(`mean ${format(column.mean)}`);
  if (column.stddev !== null) parts.push(`σ ${format(column.stddev)}`);
  parts.push(`max ${format(column.max)}`);
  return parts.join(" · ");
}

function format(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
