import type { DistClass, DistData, DistRow } from "../data/dq-issues.js";
import { n } from "../data/dq-copy.js";
import { el } from "./dom.js";

const MAX_ROWS = 8;

/** Screen-reader sentence for one bar, e.g. “ACTIVE: 172 rows, will merge into Active”. */
function barLabel(row: DistRow, side: "now" | "after", target: string | null): string {
  const rows = `${n(row.count)} ${row.count === 1 ? "row" : "rows"}`;
  if (side === "after") {
    return row.cls === "placeholder" ? `${row.label}: ${rows}` : `${row.label}: ${rows} after cleaning`;
  }
  if (row.cls === "variant") return `${row.label}: ${rows}, will merge into ${target ?? "the most common spelling"}`;
  if (row.cls === "placeholder") return `${row.label}: ${rows}, will become empty`;
  return `${row.label}: ${rows}, kept as is`;
}

function group(title: string, rows: readonly DistRow[], side: "now" | "after", target: string | null): HTMLElement {
  const root = el("div", { class: "dist-group" });
  root.append(el("div", { class: "dist-title" }, [title]));
  const max = Math.max(1, ...rows.map((row) => row.count));
  const shown = rows.slice(0, MAX_ROWS);
  for (const row of shown) {
    const bar = el("span", { class: `dist-bar dist-${row.cls}` });
    // Width is data, not styling; it is the only inline style.
    bar.style.width = `${Math.max(2, (row.count / max) * 100)}%`;
    const track = el("span", {
      class: "dist-track",
      role: "img",
      "aria-label": barLabel(row, side, target),
    }, [bar]);
    root.append(
      el("div", { class: "dist-row" }, [
        el("span", { class: "dist-label", title: row.label }, [row.label]),
        track,
        el("span", { class: "dist-count" }, [n(row.count)]),
      ]),
    );
  }
  if (rows.length > shown.length) {
    root.append(el("div", { class: "dist-more" }, [`+${rows.length - shown.length} more`]));
  }
  return root;
}

/**
 * NOW → AFTER CLEAN bars for a spelling or placeholder issue. Pure DOM, no chart
 * library. Variant spellings that will merge are tinted, the kept spelling is the
 * target colour, placeholders are grey; labels and counts carry the meaning too,
 * not colour alone. The AFTER counts come from the same grouping the fix applies.
 */
export function renderDistCompare(data: DistData): HTMLElement {
  const target = data.after.find((row) => row.cls === "target")?.label ?? null;
  return el("div", { class: "dist-compare" }, [
    group("Now", data.now, "now", target),
    el("div", { class: "dist-arrow", "aria-hidden": "true" }, ["→"]),
    group("After cleaning", data.after, "after", target),
  ]);
}

export type { DistClass };
