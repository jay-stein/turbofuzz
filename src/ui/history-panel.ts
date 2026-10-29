import { diffSnapshots, type Snapshot } from "../data/history.js";
import { el } from "./dom.js";

export interface HistoryPanelState {
  /** Oldest first; the last entry is the current load. */
  snapshots: readonly Snapshot[];
  enabled: boolean;
}

export interface HistoryPanelActions {
  setEnabled(enabled: boolean): void;
  clear(): void;
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/** A tiny trend line of the overall score. */
function sparkline(points: readonly number[]): SVGElement | null {
  if (points.length < 2) return null;
  const width = 160;
  const height = 36;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((value, i) => `${((i / (points.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 4 - ((value - min) / span) * (height - 8)).toFixed(1)}`);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "qp-spark");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Score over the last ${points.length} loads, from ${points[0].toFixed(1)} to ${points[points.length - 1].toFixed(1)}`);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", coords.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "2");
  svg.append(line);
  return svg;
}

/** The History tab: score trend and what changed since the previous load of this file. */
export function buildHistoryPanel(state: HistoryPanelState, actions: HistoryPanelActions): HTMLElement {
  const root = el("div", { class: "qp-history" });
  root.append(
    el("p", { class: "qp-section-hint" }, [
      "TurboFuzz keeps a small record of each load of a file in this browser only: scores, row counts and the share of each column that is filled. It never stores cell values; category names are kept only for small, non-sensitive columns.",
    ]),
  );
  const toggle = el("input", { type: "checkbox", id: "qp-history-on" }) as HTMLInputElement;
  toggle.checked = state.enabled;
  toggle.addEventListener("change", () => actions.setEnabled(toggle.checked));
  const clear = el("button", { class: "ghost small", type: "button", "data-qp": "clear-history" }, ["Clear history"]);
  clear.addEventListener("click", actions.clear);
  root.append(el("div", { class: "qp-actions" }, [el("label", { for: "qp-history-on" }, [toggle, " Keep history on this device"]), clear]));

  if (!state.enabled) {
    root.append(el("div", { class: "qp-empty-state" }, ["History is off. Nothing is being recorded."]));
    return root;
  }
  const { snapshots } = state;
  if (snapshots.length <= 1) {
    root.append(el("div", { class: "qp-empty-state" }, ["This is the first time TurboFuzz has seen this file. Load it again next time and the changes will show here."]));
    return root;
  }
  const scores = snapshots.map((snapshot) => snapshot.overall).filter((value): value is number => value !== null);
  const trend = sparkline(scores);
  if (trend !== null) root.append(el("div", { class: "qp-trend" }, [el("strong", {}, [`Score over ${snapshots.length} loads`]), trend]));

  const previous = snapshots[snapshots.length - 2];
  const current = snapshots[snapshots.length - 1];
  const diff = diffSnapshots(previous, current);
  const when = new Date(previous.at).toLocaleString();
  root.append(el("h3", { class: "qp-section-title" }, [`Compared with your previous load (${when})`]));
  if (diff.unchanged) {
    root.append(el("div", { class: "qp-empty-state" }, ["Nothing has changed."]));
    return root;
  }
  const rows: string[] = [];
  if (diff.scoreDelta !== null && Math.abs(diff.scoreDelta) >= 0.05) rows.push(`Score ${diff.scoreDelta > 0 ? "up" : "down"} ${Math.abs(diff.scoreDelta).toFixed(1)} points`);
  if (diff.rowDelta !== 0) rows.push(`${diff.rowDelta > 0 ? "+" : "−"}${Math.abs(diff.rowDelta).toLocaleString()} rows (${previous.rowCount.toLocaleString()} → ${current.rowCount.toLocaleString()})`);
  if (diff.added.length > 0) rows.push(`Columns added: ${diff.added.join(", ")}`);
  if (diff.removed.length > 0) rows.push(`Columns removed: ${diff.removed.join(", ")}`);
  for (const change of diff.retyped) rows.push(`“${change.name}” changed type: ${change.from} → ${change.to}`);
  for (const shift of diff.fillShifts) rows.push(`“${shift.name}” is ${pct(shift.to)} filled, was ${pct(shift.from)}`);
  for (const category of diff.newCategories) rows.push(`“${category.name}” has new values: ${category.labels.join(", ")}`);
  const list = el("ul", { class: "qp-diff" });
  for (const row of rows) list.append(el("li", {}, [row]));
  root.append(list);
  return root;
}
