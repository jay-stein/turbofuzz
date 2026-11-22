import type { ImputeStrategy } from "../data/transform-ops.js";
import { isNumericLikeType } from "../types.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { MenuItem } from "./menu.js";

/**
 * One way to fill a column's empty cells. `strategy` null means "estimate from similar rows"
 * (KNN), which opens its own dialog. `menu` is the wording in the empty-cells menu (null when
 * the menu leaves it out); `short` is the wording on the Clean page.
 */
export interface FillChoice {
  id: string;
  short: string;
  menu: string | null;
  strategy: ImputeStrategy | null;
  /** Offered on the Clean page. Free text gets no typical value or estimate: that would invent data. */
  clean: boolean;
}

const KNN_TYPES = new Set(["integer", "number", "string", "category", "boolean"]);

/** The fills that suit one column's type, most usual first. Identifiers get none. */
export function fillChoices(meta: ColumnMeta): FillChoice[] {
  if (meta.type === "identifier") return [];
  const above: FillChoice = { id: "forward", short: "Row above", menu: null, strategy: { kind: "forward" }, clean: true };
  const below: FillChoice = { id: "backward", short: "Row below", menu: null, strategy: { kind: "backward" }, clean: true };
  const knn: FillChoice = { id: "knn", short: "Estimate from similar rows (KNN)…", menu: null, strategy: null, clean: true };
  if (isNumericLikeType(meta.type)) {
    return [
      { id: "median", short: "Median", menu: "Fill with median", strategy: { kind: "median" }, clean: true },
      { id: "mean", short: "Mean", menu: "Fill with mean", strategy: { kind: "mean" }, clean: true },
      { id: "zero", short: "0", menu: "Fill with 0", strategy: { kind: "constant", value: "0" }, clean: true },
      above,
      below,
      ...(KNN_TYPES.has(meta.type) ? [knn] : []),
    ];
  }
  if (meta.type === "date" || meta.type === "datetime") {
    return [
      { ...above, menu: "Fill with the previous value" },
      { ...below, menu: "Fill with the next value" },
    ];
  }
  const top = meta.stats.topValues[0]?.label;
  const shortTop = top === undefined ? undefined : top.length > 20 ? `${top.slice(0, 19)}…` : top;
  const free = meta.type === "string";
  return [
    {
      id: "mode",
      short: shortTop === undefined ? "Most common" : `Most common (“${shortTop}”)`,
      menu: shortTop === undefined ? "Fill with the most common value" : `Fill with the most common (“${shortTop}”)`,
      strategy: { kind: "mode" },
      clean: !free,
    },
    { id: "unknown", short: "Unknown", menu: "Fill with “Unknown”", strategy: { kind: "constant", value: "Unknown" }, clean: true },
    above,
    below,
    { ...knn, clean: !free },
  ];
}

export interface FillMenuContext {
  metas: readonly ColumnMeta[];
  confirmFill(columns: number[], strategy: ImputeStrategy, label: string): void;
  /** The full Fill missing transform, on one column. */
  openImpute(column: number | undefined): void;
  openKnn(column: number): void;
}

/**
 * One-click fills for the "empty cells" chip. Each column gets the choices
 * that suit its type (median/mean for numbers, most common value or
 * "Unknown" for text, carry-forward for dates); everything is a recorded
 * `impute` step, so it shows in the Recipe and can be undone. Clean stays
 * available as the last entry for null markers and finer control.
 */
export function fillMenuItems(ctx: FillMenuContext, candidates: number[]): MenuItem[] {
  const items: MenuItem[] = [];
  const ranked = candidates
    .map((index) => ({ index, meta: ctx.metas[index] as ColumnMeta }))
    .filter((entry) => entry.meta !== undefined && entry.meta.stats.nulls > 0)
    .sort((a, b) => b.meta.stats.nulls - a.meta.stats.nulls);
  const numeric: number[] = [];
  const textual: number[] = [];
  for (const { index, meta } of ranked) {
    if (meta.type === "identifier") continue;
    if (isNumericLikeType(meta.type)) numeric.push(index);
    else if (meta.type === "string" || meta.type === "category" || meta.type === "boolean") textual.push(index);
  }
  for (const { index, meta } of ranked.slice(0, 6)) {
    items.push({ label: `${meta.name} · ${meta.stats.nulls.toLocaleString()} empty`, disabled: true, action: () => undefined });
    if (meta.type === "identifier") {
      items.push({ label: "Identifiers shouldn’t be filled — see Fill missing…", action: () => ctx.openImpute(index) });
      continue;
    }
    for (const choice of fillChoices(meta)) {
      const label = choice.menu;
      const strategy = choice.strategy;
      if (label === null || strategy === null) continue;
      items.push({ label, title: `${label} — recorded in the Recipe and can be undone`, action: () => ctx.confirmFill([index], strategy, label) });
    }
  }
  if (ranked.length > 6) {
    items.push({
      label: `${(ranked.length - 6).toLocaleString()} more columns — choose in Fill missing…`,
      action: () => ctx.openImpute(ranked[6]?.index),
    });
  }
  if (numeric.length > 1) {
    items.push({
      label: `Fill all ${numeric.length} numeric columns with median`,
      action: () => ctx.confirmFill(numeric, { kind: "median" }, `Fill ${numeric.length} numeric columns with median`),
    });
  }
  if (textual.length > 1) {
    items.push({
      label: `Fill all ${textual.length} text columns with the most common value`,
      action: () => ctx.confirmFill(textual, { kind: "mode" }, `Fill ${textual.length} text columns with the most common value`),
    });
  }
  const knnTarget = ranked.find((entry) => entry.meta.type !== "identifier" && entry.meta.type !== "date" && entry.meta.type !== "datetime");
  if (knnTarget !== undefined) {
    items.push({
      label: `Fill from similar rows (k nearest neighbours)${ranked.length > 1 ? "…" : ` — “${knnTarget.meta.name}”…`}`,
      title: "Fill empty cells from the most similar rows, on columns you choose, with a test of how well it does",
      action: () => ctx.openKnn(knnTarget.index),
    });
  }
  items.push({
    label: "More fill methods…",
    title: "Most common value, previous/next, a constant, KNN, or fill by group",
    action: () => ctx.openImpute(ranked[0]?.index),
  });
  return items;
}
