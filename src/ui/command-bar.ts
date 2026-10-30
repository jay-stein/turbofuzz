import type { ColumnMeta } from "../worker/protocol.js";
import type { DateOrder } from "../parse/dates.js";
import type { NumberLocale } from "../parse/numbers.js";
import type { CleanOp } from "../data/clean-ops.js";
import { autoCombineParts } from "../data/date-combine.js";
import type { HeaderCaseStyle } from "../data/headers.js";
import type { TransformOp } from "../data/transform-ops.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { ColumnType } from "../types.js";
import type { ThemePreference } from "./theme.js";
import type { ViewId } from "./view-tabs.js";
import { openConfirm } from "./dialog.js";
import { el } from "./dom.js";

/** What a typed command means, or a friendly parse error. */
export type ParsedCommand =
  | { kind: "clean"; column: number; op: CleanOp; label: string }
  | { kind: "cleanAll"; op: CleanOp; label: string }
  | { kind: "headerCase"; style: HeaderCaseStyle; label: string }
  | { kind: "keyDuplicates"; columns: number[]; label: string }
  | { kind: "transform"; ops: TransformOp[]; label: string }
  | { kind: "dedupe"; keep: "first" | "last" | "none"; label: string }
  | {
      kind: "prepareTimeSeries";
      dateColumn: number;
      dateOrder: DateOrder;
      valueColumn: number;
      valueLocale: NumberLocale;
      label: string;
    }
  | { kind: "openClean"; column?: number; tab?: "values" | "nulls"; label: string }
  | { kind: "openTransform"; label: string }
  | { kind: "filter"; column: number; filter: ColumnFilter; label: string }
  | { kind: "clearFilters"; label: string }
  | { kind: "sort"; column: number; dir: 1 | -1 | 0; label: string }
  | { kind: "type"; column: number; type: ColumnType; label: string }
  | { kind: "rename"; column: number; name: string; label: string }
  | { kind: "merge"; column: number; label: string }
  | { kind: "chart"; column?: number; label: string }
  | { kind: "openView"; view: ViewId; label: string }
  | { kind: "shuffle"; label: string }
  | { kind: "copy"; label: string }
  | { kind: "tiles"; label: string }
  | { kind: "stats"; label: string }
  | { kind: "recipe"; label: string }
  | { kind: "help"; label: string }
  | { kind: "theme"; preference: ThemePreference; label: string }
  | { kind: "export"; label: string }
  | { kind: "views"; label: string }
  | { kind: "quality"; label: string }
  | { kind: "error"; message: string };

export interface CommandSuggestion {
  /** Text filled into the input when chosen. */
  usage: string;
  /** One-line explanation under the usage. */
  hint: string;
  command: ParsedCommand;
}

const VERBS: readonly { name: string; aliases: readonly string[]; hint: string }[] = [
  { name: "upper", aliases: ["uppercase"], hint: "UPPERCASE a column (or “upper all” for every column)" },
  { name: "lower", aliases: ["lowercase"], hint: "lowercase a column (or “lower all”)" },
  { name: "title", aliases: ["titlecase"], hint: "Title Case a column (or “title all”)" },
  { name: "trim", aliases: ["strip"], hint: "Trim whitespace (or “trim all”)" },
  { name: "snakecase", aliases: ["snake case", "snake"], hint: "Snake_case every column name" },
  { name: "camelcase", aliases: ["camel case", "camel"], hint: "camelCase every column name" },
  {
    name: "keydup",
    aliases: ["duplicate key", "key duplicates"],
    hint: "Duplicate rows on a key — “keydup order_id, customer_id”",
  },
  { name: "number", aliases: ["tonumber", "convert number"], hint: "Convert a column to numbers" },
  { name: "date", aliases: ["todate", "convert date"], hint: "Convert a column to dates (date only)" },
  {
    name: "datetime",
    aliases: ["todatetime", "convert datetime", "convert date time"],
    hint: "Convert a column to date & time (keeps the clock)",
  },
  { name: "escape", aliases: ["escape formulas"], hint: "Escape formula-like cells" },
  { name: "round", aliases: [], hint: "Round a column to N decimals" },
  { name: "fill", aliases: ["impute"], hint: "Fill missing values (mean/median/mode/constant)" },
  { name: "split", aliases: [], hint: "Split a column on a delimiter" },
  { name: "group", aliases: ["aggregate", "groupby", "group by"], hint: "Aggregate rows into a dataset" },
  { name: "dedupe", aliases: ["deduplicate"], hint: "Remove duplicate rows (keep first)" },
  { name: "drop", aliases: [], hint: "Delete a column" },
  { name: "clean", aliases: ["clean values"], hint: "Open the Clean panel" },
  { name: "nulls", aliases: ["missing"], hint: "Open the missing-value review" },
  { name: "transform", aliases: [], hint: "Open the Transform panel" },
  { name: "export", aliases: ["download"], hint: "Open the Export dialog" },
  { name: "views", aliases: ["view", "pivot", "pivot view", "aggregate view"], hint: "Open Pivot View" },
  {
    name: "quality",
    aliases: ["score", "dq", "data quality"],
    hint: "Open the data-quality breakdown",
  },
  {
    name: "forecast",
    aliases: ["series", "decompose", "seasonality", "trend"],
    hint: "Open Time Series: trend, season, forecast and typical day or week",
  },
  {
    name: "map",
    aliases: ["maps", "markers", "geo"],
    hint: "Open the Map: points on a world map, your own offline map picture and markers",
  },
  {
    name: "timeseries",
    aliases: ["time series", "prepare time series"],
    hint: "One step: parse the date and measure, ready for sorting, filtering and charting",
  },
  {
    name: "melt",
    aliases: ["unpivot", "wide to long"],
    hint: "Melt columns into variable/value rows — “melt” or “melt keep region, year”",
  },
  {
    name: "combine",
    aliases: ["combine dates", "combine date"],
    hint: "Combine split date/time columns into one sortable date or datetime",
  },
  {
    name: "knn",
    aliases: ["knn impute"],
    hint: "Fill a numeric column from its nearest complete numeric rows — “knn amount 5”",
  },
  {
    name: "splitregex",
    aliases: ["split regex"],
    hint: "Split a column on a regular expression — “splitregex notes on \\d+”",
  },
  { name: "repair", aliases: ["repair decimals"], hint: "Repair mixed decimal conventions in a numeric column" },
  {
    name: "replace",
    aliases: [],
    hint: "Find and replace text — “replace notes \"old\" with \"new\"”",
  },
  { name: "type", aliases: ["cast"], hint: "Change a column's type — “type amount number”" },
  { name: "rename", aliases: [], hint: "Rename a column — “rename notes memo”" },
  { name: "sort", aliases: ["order"], hint: "Sort rows — “sort amount desc” or “sort none”" },
  {
    name: "filter",
    aliases: ["where"],
    hint: "Filter rows — “filter region active”, “filter amount 10..20” or “filter notes exact refund”",
  },
  {
    name: "winsorize",
    aliases: ["winsorise", "clip outliers"],
    hint: "Clamp extreme values at a percentile — “winsorize amount 1”",
  },
  {
    name: "flag",
    aliases: ["flag outliers"],
    hint: "Add a Yes/No outlier column — “flag amount”",
  },
  { name: "clear", aliases: ["clear filters", "reset filters"], hint: "Clear every active filter" },
  { name: "merge", aliases: ["merge similar"], hint: "Open the near-duplicate merge tool for a category column" },
  { name: "chart", aliases: ["plot"], hint: "Open Chart, or add a chart for a column — “chart region”" },
  { name: "table", aliases: [], hint: "Open the Table lens" },
  { name: "overview", aliases: [], hint: "Open the Overview lens" },
  {
    name: "outliers",
    aliases: ["outlier", "anomalies"],
    hint: "Open the Outliers lens - anomaly landscape and method agreement",
  },
  {
    name: "relationships",
    aliases: ["correlations", "associations", "network"],
    hint: "Open the Relationships lens - text-aware column network, correlations, associations and dependencies",
  },
  { name: "shuffle", aliases: ["randomise", "randomize"], hint: "Show every row in a random order" },
  { name: "copy", aliases: ["copy rows"], hint: "Copy the filtered rows as CSV" },
  { name: "tiles", aliases: ["info tiles"], hint: "Toggle the column summary strip above the table" },
  { name: "dropempty", aliases: ["drop empty columns", "remove empty columns"], hint: "Drop columns that are empty in every row" },
  { name: "headercase", aliases: ["header case", "headers"], hint: "Normalise column names — “headercase snake”" },
  { name: "stats", aliases: ["statistics"], hint: "Open the full Stats Report" },
  { name: "recipe", aliases: ["steps", "undo"], hint: "Open Recipe to inspect, undo or reuse applied steps" },
  { name: "help", aliases: ["guide"], hint: "Open the in-app help guide" },
  { name: "theme", aliases: [], hint: "Set the theme — “theme dark”, “theme light” or “theme auto”" },
];

function normalise(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Best column match for the remaining query, by name prefix/contains. */
function findColumn(text: string, columns: readonly ColumnMeta[]): number {
  const needle = normalise(text);
  if (needle === "") return -1;
  let best = -1;
  let bestScore = -1;
  columns.forEach((column, index) => {
    const name = normalise(column.name);
    let score = -1;
    if (name === needle) score = 100;
    else if (name.startsWith(needle)) score = 80 - name.length * 0.01;
    else if (name.includes(needle)) score = 60 - name.length * 0.01;
    else if (needle.split(" ").every((part) => name.includes(part))) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return bestScore >= 40 ? best : -1;
}

/** Verbs that take a column argument. */
const ALL_VERBS = new Set(["upper", "lower", "title", "trim"]);

const COLUMN_VERBS = new Set([
  "upper",
  "lower",
  "title",
  "trim",
  "number",
  "date",
  "datetime",
  "escape",
  "round",
  "fill",
  "split",
  "splitregex",
  "drop",
  "repair",
  "replace",
  "type",
  "rename",
  "sort",
  "filter",
  "merge",
  "chart",
  "knn",
  "winsorize",
  "flag",
]);

/** Splits a command tail into the longest matching column prefix and its args. */
function splitColumnPrefix(
  text: string,
  columns: readonly ColumnMeta[],
): { index: number; rest: string; name: string } | null {
  const words = text.trim().split(" ").filter((word) => word !== "");
  for (let take = words.length; take >= 1; take--) {
    const candidate = words.slice(0, take).join(" ");
    const index = findColumn(candidate, columns);
    if (index >= 0) {
      return {
        index,
        rest: words.slice(take).join(" "),
        name: columns[index]?.name ?? candidate,
      };
    }
  }
  return null;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** The longest verb (name or alias) matched at the start of the input. */
function longestVerbPrefix(input: string): { verb: string; length: number } | null {
  const text = normalise(input);
  let best: { verb: string; length: number } | null = null;
  for (const entry of VERBS) {
    for (const candidate of [entry.name, ...entry.aliases]) {
      const form = normalise(candidate);
      if (text === form || text.startsWith(`${form} `)) {
        if (best === null || form.length > best.length) {
          best = { verb: entry.name, length: form.length };
        }
      }
    }
  }
  return best;
}

/** Does this verb apply to this column? Drives examples and completions. */
function columnFitsVerb(verb: string, meta: ColumnMeta): boolean {
  const numeric = meta.type === "integer" || meta.type === "number";
  const textish = meta.type === "string" || meta.type === "category" || meta.type === "identifier";
  const dateish = meta.type === "date" || meta.type === "datetime";
  switch (verb) {
    case "number":
    case "round":
    case "repair":
    case "knn":
    case "winsorize":
    case "flag":
      return numeric;
    case "date":
    case "datetime":
      // Date conversion applies to real dates and to any text column the user
      // knows holds dates (the whole point of converting).
      return dateish || textish;
    case "upper":
    case "lower":
    case "title":
    case "trim":
    case "split":
    case "splitregex":
    case "escape":
    case "replace":
      return textish;
    case "merge":
      return meta.type === "category";
    default:
      return true;
  }
}

function columnMatchScore(name: string, rest: string): number {
  if (rest === "") return 1;
  if (name === rest) return 100;
  if (name.startsWith(rest)) return 80 - name.length * 0.01;
  if (name.includes(rest)) return 60;
  if (rest.split(" ").every((part) => name.includes(part))) return 40;
  return -1;
}

/**
 * Live input state for the palette: "verb" when a verb is recognised but the
 * command is incomplete (shown light blue), "ready" when the full command
 * parses (bold blue), "empty" otherwise.
 */
export function commandState(
  input: string,
  columns: readonly ColumnMeta[],
): "empty" | "verb" | "ready" {
  const text = input.trim();
  if (text === "") return "empty";
  if (parseCommand(text, columns).kind !== "error") return "ready";
  return longestVerbPrefix(text) !== null ? "verb" : "empty";
}

/** Splits "round amount -1" into a verb and the rest, longest verb first. */
function splitVerb(input: string): { verb: string; rest: string } | null {
  const text = normalise(input);
  const originalWords = input.trim().split(/\s+/).filter((word) => word !== "");
  const ordered = [...VERBS].sort(
    (a, b) => Math.max(b.name.length, ...b.aliases.map((alias) => alias.length)) -
      Math.max(a.name.length, ...a.aliases.map((alias) => alias.length)),
  );
  for (const verb of ordered) {
    for (const candidate of [verb.name, ...verb.aliases]) {
      const form = normalise(candidate);
      if (text === form) return { verb: verb.name, rest: "" };
      if (text.startsWith(`${form} `)) {
        const words = form.split(" ").length;
        return { verb: verb.name, rest: originalWords.slice(words).join(" ") };
      }
    }
  }
  return null;
}

/**
 * Parses one command-bar line: "upper amount", "round amount 2",
 * "fill amount median", "split name on space", "group region sum amount",
 * "drop notes", "clean", "views".
 */
export function parseCommand(input: string, columns: readonly ColumnMeta[]): ParsedCommand {
  const text = input.trim();
  if (text === "") return { kind: "error", message: "Type a command, e.g. “upper amount”." };
  const split = splitVerb(text);
  if (split === null) {
    return {
      kind: "error",
      message: `Unrecognised command — try “trim”, “round”, “fill”, “group” or “views”.`,
    };
  }
  const { verb, rest } = split;
  const columnIndex = findColumn(rest, columns);
  const columnName = columnIndex >= 0 ? columns[columnIndex].name : "";
  const column = columnIndex; // -1 when no column matched
  const needsColumn = (): ParsedCommand | null =>
    columnIndex < 0
      ? {
          kind: "error",
          message: `Which column? ${verb} needs a column name, e.g. “${verb} ${columns[0]?.name ?? "amount"}”.`,
        }
      : null;

  switch (verb) {
    case "upper":
    case "lower":
    case "title": {
      if (normalise(rest) === "all") {
        return {
          kind: "cleanAll",
          op: { kind: "case", style: verb },
          label: `${verb === "upper" ? "UPPERCASED" : verb === "lower" ? "lowercased" : "Title Cased"} every column's values`,
        };
      }
      const missing = needsColumn();
      if (missing !== null) return missing;
      return {
        kind: "clean",
        column,
        op: { kind: "case", style: verb },
        label: `${verb === "upper" ? "UPPERCASED" : verb === "lower" ? "lowercased" : "Title Cased"} ${columnName}`,
      };
    }
    case "trim": {
      if (normalise(rest) === "all") {
        return {
          kind: "cleanAll",
          op: { kind: "trim" },
          label: "Trimmed every column's values",
        };
      }
      const missing = needsColumn();
      if (missing !== null) return missing;
      return { kind: "clean", column, op: { kind: "trim" }, label: `Trimmed ${columnName}` };
    }
    case "snakecase":
    case "camelcase": {
      return {
        kind: "headerCase",
        style: verb === "snakecase" ? "snake" : "camel",
        label:
          verb === "snakecase"
            ? "Snake-cased all column names"
            : "Camel-cased all column names",
      };
    }
    case "quality": {
      return { kind: "quality", label: "Opened the data-quality breakdown" };
    }
    case "keydup": {
      const parts = rest
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
      const indexes: number[] = [];
      const names: string[] = [];
      for (const part of parts) {
        const index = findColumn(part, columns);
        if (index < 0) {
          return {
            kind: "error",
            message: `No column matches “${part}” — separate the key columns with commas, e.g. “keydup order_id, customer_id”.`,
          };
        }
        if (!indexes.includes(index)) {
          indexes.push(index);
          names.push(columns[index]?.name ?? part);
        }
      }
      if (indexes.length === 0) {
        return {
          kind: "error",
          message: "“keydup” needs at least one column, e.g. “keydup order_id, customer_id”.",
        };
      }
      return {
        kind: "keyDuplicates",
        columns: indexes,
        label: `Duplicate rows on (${names.join(", ")})`,
      };
    }
    case "number": {
      const missing = needsColumn();
      if (missing !== null) return missing;
      return {
        kind: "clean",
        column,
        op: { kind: "toNumber", locale: columns[column]?.numberLocale ?? "dot" },
        label: `Converted ${columnName} to numbers`,
      };
    }
    case "date": {
      const missing = needsColumn();
      if (missing !== null) return missing;
      return {
        kind: "clean",
        column,
        op: { kind: "toDate", order: columns[column]?.dateOrder ?? "dmy" },
        label: `Converted ${columnName} to dates`,
      };
    }
    case "datetime": {
      const missing = needsColumn();
      if (missing !== null) return missing;
      return {
        kind: "clean",
        column,
        op: { kind: "toDateTime", order: columns[column]?.dateOrder ?? "dmy" },
        label: `Converted ${columnName} to date & time`,
      };
    }
    case "escape": {
      const missing = needsColumn();
      if (missing !== null) return missing;
      return {
        kind: "clean",
        column,
        op: { kind: "escapeFormulas" },
        label: `Escaped formula-like cells in ${columnName}`,
      };
    }
    case "round": {
      const parts = rest.split(" ").filter((part) => part !== "");
      let decimals = 0;
      if (parts.length > 1 && /^-?\d+$/.test(parts[parts.length - 1] ?? "")) {
        decimals = Number(parts.pop());
      }
      const index = findColumn(parts.join(" "), columns);
      if (index < 0) {
        return { kind: "error", message: "Round needs a column, e.g. “round amount 2”." };
      }
      if (!Number.isFinite(decimals) || Math.abs(decimals) > 12) {
        return { kind: "error", message: "Round needs a decimal count between -12 and 12." };
      }
      return {
        kind: "transform",
        ops: [{ kind: "round", column: index, decimals }],
        label: `Rounded ${columns[index]?.name ?? "column"} to ${decimals} decimal${decimals === 1 ? "" : "s"}`,
      };
    }
    case "fill": {
      const parts = rest.split(" ").filter((part) => part !== "");
      // The column may be several words; try the longest prefix first.
      let index = -1;
      let tail: string[] = [];
      for (let take = parts.length; take >= 1; take--) {
        const candidate = findColumn(parts.slice(0, take).join(" "), columns);
        if (candidate >= 0) {
          index = candidate;
          tail = parts.slice(take);
          break;
        }
      }
      if (index < 0) {
        return { kind: "error", message: "Fill needs a column, e.g. “fill amount median”." };
      }
      const strategy = normalise(tail[0] ?? "median");
      const knownStrategy = ["mean", "median", "mode", "forward", "backward"].includes(strategy);
      const constantValue =
        strategy === "constant" ? (tail[1] ?? "") : (tail[0] ?? "median");
      const op: TransformOp =
        strategy === "mean"
          ? { kind: "impute", column: index, strategy: { kind: "mean" }, groupColumn: null }
          : strategy === "median"
            ? { kind: "impute", column: index, strategy: { kind: "median" }, groupColumn: null }
            : strategy === "mode"
              ? { kind: "impute", column: index, strategy: { kind: "mode" }, groupColumn: null }
              : strategy === "forward"
                ? { kind: "impute", column: index, strategy: { kind: "forward" }, groupColumn: null }
                : strategy === "backward"
                  ? { kind: "impute", column: index, strategy: { kind: "backward" }, groupColumn: null }
                  : {
                      kind: "impute",
                      column: index,
                      strategy: { kind: "constant", value: constantValue },
                      groupColumn: null,
                    };
      return {
        kind: "transform",
        ops: [op],
        label: `Filled missing values in ${columns[index]?.name ?? "column"} (${
          knownStrategy ? strategy : `constant ${constantValue}`
        })`,
      };
    }
    case "split": {
      const onIndex = rest.toLowerCase().indexOf(" on ");
      const columnText = onIndex >= 0 ? rest.slice(0, onIndex).trim() : rest;
      const rawPattern = onIndex >= 0 ? rest.slice(onIndex + 4).trim() : "";
      const pattern =
        rawPattern === "space"
          ? " "
          : rawPattern === "comma"
            ? ","
            : rawPattern === "tab"
              ? "\t"
              : rawPattern;
      const index = findColumn(columnText, columns);
      if (index < 0) {
        return { kind: "error", message: "Split needs a column, e.g. “split name on space”." };
      }
      if (pattern === "") {
        return { kind: "error", message: "Split needs a delimiter, e.g. “split name on ,”." };
      }
      return {
        kind: "transform",
        ops: [
          {
            kind: "splitColumn",
            column: index,
            pattern,
            regex: false,
            dropEmpty: true,
            dropOriginal: false,
            prefix: columns[index]?.name ?? "",
          },
        ],
        label: `Split ${columns[index]?.name ?? "column"} on “${pattern}”`,
      };
    }
    case "group": {
      // "group <dimension> sum <measure>" or "group <dimension> count"
      const words = rest.split(" ").filter((word) => word !== "");
      let dimText = words[0] ?? "";
      let aggWord = words[1] ?? "count";
      let measureText = words.slice(2).join(" ");
      // Try longer dimension names first ("start station" + "count").
      if (words.length >= 3 && /^(count|sum|mean|min|max|median)$/.test(words[words.length - 1])) {
        measureText = "";
        aggWord = words[words.length - 1];
        dimText = words.slice(0, -1).join(" ");
      }
      const dimension = Math.max(findColumn(dimText, columns), columnIndex);
      if (dimension < 0) {
        return { kind: "error", message: "Group needs a dimension column, e.g. “group region sum amount”." };
      }
      const aggregates = ["count", "sum", "mean", "min", "max", "median"] as const;
      const aggKey = normalise(aggWord);
      const agg = (aggregates as readonly string[]).includes(aggKey)
        ? (aggKey as (typeof aggregates)[number])
        : "count";
      let measure: number | null = null;
      if (agg !== "count" || measureText !== "") {
        measure = findColumn(measureText, columns);
        if (measure < 0 && columns[dimension] !== undefined) {
          // Default the measure to the first numeric column.
          measure = columns.findIndex(
            (meta, index) => index !== dimension && (meta.type === "integer" || meta.type === "number"),
          );
        }
        if (measure < 0) {
          return { kind: "error", message: `No measure column found for “${agg}”.` };
        }
      }
      const measureName =
        measure !== null && measure >= 0 ? columns[measure]?.name ?? "" : "rows";
      return {
        kind: "transform",
        ops: [{ kind: "groupBy", dimension, measure, aggregate: agg }],
        label: `Grouped by ${columns[dimension]?.name ?? "?"}: ${agg} of ${measureName}`,
      };
    }
    case "dedupe": {
      const dedupeRest = normalise(rest);
      const keep = dedupeRest.includes("last")
        ? "last"
        : dedupeRest.includes("all")
          ? "none"
          : "first";
      return {
        kind: "dedupe",
        keep,
        label: `Removed duplicate rows (${keep === "first" ? "keep first" : keep === "last" ? "keep last" : "all copies"})`,
      };
    }
    case "drop": {
      const missing = needsColumn();
      if (missing !== null) return missing;
      return {
        kind: "transform",
        ops: [{ kind: "drop", column }],
        label: `Dropped ${columnName}`,
      };
    }
    case "clean":
      return { kind: "openClean", column: columnIndex >= 0 ? columnIndex : undefined, label: "Opened Clean" };
    case "nulls":
      return { kind: "openClean", tab: "nulls", column: columnIndex >= 0 ? columnIndex : undefined, label: "Opened the missing-value review" };
    case "transform":
      return { kind: "openTransform", label: "Opened Transform" };
    case "export":
      return { kind: "export", label: "Opened Export" };
    case "views":
      return { kind: "views", label: "Opened Pivot View" };
    case "timeseries": {
      const dateType = columns.findIndex(
        (meta) => meta.type === "date" || meta.type === "datetime",
      );
      const dateIndex =
        dateType >= 0
          ? dateType
          : columns.findIndex((meta) =>
              meta.suggestions.some((suggestion) => suggestion.kind === "date"),
            );
      const valueType = columns.findIndex(
        (meta) => meta.type === "integer" || meta.type === "number",
      );
      const valueIndex =
        valueType >= 0
          ? valueType
          : columns.findIndex((meta) =>
              meta.suggestions.some((suggestion) => suggestion.kind === "number"),
            );
      if (dateIndex < 0) {
        return {
          kind: "error",
          message: "No date-like column found — convert the time column to dates first.",
        };
      }
      if (valueIndex < 0) {
        return {
          kind: "error",
          message: "No numeric measure found — convert the measure column to numbers first.",
        };
      }
      return {
        kind: "prepareTimeSeries",
        dateColumn: dateIndex,
        dateOrder: columns[dateIndex].dateOrder ?? "dmy",
        valueColumn: valueIndex,
        valueLocale: columns[valueIndex].numberLocale ?? "dot",
        label: `Prepared time series: ${columns[dateIndex].name} × ${columns[valueIndex].name}`,
      };
    }
    case "melt": {
      const keepMatch = rest.match(/^keep\s+(.+)$/i);
      const ids: number[] = [];
      if (keepMatch !== null) {
        for (const part of keepMatch[1].split(",").map((value) => value.trim())) {
          if (part === "") continue;
          const index = findColumn(part, columns);
          if (index < 0) {
            return {
              kind: "error",
              message: `No column matches “${part}” — use “melt keep region, year”.`,
            };
          }
          if (!ids.includes(index)) ids.push(index);
        }
        if (ids.length === 0) {
          return { kind: "error", message: "Melt needs at least one ID column after “keep”." };
        }
      } else if (rest !== "" && rest !== "all") {
        return {
          kind: "error",
          message: "Use “melt” for every column or “melt keep region, year”.",
        };
      }
      return {
        kind: "transform",
        ops: [
          {
            kind: "melt",
            idVars: ids,
            valueVars: [],
            varName: "variable",
            valueName: "value",
          },
        ],
        label:
          ids.length === 0
            ? "Melted every column into variable/value rows"
            : `Melted the remaining columns, keeping ${ids
                .map((index) => columns[index]?.name ?? "?")
                .join(", ")} as IDs`,
      };
    }
    case "combine": {
      const detected = autoCombineParts(columns);
      if (detected === null) {
        return {
          kind: "error",
          message: "No split date parts found — name them Year, Month and Day (and optionally Hour/Minute).",
        };
      }
      return {
        kind: "transform",
        ops: [
          {
            kind: "combineDate",
            parts: detected.parts,
            output: detected.output,
            outputName: detected.outputName,
            order: "auto",
            timeZone: "naive",
            dropParts: false,
          },
        ],
        label: `Combined ${detected.parts.length} date/time parts into ${detected.outputName}`,
      };
    }
    case "knn": {
      const words = rest.split(" ").filter((word) => word !== "");
      let k = 5;
      if (words.length > 1 && /^\d+$/.test(words[words.length - 1] ?? "")) {
        k = Number(words.pop());
      }
      const target = splitColumnPrefix(words.join(" "), columns);
      if (target === null) {
        return { kind: "error", message: "KNN needs a numeric column, e.g. “knn amount 5”." };
      }
      if (
        columns[target.index]?.type !== "integer" &&
        columns[target.index]?.type !== "number"
      ) {
        return { kind: "error", message: `“${target.name}” is not numeric — KNN fills numeric columns.` };
      }
      const predictors = columns
        .map((meta, index) => ({ meta, index }))
        .filter(
          (entry) =>
            entry.index !== target.index &&
            (entry.meta.type === "integer" || entry.meta.type === "number"),
        )
        .map((entry) => entry.index);
      if (predictors.length === 0) {
        return { kind: "error", message: "KNN needs at least one other numeric predictor column." };
      }
      if (!Number.isFinite(k) || k < 1 || k > 100) {
        return { kind: "error", message: "KNN neighbours must be between 1 and 100." };
      }
      return {
        kind: "transform",
        ops: [{ kind: "knn", fill: [target.index], predictors, k }],
        label: `KNN-filled ${target.name} from ${predictors.length} numeric predictor${predictors.length === 1 ? "" : "s"} (k=${k})`,
      };
    }
    case "splitregex": {
      const onIndex = rest.toLowerCase().indexOf(" on ");
      const columnText = onIndex >= 0 ? rest.slice(0, onIndex).trim() : rest;
      const pattern = onIndex >= 0 ? rest.slice(onIndex + 4).trim() : "";
      const index = findColumn(columnText, columns);
      if (index < 0 || pattern === "") {
        return {
          kind: "error",
          message: "Use “splitregex notes on \\d+” (a column and a regex pattern).",
        };
      }
      return {
        kind: "transform",
        ops: [
          {
            kind: "splitColumn",
            column: index,
            pattern,
            regex: true,
            dropEmpty: true,
            dropOriginal: false,
            prefix: columns[index]?.name ?? "",
          },
        ],
        label: `Split ${columns[index]?.name ?? "column"} on regex /${pattern}/`,
      };
    }
    case "repair": {
      const missing = needsColumn();
      if (missing !== null) return missing;
      if (
        columns[column]?.type !== "integer" &&
        columns[column]?.type !== "number"
      ) {
        return { kind: "error", message: `“${columnName}” is not numeric — repair works on numeric columns.` };
      }
      return {
        kind: "clean",
        column,
        op: { kind: "repairDecimal", locale: columns[column]?.numberLocale ?? "dot" },
        label: `Repaired mixed decimal conventions in ${columnName}`,
      };
    }
    case "replace": {
      const withIndex = rest.toLowerCase().lastIndexOf(" with ");
      if (withIndex < 0) {
        return {
          kind: "error",
          message: "Use “replace notes \"old\" with \"new\"”.",
        };
      }
      const left = rest.slice(0, withIndex).trim();
      const replacement = unquote(rest.slice(withIndex + 6).trim());
      const target = splitColumnPrefix(left, columns);
      if (target === null) {
        return { kind: "error", message: "Replace needs a column, e.g. “replace notes \"old\" with \"new\"”." };
      }
      const find = unquote(target.rest);
      if (find === "") {
        return { kind: "error", message: "Replace needs text to find, e.g. “replace notes \"old\" with \"new\"”." };
      }
      return {
        kind: "clean",
        column: target.index,
        op: { kind: "replace", find, replacement, ignoreCase: false },
        label: `Replaced “${find}” in ${target.name}`,
      };
    }
    case "type": {
      const target = splitColumnPrefix(rest, columns);
      if (target === null) {
        return { kind: "error", message: "Type needs a column and a type, e.g. “type amount number”." };
      }
      const aliases: Record<string, ColumnType> = {
        text: "string",
        string: "string",
        category: "category",
        integer: "integer",
        int: "integer",
        number: "number",
        numeric: "number",
        date: "date",
        datetime: "datetime",
        "date time": "datetime",
        time: "time",
        duration: "duration",
        boolean: "boolean",
        bool: "boolean",
        identifier: "identifier",
        id: "identifier",
      };
      const type = aliases[normalise(target.rest)];
      if (type === undefined) {
        return { kind: "error", message: `Unknown type “${target.rest}”. Try text, number, date, datetime, category, boolean or identifier.` };
      }
      return { kind: "type", column: target.index, type, label: `Changed ${target.name} to ${type}` };
    }
    case "rename": {
      const toIndex = rest.toLowerCase().lastIndexOf(" to ");
      if (toIndex >= 0) {
        const left = rest.slice(0, toIndex).trim();
        const name = unquote(rest.slice(toIndex + 4).trim());
        const target = splitColumnPrefix(left, columns);
        if (target !== null && name !== "") {
          return { kind: "rename", column: target.index, name, label: `Renamed ${target.name} to ${name}` };
        }
      }
      const target = splitColumnPrefix(rest, columns);
      const name = target === null ? "" : unquote(target.rest);
      if (target === null || name === "") {
        return { kind: "error", message: "Use “rename notes memo”." };
      }
      return { kind: "rename", column: target.index, name, label: `Renamed ${target.name} to ${name}` };
    }
    case "sort": {
      if (normalise(rest) === "none") {
        return { kind: "sort", column: -1, dir: 0, label: "Cleared the sort order" };
      }
      const target = splitColumnPrefix(rest, columns);
      if (target === null) {
        return { kind: "error", message: "Sort needs a column, e.g. “sort amount desc” or “sort none”." };
      }
      const direction = normalise(target.rest);
      if (direction !== "" && direction !== "asc" && direction !== "ascending" && direction !== "desc" && direction !== "descending") {
        return { kind: "error", message: "Sort direction must be asc or desc." };
      }
      const dir = direction === "desc" || direction === "descending" ? -1 : 1;
      return { kind: "sort", column: target.index, dir, label: `Sorted ${target.name} ${dir === -1 ? "descending" : "ascending"}` };
    }
    case "filter": {
      const target = splitColumnPrefix(rest, columns);
      if (target === null) {
        return { kind: "error", message: "Filter needs a column, e.g. “filter region active”." };
      }
      let mode: "contains" | "exact" | "fuzzy" | "phonetic" = "contains";
      let query = target.rest;
      const modeMatch = query.match(/^(exact|contains|fuzzy|phonetic|sounds like)\s+([\s\S]+)$/i);
      if (modeMatch !== null) {
        mode = modeMatch[1].toLowerCase() === "sounds like" ? "phonetic" : (modeMatch[1].toLowerCase() as typeof mode);
        query = modeMatch[2];
      }
      query = unquote(query);
      if (query === "") {
        return { kind: "error", message: "Filter needs a value, e.g. “filter region active”." };
      }
      const range = query.match(/^(-?\d+(?:\.\d+)?)?\.\.(-?\d+(?:\.\d+)?)?$/);
      if (
        range !== null &&
        (range[1] !== undefined || range[2] !== undefined) &&
        (columns[target.index]?.type === "integer" || columns[target.index]?.type === "number")
      ) {
        const min = range[1] === undefined ? null : Number(range[1]);
        const max = range[2] === undefined ? null : Number(range[2]);
        return {
          kind: "filter",
          column: target.index,
          filter: { kind: "range", min, max },
          label: `Filtered ${target.name} to ${range[1] ?? "…"}..${range[2] ?? "…"}`,
        };
      }
      return {
        kind: "filter",
        column: target.index,
        filter: { kind: "text", mode, query },
        label: `Filtered ${target.name} — ${mode} “${query}”`,
      };
    }
    case "clear":
      if (rest !== "" && normalise(rest) !== "filters") {
        return { kind: "error", message: "Use “clear filters”." };
      }
      return { kind: "clearFilters", label: "Cleared every filter" };
    case "merge": {
      const target = splitColumnPrefix(rest, columns);
      if (target === null) {
        return { kind: "error", message: "Merge needs a category column, e.g. “merge region”." };
      }
      if (columns[target.index]?.type !== "category") {
        return { kind: "error", message: `“${target.name}” is not a category column.` };
      }
      return { kind: "merge", column: target.index, label: `Opened merge for ${target.name}` };
    }
    case "chart": {
      if (rest === "") return { kind: "chart", label: "Opened Chart" };
      const target = splitColumnPrefix(rest, columns);
      if (target === null) {
        return { kind: "error", message: "Chart needs a column, e.g. “chart region”." };
      }
      return { kind: "chart", column: target.index, label: `Added a chart for ${target.name}` };
    }
    case "table":
      return { kind: "openView", view: "table", label: "Opened Table" };
    case "overview":
      return { kind: "openView", view: "overview", label: "Opened Overview" };
    case "outliers":
      return { kind: "openView", view: "outliers", label: "Opened Outliers" };
    case "relationships":
      return { kind: "openView", view: "relationships", label: "Opened Relationships" };
    case "map":
      return { kind: "openView", view: "map", label: "Opened Map" };
    case "forecast":
      return { kind: "openView", view: "timeseries", label: "Opened Time Series" };
    case "shuffle":
      return { kind: "shuffle", label: "Shuffled the rows" };
    case "copy":
      return { kind: "copy", label: "Copied the filtered rows" };
    case "tiles":
      return { kind: "tiles", label: "Toggled Info Tiles" };
    case "dropempty": {
      const emptyColumns = columns
        .map((meta, index) => ({ meta, index }))
        .filter((entry) => entry.meta.stats.distinct === 0 && entry.meta.stats.nulls > 0)
        .map((entry) => entry.index);
      if (emptyColumns.length === 0) {
        return { kind: "error", message: "No columns are empty in every row." };
      }
      return {
        kind: "transform",
        ops: emptyColumns.map((column) => ({ kind: "drop" as const, column })),
        label: `Dropped ${emptyColumns.length} empty column${emptyColumns.length === 1 ? "" : "s"}`,
      };
    }
    case "headercase": {
      const styles: Record<string, HeaderCaseStyle> = {
        snake: "snake",
        "snake case": "snake",
        camel: "camel",
        "camel case": "camel",
        title: "title",
        lower: "lower",
        upper: "upper",
        keep: "keep",
      };
      const style = styles[normalise(rest)];
      if (style === undefined) {
        return { kind: "error", message: "Header case needs snake, camel, title, lower or upper." };
      }
      return { kind: "headerCase", style, label: `Normalised column names (${style})` };
    }
    case "stats":
      return { kind: "stats", label: "Opened the Stats Report" };
    case "recipe":
      return { kind: "recipe", label: "Opened Recipe" };
    case "winsorize": {
      const words = rest.split(" ").filter((word) => word !== "");
      let percent = 1;
      if (words.length > 1 && /^\d+(?:\.\d+)?$/.test(words[words.length - 1] ?? "")) {
        percent = Number(words.pop());
      }
      const target = splitColumnPrefix(words.join(" "), columns);
      if (target === null) {
        return { kind: "error", message: "Winsorize needs a numeric column, e.g. “winsorize amount 1”." };
      }
      if (
        columns[target.index]?.type !== "integer" &&
        columns[target.index]?.type !== "number"
      ) {
        return { kind: "error", message: `“${target.name}” is not numeric — winsorize works on numeric columns.` };
      }
      if (percent <= 0 || percent >= 50) {
        return { kind: "error", message: "Winsorize percentile must be between 0 and 50." };
      }
      return {
        kind: "transform",
        ops: [{ kind: "winsorize", column: target.index, percent }],
        label: `Winsorised ${target.name} at ${percent}% / ${100 - percent}%`,
      };
    }
    case "flag": {
      const target = splitColumnPrefix(rest, columns);
      if (target === null) {
        return { kind: "error", message: "Flag needs a numeric column, e.g. “flag amount”." };
      }
      if (
        columns[target.index]?.type !== "integer" &&
        columns[target.index]?.type !== "number"
      ) {
        return { kind: "error", message: `“${target.name}” is not numeric — flag works on numeric columns.` };
      }
      return {
        kind: "transform",
        ops: [{ kind: "flagAnomalies", column: target.index }],
        label: `Added an outlier flag for ${target.name}`,
      };
    }
    case "help":
      return { kind: "help", label: "Opened Help" };
    case "theme": {
      const preference = normalise(rest);
      if (preference !== "auto" && preference !== "light" && preference !== "dark") {
        return { kind: "error", message: "Theme needs auto, light or dark — “theme dark”." };
      }
      return { kind: "theme", preference, label: `Set theme to ${preference}` };
    }
    default:
      return { kind: "error", message: `Unrecognised command “${verb}”.` };
  }
}

/** Suggestions for the palette: every command, best prefix match first. */
export function commandSuggestions(
  input: string,
  columns: readonly ColumnMeta[],
  limit = 8,
): CommandSuggestion[] {
  const text = input.trim();
  // Examples pick a column the verb actually applies to (dates for "date",
  // numbers for "round"), so the base list is not fixated on the first column.
  const pickColumn = (verb: string): string =>
    columns.find((meta) => columnFitsVerb(verb, meta))?.name ?? columns[0]?.name ?? "amount";
  const pickTextColumn = (): string =>
    columns.find(
      (meta) =>
        meta.type === "string" || meta.type === "category" || meta.type === "identifier",
    )?.name ??
    columns[0]?.name ??
    "notes";
  const specialExample = (name: string): string | null => {
    switch (name) {
      case "keydup":
        return `keydup ${columns[0]?.name ?? "order_id"}, ${columns[1]?.name ?? "customer_id"}`;
      case "melt":
        return `melt keep ${columns[0]?.name ?? "region"}`;
      case "combine":
        return "combine dates";
      case "knn":
        return `knn ${pickColumn("knn")} 5`;
      case "splitregex":
        return `splitregex ${pickColumn("splitregex")} on \\d+`;
      case "replace":
        return `replace ${pickColumn("replace")} "old" with "new"`;
      case "type":
        return `type ${pickTextColumn()} number`;
      case "rename":
        return `rename ${pickColumn("rename")} renamed`;
      case "sort":
        return `sort ${pickColumn("sort")} desc`;
      case "filter":
        return `filter ${pickTextColumn()} active`;
      case "clear":
        return "clear filters";
      case "merge":
        return `merge ${pickColumn("merge")}`;
      case "chart":
        return `chart ${pickTextColumn()}`;
      case "headercase":
        return "headercase snake";
      case "dropempty":
        return "dropempty";
      case "winsorize":
        return `winsorize ${pickColumn("winsorize")} 1`;
      case "flag":
        return `flag ${pickColumn("flag")}`;
      case "theme":
        return "theme dark";
      default:
        return null;
    }
  };
  const example = (name: string): string =>
    specialExample(name) ?? (COLUMN_VERBS.has(name) ? `${name} ${pickColumn(name)}` : name);
  const base: CommandSuggestion[] = VERBS.map((verb) => ({
    usage: example(verb.name),
    hint: verb.hint,
    command: parseCommand(example(verb.name), columns),
  }));
  const text2 = normalise(text);
  if (text2 === "") return base.slice(0, limit);

  // Verb + partial column: complete against every matching column of the
  // right type, so any column name can be finished from the palette.
  const prefix = longestVerbPrefix(text);
  if (prefix !== null && COLUMN_VERBS.has(prefix.verb)) {
    const rest = text2.slice(prefix.length).trim();
    const hint = VERBS.find((verb) => verb.name === prefix.verb)?.hint ?? "";
    // "<verb> all" applies a value clean to every column at once.
    if (rest === "all" && ALL_VERBS.has(prefix.verb)) {
      const usage = `${prefix.verb} all`;
      return [
        {
          usage,
          hint: `${hint} · every column`,
          command: parseCommand(usage, columns),
        },
      ];
    }
    const completions = columns
      .map((meta, index) => ({
        meta,
        index,
        score: columnMatchScore(normalise(meta.name), rest),
      }))
      .filter((entry) => entry.score > 0 && columnFitsVerb(prefix.verb, entry.meta))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map(({ meta }) => {
        const usage = `${prefix.verb} ${meta.name}`;
        return {
          usage,
          hint: hint === "" ? meta.name : `${hint} · ${meta.name}`,
          command: parseCommand(usage, columns),
        };
      });
    if (completions.length > 0) return completions;
  }

  const scored = base
    .map((suggestion) => {
      const usage = normalise(suggestion.usage);
      const verb = normalise(suggestion.usage.split(" ")[0] ?? "");
      let score = -1;
      if (verb.startsWith(text2)) score = 100 - verb.length;
      else if (verb.includes(text2)) score = 60;
      else if (usage.includes(text2)) score = 40;
      return { suggestion, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.suggestion);
  if (scored.length > 0) return scored;
  const parsed = parseCommand(text, columns);
  return [{ usage: text, hint: parsed.kind === "error" ? parsed.message : "Run this command", command: parsed }];
}

export interface CommandBarOptions {
  columns(): readonly ColumnMeta[];
  onRun(command: ParsedCommand): void;
}

/**
 * Ctrl/Cmd+K palette: one input, live suggestions and Enter to run. Commands
 * apply immediately (with Undo in the Recipe) or open the matching panel.
 */
export function openCommandBar(options: CommandBarOptions): void {
  const overlay = el("div", { class: "modal-overlay command-overlay" });
  const modal = el("div", { class: "command-modal", role: "dialog", "aria-label": "Enter a command" });
  const input = el("input", {
    class: "command-input",
    type: "text",
    placeholder: "Enter a command — “convert date_time to datetime”, “melt keep region”, “round price 2”…",
    spellcheck: "false",
    "aria-label": "Command",
  }) as HTMLInputElement;
  const list = el("div", { class: "command-list" });
  modal.append(input, list);
  overlay.append(modal);

  let suggestions: CommandSuggestion[] = [];
  let active = 0;
  let confirming = false;

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (confirming) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const render = (): void => {
    const state = commandState(input.value, options.columns());
    input.classList.toggle("verb-ok", state === "verb");
    input.classList.toggle("ready", state === "ready");
    suggestions = commandSuggestions(
      input.value,
      options.columns(),
      input.value.trim() === "" ? 50 : 8,
    );
    active = Math.min(active, Math.max(0, suggestions.length - 1));
    list.replaceChildren();
    suggestions.forEach((suggestion, index) => {
      const row = el(
        "button",
        {
          class: `command-item${index === active ? " active" : ""}`,
          type: "button",
        },
        [],
      ) as HTMLButtonElement;
      row.append(
        el("span", { class: "command-usage" }, [suggestion.usage]),
        el("span", { class: "command-hint" }, [suggestion.hint]),
      );
      row.addEventListener("click", () => runConfirmed(suggestion.command));
      list.append(row);
    });
  };

  const run = (command: ParsedCommand): void => {
    close();
    options.onRun(command);
  };

  /**
   * Data-changing commands ask first ("did you mean…"), so a stray Enter can
   * never silently change the table; panels and exports open directly.
   */
  const runConfirmed = (command: ParsedCommand): void => {
    const changesData =
      command.kind === "clean" ||
      command.kind === "cleanAll" ||
      command.kind === "headerCase" ||
      command.kind === "keyDuplicates" ||
      command.kind === "transform" ||
      command.kind === "dedupe" ||
      command.kind === "prepareTimeSeries" ||
      command.kind === "type" ||
      command.kind === "rename";
    if (!changesData) {
      run(command);
      return;
    }
    confirming = true;
    void openConfirm({
      title: "Apply this step?",
      body: `“${input.value.trim()}” → ${command.label}. Every step is undoable from the Recipe.`,
      confirmLabel: "Apply",
    }).then((ok) => {
      confirming = false;
      if (ok) run(command);
      else input.focus();
    });
  };

  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = Math.min(active + 1, suggestions.length - 1);
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(active - 1, 0);
      render();
    } else if (event.key === "Tab" && suggestions.length > 0) {
      // Tab accepts the highlighted suggestion into the input.
      event.preventDefault();
      input.value = suggestions[active]?.usage ?? input.value;
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const parsed = parseCommand(input.value, options.columns());
      if (parsed.kind === "error") {
        // Keep the palette open and show the message as the active hint.
        list.replaceChildren(
          el("div", { class: "command-error" }, [parsed.message]),
        );
        return;
      }
      runConfirmed(parsed);
    }
  });
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  input.focus();
  render();
}
