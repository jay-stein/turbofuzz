import type { ColumnMeta } from "../worker/protocol.js";
import type { DateOrder } from "../parse/dates.js";
import type { NumberLocale } from "../parse/numbers.js";
import type { CleanOp } from "../data/clean-ops.js";
import type { TransformOp } from "../data/transform-ops.js";
import { el } from "./dom.js";

/** What a typed command means, or a friendly parse error. */
export type ParsedCommand =
  | { kind: "clean"; column: number; op: CleanOp; label: string }
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
  | { kind: "export"; label: string }
  | { kind: "views"; label: string }
  | { kind: "error"; message: string };

export interface CommandSuggestion {
  /** Text filled into the input when chosen. */
  usage: string;
  /** One-line explanation under the usage. */
  hint: string;
  command: ParsedCommand;
}

const VERBS: readonly { name: string; aliases: readonly string[]; hint: string }[] = [
  { name: "upper", aliases: ["uppercase"], hint: "UPPERCASE a column" },
  { name: "lower", aliases: ["lowercase"], hint: "lowercase a column" },
  { name: "title", aliases: ["titlecase"], hint: "Title Case a column" },
  { name: "trim", aliases: ["strip"], hint: "Trim whitespace" },
  { name: "number", aliases: ["tonumber", "convert number"], hint: "Convert a column to numbers" },
  { name: "date", aliases: ["todate", "convert date"], hint: "Convert a column to dates" },
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
  { name: "views", aliases: ["view", "aggregate view"], hint: "Open the Views lens" },
  {
    name: "timeseries",
    aliases: ["time series", "prepare time series"],
    hint: "One step: parse the date and measure, ready for sorting, filtering and charting",
  },
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

/** Splits "round amount -1" into a verb and the rest, longest verb first. */
function splitVerb(input: string): { verb: string; rest: string } | null {
  const text = normalise(input);
  const ordered = [...VERBS].sort(
    (a, b) => Math.max(b.name.length, ...b.aliases.map((alias) => alias.length)) -
      Math.max(a.name.length, ...a.aliases.map((alias) => alias.length)),
  );
  for (const verb of ordered) {
    for (const candidate of [verb.name, ...verb.aliases]) {
      if (text === candidate) return { verb: verb.name, rest: "" };
      if (text.startsWith(`${candidate} `)) {
        return { verb: verb.name, rest: text.slice(candidate.length + 1).trim() };
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
      const missing = needsColumn();
      if (missing !== null) return missing;
      return { kind: "clean", column, op: { kind: "trim" }, label: `Trimmed ${columnName}` };
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
      const strategy = tail[0] ?? "median";
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
                      strategy: { kind: "constant", value: tail[1] ?? "" },
                      groupColumn: null,
                    };
      return {
        kind: "transform",
        ops: [op],
        label: `Filled missing values in ${columns[index]?.name ?? "column"} (${strategy})`,
      };
    }
    case "split": {
      const onIndex = rest.indexOf(" on ");
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
      const agg = (aggregates as readonly string[]).includes(aggWord)
        ? (aggWord as (typeof aggregates)[number])
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
      const keep = rest.includes("last") ? "last" : rest.includes("all") ? "none" : "first";
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
      return { kind: "views", label: "Opened Views" };
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
  const samples = columns.slice(0, 3).map((column) => column.name);
  const example = (name: string): string => {
    const needs = ["upper", "lower", "title", "trim", "number", "date", "escape", "round", "fill", "split", "drop"].includes(name);
    return needs ? `${name} ${samples[0] ?? "amount"}` : name;
  };
  const base: CommandSuggestion[] = VERBS.map((verb) => ({
    usage: example(verb.name),
    hint: verb.hint,
    command: parseCommand(example(verb.name), columns),
  }));
  const text2 = normalise(text);
  if (text2 === "") return base.slice(0, limit);
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
  const modal = el("div", { class: "command-modal", role: "dialog", "aria-label": "Command bar" });
  const input = el("input", {
    class: "command-input",
    type: "text",
    placeholder: "Type a command — “upper amount”, “round price 2”, “group region sum sales”…",
    spellcheck: "false",
    "aria-label": "Command",
  }) as HTMLInputElement;
  const list = el("div", { class: "command-list" });
  modal.append(input, list);
  overlay.append(modal);

  let suggestions: CommandSuggestion[] = [];
  let active = 0;

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const render = (): void => {
    suggestions = commandSuggestions(input.value, options.columns());
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
      row.addEventListener("click", () => run(suggestion.command));
      list.append(row);
    });
  };

  const run = (command: ParsedCommand): void => {
    close();
    options.onRun(command);
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
      run(parsed);
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
