import { compareColumns, type DQBaseline } from "../data/dq-baseline.js";
import { n } from "../data/dq-copy.js";
import { el } from "./dom.js";

/** One applied step and the score once it landed. */
export interface ScoreStep {
  label: string;
  overall: number | null;
}

const fmt = (value: number | null): string => (value === null ? "n/a" : value.toFixed(1));

/** Scores as shown, to one decimal, so every difference on the page adds up to the numbers beside it. */
const shown = (value: number | null): number | null => (value === null ? null : Math.round(value * 10) / 10);

const signed = (value: number): string => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;

/** Position on a 50 to 100 scale, where scores live, as a CSS percentage. */
const at = (value: number): number => Math.max(0, Math.min(100, ((value - 50) / 50) * 100));

/** The band as the score gave it (a broken column can cap it below what the number says), in the page's words. */
const BAND_WORDS = { good: "good", fair: "fair", poor: "needs work" } as const;

/**
 * The report's before and after: the raw load (the file as read, before any step) against the
 * data now, as headline scores, counts, a dot per dimension for each side, the score after each
 * step, and the columns cleaning changed most. With no step applied it says so and stops.
 */
export function buildCompareSection(
  before: DQBaseline,
  after: DQBaseline,
  steps: readonly ScoreStep[],
  options: { bandFair: number; bandGood: number; openClean?: () => void },
): HTMLElement {
  const root = el("section", { class: "qc", "aria-labelledby": "qc-title" });
  const head = el("div", { class: "qc-head" }, [
    el("h2", { class: "qc-title", id: "qc-title" }, ["Before and after cleaning"]),
    el("span", { class: "qc-sub" }, [
      steps.length === 0
        ? "Raw load = the file as read. No cleaning step yet, so before and after are the same."
        : `Raw load = the file as read, before any step · ${n(steps.length)} ${steps.length === 1 ? "step" : "steps"} applied since`,
    ]),
  ]);
  root.append(head);
  if (steps.length === 0) {
    if (options.openClean !== undefined) {
      const go = el("button", { class: "ghost small", type: "button" }, ["Start cleaning"]);
      go.addEventListener("click", options.openClean);
      head.append(go);
    }
    return root;
  }

  const score = (label: string, side: DQBaseline, cls: string): HTMLElement =>
    el("div", { class: `qc-score ${cls}` }, [
      el("span", { class: "qc-score-label" }, [label]),
      el("span", { class: "qc-score-row" }, [
        el("span", { class: "qc-score-value" }, [fmt(side.overall)]),
        el("span", { class: `qp-band-chip band-${side.band ?? "na"}` }, [side.band === null ? "not applicable" : BAND_WORDS[side.band]]),
      ]),
    ]);
  const was = shown(before.overall);
  const now = shown(after.overall);
  const delta = was === null || now === null ? null : now - was;
  const pair = (label: string, from: number, to: number, lowerIsBetter = true): HTMLElement => {
    const better = lowerIsBetter ? to < from : to > from;
    return el("div", { class: "qc-tile" }, [
      el("span", { class: "qc-tile-label" }, [label]),
      el("span", { class: `qc-tile-value${from === to ? "" : better ? " better" : " worse"}` }, [`${n(from)} → ${n(to)}`]),
    ]);
  };
  const tiles = el("div", { class: "qc-tiles" }, [
    pair("Issues to fix or review", before.issues, after.issues),
    ...(before.rowsAffected !== null && after.rowsAffected !== null ? [pair("Rows failing a check", before.rowsAffected, after.rowsAffected)] : []),
    pair("Empty cells", before.emptyCells, after.emptyCells),
    pair("Duplicate rows", before.duplicateRows, after.duplicateRows),
    pair("Rows", before.rowCount, after.rowCount, false),
    pair("Columns", before.columns.length, after.columns.length, false),
  ]);
  root.append(
    el("div", { class: "qc-top" }, [
      score("Raw load", before, "qc-before"),
      el("span", { class: `qc-delta${delta !== null && delta < 0 ? " worse" : ""}`, "aria-label": delta === null ? "" : `change ${signed(delta)} points` }, [delta === null ? "" : signed(delta)]),
      score("After cleaning", after, "qc-after"),
      tiles,
    ]),
  );

  const dims = el("div", { class: "qc-panel" }, [
    el("h3", { class: "qp-section-title" }, ["Score by dimension"]),
    el("div", { class: "qc-legend" }, [
      el("span", {}, [el("i", { class: "qc-dot qc-dot-before" }), "Raw load"]),
      el("span", {}, [el("i", { class: "qc-dot qc-dot-after" }), "After cleaning"]),
    ]),
  ]);
  for (const dimension of after.dimensions) {
    const was = before.dimensions.find((entry) => entry.dimension === dimension.dimension)?.score ?? null;
    const now = dimension.score;
    const track = el("span", { class: "qc-track" });
    for (const line of [options.bandFair, options.bandGood]) {
      const mark = el("i", { class: "qc-grid" });
      mark.style.left = `${at(line)}%`;
      track.append(mark);
    }
    if (was !== null && now !== null) {
      const link = el("i", { class: `qc-link${now < was ? " worse" : ""}` });
      link.style.left = `${Math.min(at(was), at(now))}%`;
      link.style.width = `${Math.abs(at(now) - at(was))}%`;
      track.append(link);
    }
    for (const [value, cls] of [[was, "qc-dot-before"], [now, "qc-dot-after"]] as const) {
      if (value === null) continue;
      const dot = el("i", { class: `qc-dot ${cls}` });
      dot.style.left = `${at(value)}%`;
      track.append(dot);
    }
    dims.append(
      el("div", { class: "qc-dim" }, [
        el("span", { class: "qc-dim-label" }, [dimension.label]),
        was === null && now === null ? el("span", { class: "qc-track qc-na" }, ["not scored"]) : track,
        el("span", { class: "qc-dim-value" }, [was === now ? fmt(now) : `${fmt(was)} → ${fmt(now)}`]),
      ]),
    );
  }
  dims.append(el("div", { class: "qc-scale", "aria-hidden": "true" }, [el("span", {}, ["50"]), el("span", {}, [`${options.bandFair} fair`]), el("span", {}, [`${options.bandGood} good`]), el("span", {}, ["100"])]));

  const ledger = el("div", { class: "qc-panel" }, [
    el("h3", { class: "qp-section-title" }, ["How cleaning moved the score"]),
    el("p", { class: "qc-note" }, ["Each step in the order applied, with the points it added. Every step can be undone."]),
  ]);
  const bar = (label: string, from: number, to: number, value: string, cls: string): HTMLElement => {
    const fill = el("i", { class: `qc-bar-fill ${cls}` });
    fill.style.left = `${at(Math.min(from, to))}%`;
    fill.style.width = `${Math.max(0.6, Math.abs(at(to) - at(from)))}%`;
    return el("div", { class: "qc-step" }, [
      el("span", { class: "qc-step-row" }, [el("span", { class: "qc-step-label" }, [label]), el("span", { class: `qc-step-value ${cls}` }, [value])]),
      el("span", { class: "qc-bar" }, [fill]),
    ]);
  };
  if (was !== null) ledger.append(bar("Raw load", 50, was, fmt(was), "qc-total-before"));
  let last = was;
  for (const step of steps) {
    const reached = shown(step.overall);
    if (last !== null && reached !== null) {
      const gain = reached - last;
      ledger.append(bar(step.label, last, reached, signed(gain), gain < 0 ? "qc-down" : "qc-up"));
    }
    last = reached ?? last;
  }
  if (now !== null) ledger.append(bar("After cleaning", 50, now, fmt(now), "qc-total-after"));
  root.append(el("div", { class: "qc-body" }, [dims, ledger]));

  const changed = compareColumns(before.columns, after.columns).filter(
    (row) => row.before === null || row.after === null || row.before.score !== row.after.score || row.before.fill !== row.after.fill,
  );
  if (changed.length > 0) {
    const pct = (fill: number): string => `${Math.round(fill * 100)}%`;
    const score2 = (value: number | null | undefined): string => (value === null || value === undefined ? "n/a" : value.toFixed(0));
    const body = el("tbody");
    for (const row of changed.slice(0, 12)) {
      body.append(
        el("tr", {}, [
          el("th", { scope: "row" }, [row.name]),
          el("td", {}, [row.type]),
          el("td", {}, [row.before === null ? "added" : row.after === null ? `${pct(row.before.fill)} → dropped` : `${pct(row.before.fill)} → ${pct(row.after.fill)}`]),
          el("td", {}, [row.before === null || row.after === null ? score2(row.after?.score ?? row.before?.score) : `${score2(row.before.score)} → ${score2(row.after.score)}`]),
        ]),
      );
    }
    root.append(
      el("div", { class: "qc-panel qc-columns" }, [
        el("h3", { class: "qp-section-title" }, [`Columns cleaning changed${changed.length > 12 ? ` (12 of ${n(changed.length)})` : ""}`]),
        el("div", { class: "qc-table-wrap" }, [
          el("table", { class: "qc-table" }, [
            el("thead", {}, [el("tr", {}, [el("th", { scope: "col" }, ["Column"]), el("th", { scope: "col" }, ["Type"]), el("th", { scope: "col" }, ["Filled"]), el("th", { scope: "col" }, ["Score"])])]),
            body,
          ]),
        ]),
      ]),
    );
  }
  return root;
}
