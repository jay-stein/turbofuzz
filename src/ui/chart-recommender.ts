import {
  aggFor,
  isAdditiveName,
  isBadCategoryName,
  isGoodCategoryName,
  isMoneyName,
  isRateName,
} from "./chart-names.js";

/**
 * Chart recommender: pure, metadata-only (never reads rows, never touches the
 * network). It reads the per-column profile the app already computes at import.
 * Rules follow common chart-selection practice: message first, bars from zero
 * for categories, lines only for ordered data, show the number when one figure
 * is the message.
 */

export type RecType =
  | "number"
  | "integer"
  | "category"
  | "text"
  | "date"
  | "datetime"
  | "time"
  | "boolean"
  | "id";

/** A column as the recommender sees it. `min`/`max` are epoch ms for dates. */
export interface RecColumn {
  name: string;
  type: RecType;
  distinct: number;
  nullPct?: number;
  min?: number | null;
  max?: number | null;
  avgLen?: number;
  ordinal?: boolean;
  /** Position in the dataset, so a pick can be turned back into a column index. */
  index?: number;
}

export type RecRole = "id" | "time" | "cat-low" | "cat-mid" | "cat-high" | "measure" | "text";

export interface RecProfile {
  name: string;
  type: RecType;
  distinct: number;
  nullPct: number;
  role: RecRole;
  col: RecColumn;
  unit?: "year";
  canMeasure?: boolean;
  canCategory?: boolean;
}

/** Recommender ids the app cannot draw yet; the UI hides them until built. */
export const NEW_TYPES: ReadonlySet<string> = new Set<string>();

const RX = {
  lat: /^(lat|latitude)$|_lat$|latitude/i,
  lon: /^(lon|lng|long|longitude)$|_(lon|lng)$|longitude/i,
};

/** Classify one column. */
export function profile(col: RecColumn, nRows: number): RecProfile {
  const d = col.distinct ?? 0;
  const t = col.type;
  const base = { name: col.name, type: t, distinct: d, nullPct: col.nullPct ?? 0, col };
  const nearlyUnique =
    (t === "integer" || t === "text") &&
    nRows > 1 &&
    (d >= nRows || (/(^|_)id$/i.test(col.name) && d >= 0.9 * nRows));
  if (t === "id" || nearlyUnique) return { ...base, role: "id" };
  if (t === "date" || t === "datetime") return { ...base, role: "time" };
  if (
    t === "integer" &&
    /year|yr$/i.test(col.name) &&
    (col.min ?? 0) >= 1900 &&
    (col.max ?? 9999) <= 2100
  ) {
    return { ...base, role: "time", unit: "year" };
  }
  if (t === "boolean") return { ...base, role: "cat-low" };
  if (t === "number" || t === "integer" || t === "time") {
    // Few distinct numbers (e.g. 5 discount levels) read as categories but can still be measures.
    if (d <= 12) return { ...base, role: "cat-low", canMeasure: true };
    return { ...base, role: "measure", canCategory: d <= 30 };
  }
  if (t === "text" && d > 30) return { ...base, role: "text" };
  return { ...base, role: d <= 12 ? "cat-low" : d <= 30 ? "cat-mid" : "cat-high" };
}

const AGG_WORD: Record<string, string> = { sum: "Total", mean: "Average", none: "", count: "Count of" };

/* ------------------------------------------------------------- resolution */

const UNITS: readonly (readonly [string, number])[] = [
  ["minute", 6e4],
  ["hour", 36e5],
  ["day", 864e5],
  ["week", 6048e5],
  ["month", 2629800000],
  ["quarter", 7889400000],
  ["year", 31557600000],
];

/**
 * Smallest time unit giving <= `target` points, but never fewer than `floor`
 * points (falls back to the next smaller unit).
 */
export function autoResolution(spanMs: number, target = 60, floor = 12): string {
  for (let i = 0; i < UNITS.length; i++) {
    const points = spanMs / UNITS[i][1];
    if (points <= target) return points < floor && i > 0 ? UNITS[i - 1][0] : UNITS[i][0];
  }
  return "year";
}

const unitMs = (unit: string): number => UNITS.find(([name]) => name === unit)?.[1] ?? 864e5;
const spanOf = (col: RecColumn): number | null =>
  typeof col.min === "number" && typeof col.max === "number" ? col.max - col.min : null;

/* --------------------------------------------------------------- recommend */

export interface RecOption {
  chart: string;
  rank: "primary" | "alt";
  why: string;
  cfg: Record<string, unknown>;
  warn: string[];
  isNew: boolean;
}

export interface Recommendation {
  options: RecOption[];
  notes: string[];
}

export type Selection = RecColumn | { col: RecColumn; as?: "measure" | "time" | "cat" };

function resolve(selection: readonly Selection[], nRows: number): RecProfile[] {
  return selection.map((entry) => {
    const col = "col" in entry ? entry.col : entry;
    const as = "col" in entry ? entry.as : undefined;
    const p = profile(col, nRows);
    if (as === "measure") p.role = "measure";
    else if (as === "time") p.role = "time";
    else if (as === "cat" && !p.role.startsWith("cat")) {
      p.role = p.distinct <= 12 ? "cat-low" : p.distinct <= 30 ? "cat-mid" : "cat-high";
    }
    return p;
  });
}

/**
 * selection: the columns the user put on the shelf.
 * ctx: rows, and source 'view' when the data is already aggregated (agg = 'none').
 */
export function recommend(
  selection: readonly Selection[],
  ctx: { rows?: number; source?: "table" | "view"; resolution?: string } = {},
): Recommendation {
  const nRows = ctx.rows ?? 0;
  const view = ctx.source === "view";
  const P = resolve(selection, nRows);
  const notes: string[] = [];
  const out: RecOption[] = [];
  const add = (
    chart: string,
    rank: "primary" | "alt",
    why: string,
    cfg: Record<string, unknown> = {},
    warn: string[] = [],
  ): void => {
    out.push({ chart, rank, why, cfg, warn, isNew: NEW_TYPES.has(chart) });
  };

  const ids = P.filter((p) => p.role === "id");
  if (ids.length > 0) {
    notes.push(`${ids.map((i) => i.name).join(", ")} looks like an ID, so it is not charted. Use it only for counts.`);
  }
  const use = P.filter((p) => p.role !== "id");
  if (use.length > 4) notes.push("More than 4 fields makes a chart hard to read. Keep the 2-3 that carry the message.");

  const T = use.filter((p) => p.role === "time");
  const C = use.filter((p) => p.role.startsWith("cat"));
  const M = use.filter((p) => p.role === "measure");
  const X = use.filter((p) => p.role === "text");
  const [t] = T;
  const [c1, c2] = C;
  const [m1, m2] = M;
  const agg = (m: RecProfile): string => (view ? "none" : aggFor(m.name));
  const lead = (m: RecProfile): string => `${AGG_WORD[agg(m)] ?? ""} ${m.name}`.trim();
  const sortFor = (c: RecProfile): string => (c.col.ordinal === true ? "natural" : "value-desc");
  const many = (c: RecProfile): boolean => c.role !== "cat-low";

  if (use.length === 0) return { options: [], notes: notes.length > 0 ? notes : ["Pick one or more fields."] };

  if (X.length > 0 && T.length === 0 && C.length === 0 && M.length === 0) {
    add("topterms", "primary", `Most frequent words in ${X[0].name}.`);
  } else if (M.length === 1 && T.length === 0 && C.length === 0) {
    add("histogram", "primary", `Shows how ${m1.name} is spread: typical values, skew and outliers.`, { bins: "auto" });
    add("boxplot", "alt", `A compact summary of ${m1.name}: median, quartiles and outliers.`);
    add("kpi", "alt", "One headline number, for when the total or average is the message.", { agg: agg(m1) });
  } else if (C.length === 1 && T.length === 0 && M.length === 0) {
    add(
      "countplot",
      "primary",
      `How many rows for each ${c1.name}, largest first.`,
      { sort: sortFor(c1), horizontal: many(c1), topN: many(c1) ? 10 : null, baseline: 0 },
      many(c1) ? [`${c1.distinct} categories: show the top 10 and group the rest as Other.`] : [],
    );
    if (many(c1)) add("treemap", "alt", "Many categories: area shows relative size without a long axis.");
  } else if (C.length === 1 && M.length === 1 && T.length === 0) {
    add(
      "barplot",
      "primary",
      `${lead(m1)} for each ${c1.name}, sorted so the biggest stands out. Bars start at zero.`,
      {
        agg: agg(m1),
        sort: sortFor(c1),
        horizontal: many(c1) || (c1.col.avgLen ?? 0) > 10,
        topN: many(c1) ? 10 : null,
        baseline: 0,
      },
    );
    if (many(c1)) {
      add("dotplot", "alt", "With many categories, dots read lighter than a wall of bars and need no zero baseline.", { agg: agg(m1) });
    }
    if (!view && nRows / Math.max(c1.distinct, 1) >= 20) {
      add("boxplot", "alt", `Shows the spread of ${m1.name} inside each ${c1.name}, not just one number.`);
    }
    if (many(c1) && agg(m1) === "sum") add("treemap", "alt", "Area shows each category's share of the total.", { agg: "sum" });
    if (!many(c1) && agg(m1) === "sum" && c1.distinct >= 3) {
      add("waterfall", "alt", `Shows how each ${c1.name} adds to the running total.`, { agg: "sum" });
    }
  } else if (T.length > 0 && C.length === 0 && M.length <= 1) {
    const span = spanOf(t.col);
    const res = t.unit ?? ctx.resolution ?? (span !== null ? autoResolution(span) : "day");
    const cfg = { resolution: res, agg: m1 ? agg(m1) : "count", measure: m1?.name ?? null };
    add(
      "timeseries",
      "primary",
      m1 ? `${lead(m1)} by ${res}: the line shows the trend.` : `Rows per ${res}: shows when activity happens.`,
      cfg,
    );
    if (m1) {
      add("kpi", "alt", "Headline value with a small trend line.", { agg: cfg.agg, over: t.name, resolution: res });
      if (span !== null && span / unitMs(res) <= 12) {
        add("barplot", "alt", "With 12 or fewer periods, bars make each period easy to read.", { ...cfg, baseline: 0 });
      }
    }
  } else if (T.length > 0 && C.length === 1 && M.length <= 1) {
    const span = spanOf(t.col);
    const res = t.unit ?? (span !== null ? autoResolution(span) : "day");
    const cfg = { resolution: res, agg: m1 ? agg(m1) : "count", measure: m1?.name ?? null, groupBy: c1.name };
    const k = c1.distinct;
    if (k <= 5) {
      add("timeseries", "primary", `One line per ${c1.name} so trends can be compared directly.`, cfg);
      if (k >= 2) add("slopegraph", "alt", `Just the first and last ${res}: who rose, who fell, and by how much.`, cfg);
    }
    else if (k <= 12) {
      add("smallmultiples", "primary", `${k} lines on one chart tangle; give each ${c1.name} its own small panel.`, cfg);
      add("timeseries", "alt", "All lines together. Highlight one and grey the rest.", { ...cfg, highlight: true });
    } else {
      add("timeseries", "primary", `${k} series is too many to read, so this shows the top 5 by total.`, { ...cfg, topN: 5 }, [
        `${k} categories: only the top 5 are drawn.`,
      ]);
    }
  } else if (T.length > 0 && C.length === 0 && M.length >= 2) {
    const ms = M.slice(0, 3);
    add(
      "timeseries",
      "primary",
      `${ms.map((m) => m.name).join(", ")} over time.`,
      { resolution: t.unit ?? "auto", measures: ms.map((m) => m.name) },
      ["If these use different scales, index them to 100 or use small multiples instead of a second axis."],
    );
    add("smallmultiples", "alt", "One panel per measure, each on its own scale.", { measures: ms.map((m) => m.name) });
  } else if (M.length === 2 && T.length === 0 && C.length === 0) {
    if (RX.lat.test(m1.name) && RX.lon.test(m2.name)) {
      add("map", "primary", "Latitude and longitude: plot the points on a map.", { lat: m1.name, lon: m2.name });
    } else if (RX.lat.test(m2.name) && RX.lon.test(m1.name)) {
      add("map", "primary", "Latitude and longitude: plot the points on a map.", { lat: m2.name, lon: m1.name });
    } else if (nRows > 5000) {
      add("density", "primary", `${nRows.toLocaleString("en-US")} points would overplot a scatter, so density shows where they cluster.`, { x: m1.name, y: m2.name });
      add("scatter", "alt", "Individual points, sampled to keep it fast.", { x: m1.name, y: m2.name, sample: 5000 });
    } else {
      add("scatter", "primary", `Each dot is a row: does ${m2.name} rise or fall with ${m1.name}?`, { x: m1.name, y: m2.name });
      add("density", "alt", "Shows where points cluster if they overlap.", { x: m1.name, y: m2.name });
    }
  } else if (M.length === 3 && T.length === 0 && C.length === 0) {
    add("bubble", "primary", `Three measures at once: ${M[0].name} (x), ${M[1].name} (y), ${M[2].name} (size).`, {
      x: M[0].name,
      y: M[1].name,
      size: M[2].name,
    });
    add("scatter", "alt", "Drop the size and keep the two that matter most.", { x: M[0].name, y: M[1].name });
    add("correlation", "alt", "A grid of how strongly each pair moves together.", { columns: M.map((m) => m.name) });
  } else if (M.length >= 4 && T.length === 0 && C.length === 0) {
    add(
      "correlation",
      "primary",
      "With this many measures, start with how strongly each pair moves together.",
      { columns: M.slice(0, 12).map((m) => m.name) },
      M.length > 12 ? [`Showing the first 12 of ${M.length} measures.`] : [],
    );
    add("scatter", "alt", "Then pick one strong pair and look at it directly.", { x: m1.name, y: m2.name });
  } else if (C.length === 2 && T.length === 0 && M.length <= 1) {
    const cfg = { rows: c1.name, columns: c2.name, agg: m1 ? agg(m1) : "count", measure: m1?.name ?? null };
    add("heatmap", "primary", `Where ${c1.name} and ${c2.name} combine most strongly; darker means more.`, cfg);
    if (c2.distinct <= 4) add("barplot", "alt", `Grouped bars: one colour per ${c2.name}.`, { ...cfg, baseline: 0 });
    if (c2.distinct <= 6 && cfg.agg !== "mean") {
      add("stacked100", "alt", `The share of each ${c2.name} within every ${c1.name}.`, cfg);
    }
  } else if (C.length >= 3 && T.length === 0) {
    add(
      "heatmap",
      "primary",
      `Using ${c1.name} and ${c2.name}; a third category is rarely readable.`,
      { rows: c1.name, columns: c2.name, agg: m1 ? agg(m1) : "count", measure: m1?.name ?? null },
      ["Three category fields: filter on the third instead of plotting it."],
    );
  }

  if (out.length === 0) notes.push("No chart fits this combination. Remove a field or change one field's role.");
  return { options: out, notes };
}

/* -------------------------------------------------------------- quick starts */

// Headline-money measures first, then other additive ones, then rates; ties broken by variety, then fewer nulls.
const measureScore = (p: RecProfile): number =>
  (isAdditiveName(p.name) && !isRateName(p.name) ? 2 : 0) +
  (isMoneyName(p.name) ? 1 : 0) +
  (isRateName(p.name) ? 1 : 0) +
  Math.min(p.distinct, 100) / 100 -
  p.nullPct / 100;
const catScore = (p: RecProfile): number =>
  (isGoodCategoryName(p.name) ? 2 : 0) -
  (isBadCategoryName(p.name) ? 2 : 0) +
  (p.distinct >= 3 && p.distinct <= 12 ? 1 : 0) -
  p.nullPct / 50;

export interface QuickStart {
  title: string;
  /** Column names, in the order the recommender saw them. */
  fields: string[];
  /** Matching dataset positions when the columns carried an `index`. */
  indexes: number[];
  chart: string;
  cfg: Record<string, unknown>;
}

/** Up to 3 ready-made starting points (replaces "first measure, first category"). */
export function quickStarts(columns: readonly RecColumn[], nRows: number, { max = 3 } = {}): QuickStart[] {
  const P = columns.map((c) => profile(c, nRows));
  const times = P.filter((p) => p.role === "time").sort((a, b) => b.distinct - a.distinct);
  const measures = P.filter((p) => p.role === "measure" && p.nullPct < 40).sort((a, b) => measureScore(b) - measureScore(a));
  const cats = P.filter((p) => p.role === "cat-low" && !p.canMeasure).sort((a, b) => catScore(b) - catScore(a));
  const catsMid = P.filter((p) => p.role === "cat-mid").sort((a, b) => catScore(b) - catScore(a));
  const cat = cats[0] ?? catsMid[0];
  const m = measures[0];
  const m2 = measures[1];
  const starts: QuickStart[] = [];
  const push = (title: string, fields: RecProfile[]): void => {
    const { options } = recommend(fields.map((f) => f.col), { rows: nRows, source: "table" });
    if (options[0] !== undefined) {
      starts.push({
        title,
        fields: fields.map((f) => f.name),
        indexes: fields.map((f) => f.col.index ?? -1),
        chart: options[0].chart,
        cfg: options[0].cfg,
      });
    }
  };
  const lead = (p: RecProfile): string => `${AGG_WORD[aggFor(p.name)]} ${p.name}`.trim();

  if (times[0] !== undefined && m !== undefined) {
    const span = spanOf(times[0].col);
    const res = times[0].unit ?? (span !== null ? autoResolution(span) : "day");
    push(`${lead(m)} by ${res}`, [times[0], m]);
  } else if (m !== undefined) push(`Distribution of ${m.name}`, [m]);
  if (cat !== undefined && m !== undefined) push(`${lead(m)} by ${cat.name}`, [cat, m]);
  else if (cat !== undefined) push(`Rows by ${cat.name}`, [cat]);
  if (measures.length >= 8) push("Which measures move together", measures.slice(0, 10));
  else if (m !== undefined && m2 !== undefined) push(`${m2.name} vs ${m.name}`, [m, m2]);
  else if (m !== undefined && starts.length < max && times[0] !== undefined) push(`Distribution of ${m.name}`, [m]);
  return starts.slice(0, max);
}

/* -------------------------------------------------------------------- lint */

export interface LintNote {
  level: "warn" | "error";
  msg: string;
}

export interface LintChart {
  type: string;
  cfg?: { agg?: string; baseline?: number; topN?: number | null };
  fields?: readonly RecColumn[];
  categories?: number;
  series?: number;
}

/** Cheap checks on a configured chart; shown as small notes on the card. */
export function lint(chart: LintChart, nRows: number): LintNote[] {
  const w: LintNote[] = [];
  const cfg = chart.cfg ?? {};
  for (const col of chart.fields ?? []) {
    if (cfg.agg === "sum" && isRateName(col.name) && (col.type === "number" || col.type === "integer")) {
      w.push({ level: "warn", msg: `${col.name} looks like a rate or percentage. Summing it rarely makes sense; use Average.` });
    }
  }
  if (["barplot", "countplot", "stacked100"].includes(chart.type) && cfg.baseline !== undefined && cfg.baseline !== 0) {
    w.push({ level: "warn", msg: "Bars must start at zero or their lengths mislead. Consider a dot plot." });
  }
  if (["barplot", "countplot"].includes(chart.type) && (chart.categories ?? 0) > 12 && !cfg.topN) {
    w.push({ level: "warn", msg: `${chart.categories} bars is hard to read. Show the top 10 and group the rest as Other.` });
  }
  if (chart.type === "timeseries" && (chart.series ?? 1) > 5) {
    w.push({ level: "warn", msg: `${chart.series} lines tangle. Use small multiples, or highlight one line and grey the rest.` });
  }
  if (chart.type === "timeseries" && !(chart.fields ?? []).some((c) => profile(c, nRows).role === "time")) {
    w.push({ level: "error", msg: "A line needs an ordered x-axis (a date). Use bars for categories." });
  }
  return w;
}
