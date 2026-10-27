import type { ColumnMeta } from "../worker/protocol.js";
import { isGroupable, isIdLikeColumn, isNumericType } from "./chart-utils.js";
import type { ChartCardKind } from "./chart-utils.js";

/**
 * What each chart type needs, as roles and slots. One table drives gallery
 * availability, field lists and (later) the recommender and guide. Metadata
 * only: nothing here reads rows.
 */

export type ColumnRole = "id" | "time" | "cat-low" | "cat-mid" | "cat-high" | "measure" | "text";
export type SlotKind = "measure" | "cat" | "time" | "text";

export interface ColumnProfile {
  role: ColumnRole;
  distinct: number;
  /** Few distinct numbers (e.g. 5 discount levels) read as categories but can still be measures. */
  canMeasure: boolean;
  /** A measure with few enough distinct values to group by. */
  canCategory: boolean;
}

export interface Slot {
  name: string;
  kinds: readonly SlotKind[];
  optional: boolean;
}

const slot = (name: string, kinds: SlotKind[], optional = false): Slot => ({ name, kinds, optional });

/** Keyed by the app's own chart kinds; `pivotHeatmap` needs a pivot view and has no table slots. */
export const CHARTS: Record<Exclude<ChartCardKind, "pivotHeatmap">, { label: string; slots: readonly Slot[] }> = {
  kpi: { label: "KPI", slots: [slot("Measure", ["measure"]), slot("Over time", ["time"], true)] },
  histogram: { label: "Histogram", slots: [slot("Values", ["measure"])] },
  box: { label: "Box plot", slots: [slot("Values", ["measure"]), slot("Group by", ["cat"])] },
  density: { label: "Density", slots: [slot("X", ["measure", "time"]), slot("Y", ["measure", "time"])] },
  line: {
    label: "Time series",
    slots: [slot("Date", ["time"]), slot("Value", ["measure"], true), slot("Group by", ["cat"], true)],
  },
  bar: { label: "Count plot", slots: [slot("Category", ["cat"])] },
  barplot: { label: "Barplot", slots: [slot("Category", ["cat"]), slot("Measure", ["measure"])] },
  treemap: { label: "Treemap", slots: [slot("Group by", ["cat", "text"]), slot("Size by", ["measure"], true)] },
  heatmap: { label: "Heatmap", slots: [slot("Rows", ["cat"]), slot("Columns", ["cat"])] },
  scatter: { label: "Scatter", slots: [slot("X", ["measure", "time"]), slot("Y", ["measure", "time"])] },
  bubble: { label: "Bubble", slots: [slot("X", ["measure"]), slot("Y", ["measure"]), slot("Size", ["measure"], true)] },
  correlation: { label: "Correlation", slots: [slot("Columns", ["measure"])] },
  map: { label: "Map", slots: [slot("Longitude", ["measure"]), slot("Latitude", ["measure"])] },
  terms: { label: "Top terms", slots: [slot("Text", ["text"])] },
};

type RegistryKind = keyof typeof CHARTS;
const hasSlots = (kind: ChartCardKind): kind is RegistryKind => kind in CHARTS;

export {
  aggFor,
  hasWord,
  isAdditiveName,
  isBadCategoryName,
  isGoodCategoryName,
  isMoneyName,
  isRateName,
  nameWords,
} from "./chart-names.js";

/* ----------------------------------------------------------------- roles */

export function profileColumn(meta: ColumnMeta, rowCount: number): ColumnProfile {
  const distinct = meta.stats.distinct;
  const base = { distinct, canMeasure: false, canCategory: false };
  if (isIdLikeColumn(meta, rowCount)) return { ...base, role: "id" };
  if (meta.type === "date" || meta.type === "datetime") return { ...base, role: "time" };
  if (isNumericType(meta.type) || meta.type === "duration" || meta.type === "time") {
    const groupable = isGroupable(meta) && distinct >= 2;
    if (groupable && distinct <= 12) return { ...base, role: "cat-low", canMeasure: true };
    return { ...base, role: "measure", canCategory: groupable };
  }
  if (meta.type === "string" && !isGroupable(meta)) return { ...base, role: "text" };
  if (!isGroupable(meta)) return { ...base, role: "text" };
  return { ...base, role: distinct <= 12 ? "cat-low" : distinct <= 30 ? "cat-mid" : "cat-high" };
}

const matches = (kind: SlotKind, p: ColumnProfile): boolean => {
  switch (kind) {
    case "measure":
      return p.role === "measure" || p.canMeasure;
    case "cat":
      return p.role.startsWith("cat") || p.canCategory;
    case "time":
      return p.role === "time";
    case "text":
      return p.role === "text";
  }
};

export type SlotFit = { ok: true } | { ok: false; reason: string };

/** Does one column suit a slot? Unfit columns stay selectable and carry a short reason. */
export function fitSlot(meta: ColumnMeta, rowCount: number, kinds: readonly SlotKind[]): SlotFit {
  const p = profileColumn(meta, rowCount);
  if (p.role === "id") return { ok: false, reason: "looks like an ID" };
  const catOnly = kinds.includes("cat") && !kinds.includes("measure");
  if (catOnly && p.role === "measure") return { ok: false, reason: `${p.distinct} distinct values: too many groups` };
  if (catOnly && p.role === "cat-high") return { ok: false, reason: `${p.distinct} distinct values: many bars` };
  if (kinds.some((kind) => matches(kind, p))) return { ok: true };
  return { ok: false, reason: `${p.role.replace("cat-", "category ")} column` };
}

export interface FieldLists {
  suggested: { index: number }[];
  other: { index: number; reason: string }[];
}

/** Columns for one slot, split into suggested and other (never hidden). */
export function fieldsFor(
  kind: ChartCardKind,
  slotIndex: number,
  columns: readonly ColumnMeta[],
  rowCount: number,
): FieldLists {
  const out: FieldLists = { suggested: [], other: [] };
  const target = hasSlots(kind) ? CHARTS[kind].slots[slotIndex] : undefined;
  if (target === undefined) return out;
  columns.forEach((meta, index) => {
    if (meta.role === "provenance") return;
    const fit = fitSlot(meta, rowCount, target.kinds);
    if (fit.ok) out.suggested.push({ index });
    else out.other.push({ index, reason: fit.reason });
  });
  return out;
}

export interface Availability {
  ok: boolean;
  reason: string;
}

/** Which chart types can be built from these columns, with the reason when not. */
export function availability(
  columns: readonly ColumnMeta[],
  rowCount: number,
): Record<RegistryKind, Availability> {
  const profiles = columns
    .filter((meta) => meta.role !== "provenance")
    .map((meta) => profileColumn(meta, rowCount))
    .filter((p) => p.role !== "id");
  const out = {} as Record<RegistryKind, Availability>;
  for (const kind of Object.keys(CHARTS) as RegistryKind[]) {
    const missing = CHARTS[kind].slots.filter(
      (s) => !s.optional && !profiles.some((p) => s.kinds.some((k) => matches(k, p))),
    );
    out[kind] = missing.length === 0
      ? { ok: true, reason: "" }
      : { ok: false, reason: `needs ${missing.map((s) => s.kinds[0]).join(" + ")} column` };
  }
  return out;
}
