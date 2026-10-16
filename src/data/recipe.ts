import { describeCleanOp, type CleanOp } from "./clean-ops.js";
import { compileExpression, type ExprTerm, type DimensionSpec, type MeasureSpec, type ViewDef } from "./aggregate.js";
import {
  schemaAfter,
  describeTransformOp,
  type ColumnSchema,
  type TransformOp,
} from "./transform-ops.js";
import {
  supportHeaderLines,
  type RecipeScript,
  type SupportEntry,
} from "./recipe-support.js";
import type { ColumnType } from "../types.js";

export interface RecipeInput {
  cleans: readonly { name: string; ops: readonly CleanOp[] }[];
  transforms: readonly TransformOp[];
  /** Schema as authored before the transform steps. */
  schema: readonly ColumnSchema[];
  /**
   * Manual logical-type changes. Applied after the value cleans, matching the
   * app where cleans always read the raw text.
   */
  types?: readonly { name: string; type: ColumnType }[];
  /** Per-column missing-value policy: tokens treated as missing, values kept. */
  nulls?: readonly { name: string; extra: readonly string[]; keep: readonly string[] }[];
  /** Rows deleted interactively — data-dependent, not expressible in code. */
  deletedRows?: number;
}

function py(value: string): string {
  return JSON.stringify(value);
}

function target(name: string): string {
  return `df[${py(name)}]`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PERIOD: Record<string, string> = {
  minute: "min",
  hour: "h",
  day: "D",
  week: "W",
  month: "M",
  quarter: "Q",
  year: "Y",
};

const PANDAS_AGG: Record<string, string> = {
  sum: "sum",
  mean: "mean",
  min: "min",
  max: "max",
  median: "median",
  stddev: "std",
  first: "first",
  last: "last",
  count: "count",
  distinct: "nunique",
};

function pandasMeasure(measure: MeasureSpec, names: readonly string[]): string {
  const source = measure.column === null ? names[0] ?? "value" : names[measure.column] ?? "value";
  if (measure.column === null) return `(${py(source)}, "size")`;
  if (measure.agg === "mode") return `(${py(source)}, lambda s: s.mode().iloc[0] if not s.mode().empty else None)`;
  const percentile = /^p(\d+(?:\.\d+)?)$/.exec(measure.agg);
  if (percentile !== null) return `(${py(source)}, lambda s: s.quantile(${Number(percentile[1]) / 100}))`;
  const method = PANDAS_AGG[measure.agg];
  return method === undefined ? `(${py(source)}, ${py(measure.agg)})` : `(${py(source)}, "${method}")`;
}

function measureName(measure: MeasureSpec, names: readonly string[]): string {
  if (measure.agg === "expr") return measure.expr ?? "expr";
  const source = measure.column === null ? "rows" : names[measure.column] ?? "?";
  return measure.column === null ? "count(*)" : `${measure.agg}(${source})`;
}

/** The named-aggregation tuple for one expression term. */
function pandasTermTuple(term: ExprTerm, names: readonly string[]): string {
  const source = term.column === null ? names[0] ?? "value" : names[term.column] ?? "value";
  if (term.column === null) return `(${py(source)}, "size")`;
  if (term.agg === "mode") {
    return `(${py(source)}, lambda s: s.mode().iloc[0] if not s.mode().empty else None)`;
  }
  const percentile = /^p(\d+(?:\.\d+)?)$/.exec(term.agg);
  if (percentile !== null) {
    return `(${py(source)}, lambda s: s.quantile(${Number(percentile[1]) / 100}))`;
  }
  const method = PANDAS_AGG[term.agg];
  return method === undefined ? `(${py(source)}, ${py(term.agg)})` : `(${py(source)}, "${method}")`;
}

function termName(term: ExprTerm, names: readonly string[]): string {
  return term.column === null ? "count(*)" : `${term.agg}(${names[term.column] ?? "?"})`;
}

/** Rewrites `sum(amount)` inside an expression to the generated column name. */
function translateExpression(
  expr: string,
  names: readonly string[],
): string | null {
  let failed = false;
  const translated = expr.replace(
    /(p\d+(?:\.\d+)?|[a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([^)]*?)\s*\)/g,
    (match, fn: string, arg: string) => {
      const name = fn.toLowerCase();
      const known =
        ["count", "distinct", "sum", "mean", "min", "max", "median", "stddev", "first", "last", "mode"].includes(name) ||
        /^p\d+(?:\.\d+)?$/.test(name);
      if (!known) {
        failed = true;
        return match;
      }
      if (arg === "*" || arg === "") return `${target("count(*)")}`;
      const column = names.indexOf(arg);
      if (column < 0) {
        failed = true;
        return match;
      }
      return target(`${name}(${names[column]})`);
    },
  );
  return failed ? null : translated;
}

/**
 * pandas lines for a group-by definition: one temp column per time/date-part
 * dimension, then a named aggregation. Post-aggregation ops are emitted as
 * comments because their window semantics are best applied to the sorted
 * result.
 */
export function viewPandasLines(
  dimensions: readonly DimensionSpec[],
  measures: readonly MeasureSpec[],
  names: readonly string[],
  fill: "none" | "zero" | "carry" = "none",
  entries?: SupportEntry[],
): string[] {
  const lines: string[] = [];
  if (fill !== "none") {
    lines.push(
      `# empty periods: ${fill === "carry" ? "carried forward" : "filled with zero"} — reindex/resample the group axis before the post steps`,
    );
    entries?.push({
      label: `aggregate: fill empty periods (${fill === "carry" ? "carry forward" : "zero"})`,
      status: "manual_step_required",
      note: "the group axis is not reindexed in the generated code",
    });
  }
  const groupExprs = dimensions.map((spec, index) => {
    const name = names[spec.column] ?? `Column ${spec.column + 1}`;
    const by = spec.by;
    if (typeof by === "object" && "time" in by) {
      const temp = `_group${index}`;
      if (by.fiscalStartMonth !== undefined && by.fiscalStartMonth !== 1) {
        lines.push(
          `# fiscal year starts in month ${by.fiscalStartMonth}: re-label Y/Q buckets after the groupby`,
        );
        entries?.push({
          label: `aggregate: fiscal year starts month ${by.fiscalStartMonth}`,
          status: "supported_with_warning",
          note: "calendar Y/Q labels need re-labelling for the fiscal calendar",
        });
      }
      if (by.tz !== undefined && by.tz.trim() !== "") {
        lines.push(
          `# timezone ${by.tz}: convert timestamps before resampling, e.g. ${target(name)}.dt.tz_convert(${py(by.tz)})`,
        );
        entries?.push({
          label: `aggregate: timezone ${by.tz}`,
          status: "supported_with_warning",
          note: "convert the timestamp column to the zone before the groupby",
        });
      }
      const weekArg = by.time === "week" && by.weekStart === 0 ? '  # weeks start Sunday' : "";
      if (weekArg !== "") {
        entries?.push({
          label: "aggregate: weeks start Sunday",
          status: "supported_with_warning",
          note: "pandas weeks start Monday; shift the bucket labels",
        });
      }
      lines.push(
        `${temp} = pd.to_datetime(df[${py(name)}]).dt.to_period(${py(PERIOD[by.time] ?? "D")}).dt.to_timestamp()${weekArg}`,
      );
      return temp;
    }
    if (typeof by === "object" && ("cohort" in by || "since" in by)) {
      const cohortSpec = "cohort" in by ? by.cohort : by.since;
      const entity = names[cohortSpec.entity] ?? `Column ${cohortSpec.entity + 1}`;
      const temp = `_group${index}`;
      const first = `_first${index}`;
      const period = py(PERIOD[cohortSpec.grain] ?? "M");
      lines.push(`${first} = pd.to_datetime(df[${py(name)}]).groupby(df[${py(entity)}]).transform("min")`);
      if ("cohort" in by) {
        lines.push(`${temp} = ${first}.dt.to_period(${period}).dt.to_timestamp()`);
        return temp;
      }
      if (cohortSpec.grain === "month") {
        lines.push(
          `${temp} = (pd.to_datetime(df[${py(name)}]).dt.year - ${first}.dt.year) * 12 + (pd.to_datetime(df[${py(name)}]).dt.month - ${first}.dt.month)`,
        );
      } else {
        lines.push(
          `# periods since first ${entity} at ${cohortSpec.grain} grain: subtract the period indices of ${name} and ${first}`,
        );
        entries?.push({
          label: `aggregate: periods since first ${entity} (${cohortSpec.grain})`,
          status: "supported_with_warning",
          note: "the generated temp column holds period labels, not offsets",
        });
        lines.push(`${temp} = pd.to_datetime(df[${py(name)}]).dt.to_period(${period})`);
      }
      return temp;
    }
    if (typeof by === "object" && "datePart" in by) {
      const temp = `_group${index}`;
      const accessor =
        by.datePart === "dow"
          ? "dayofweek"
          : by.datePart === "hour"
            ? "hour"
            : by.datePart === "month"
              ? "month"
              : by.datePart === "dom"
                ? "day"
                : "isocalendar().week";
      lines.push(`${temp} = pd.to_datetime(df[${py(name)}]).dt.${accessor}`);
      return temp;
    }
    if (typeof by === "object" && "bin" in by) {
      const temp = `_group${index}`;
      const source = `df[${py(name)}]`;
      if ("edges" in by.bin) {
        lines.push(`${temp} = pd.cut(${source}, bins=[${by.bin.edges.join(", ")}])`);
      } else if ("width" in by.bin) {
        lines.push(`# equal-width bins of ${by.bin.width} from the data minimum`);
        entries?.push({
          label: `aggregate: equal-width bins of ${by.bin.width}`,
          status: "supported_with_warning",
          note: "bin edges derive from the data minimum; fixed data required",
        });
        lines.push(
          `${temp} = pd.cut(${source}, bins=max(1, int((${source}.max() - ${source}.min()) / ${by.bin.width}) + 1))`,
        );
      } else {
        lines.push(`${temp} = pd.qcut(${source}, q=${by.bin.n}, duplicates="drop")`);
      }
      return temp;
    }
    return py(name);
  });

  const helperNames: string[] = [];
  const weightedHelpers: string[] = [];
  const weightedPost: string[] = [];
  const simpleNames = new Set(
    measures.filter((measure) => measure.agg !== "expr").map((measure) => measureName(measure, names)),
  );
  const emitted = new Set<string>();
  const emittedCheck = (set: Set<string>, key: string): boolean => {
    if (set.has(key)) return true;
    set.add(key);
    return false;
  };

  // Conditional measures: build a mask column, then aggregate a masked copy
  // (sum/mean ignore NaN; count only counts present values).
  const conditionHelpers = new Map<number, string>();
  measures.forEach((measure, index) => {
    const where = measure.where;
    if (where === undefined) return;
    const name = names[where.column] ?? `Column ${where.column + 1}`;
    const mask = `_mask_${index}`;
    if (where.isNull === true) {
      lines.push(`${mask} = df[${py(name)}].isna()`);
    } else if (where.values !== undefined) {
      lines.push(
        `${mask} = df[${py(name)}].isin([${where.values.map((value) => py(value)).join(", ")}])`,
      );
    } else {
      const numeric = `pd.to_numeric(df[${py(name)}], errors="coerce")`;
      const parts: string[] = [];
      if (where.min !== undefined) parts.push(`${numeric} >= ${where.min}`);
      if (where.max !== undefined) parts.push(`${numeric} <= ${where.max}`);
      lines.push(`${mask} = ${parts.length === 0 ? "True" : parts.join(" & ")}`);
    }
    if (measure.agg === "count" && measure.column === null) {
      conditionHelpers.set(index, `_cond_${index}`);
      lines.push(`df["_cond_${index}"] = df[${py(name)}].where(${mask})`);
      return;
    }
    if ((measure.agg === "sum" || measure.agg === "mean") && measure.column !== null) {
      conditionHelpers.set(index, `_cond_${index}`);
      lines.push(
        `df["_cond_${index}"] = pd.to_numeric(df[${py(names[measure.column] ?? "value")}], errors="coerce").where(${mask})`,
      );
      return;
    }
    lines.push(`# “only where” for this measure is not translated: ${measureName(measure, names)}`);
    entries?.push({
      label: `aggregate: “only where” on ${measureName(measure, names)}`,
      status: "manual_step_required",
      note: "this condition shape has no generated mask; apply it manually",
    });
  });

  // Weighted measures: pre-multiply value × weight so the groupby stays a
  // plain named aggregation; the ratio (mean) is computed afterwards.
  measures.forEach((measure, index) => {
    const weighted =
      measure.weight !== undefined &&
      measure.column !== null &&
      (measure.agg === "sum" || measure.agg === "mean");
    if (!weighted) return;
    const x = names[measure.column ?? -1];
    const weight = names[measure.weight ?? -1];
    if (x === undefined || weight === undefined) return;
    lines.push(
      `df["_wx_${index}"] = pd.to_numeric(df[${py(x)}], errors="coerce") * pd.to_numeric(df[${py(weight)}], errors="coerce")`,
    );
  });

  lines.push(`df = df.groupby([${groupExprs.join(", ")}], as_index=False).agg(**{`);
  for (const measure of measures) {
    if (measure.agg === "expr" && measure.expr !== undefined) {
      const compiled = compileExpression(measure.expr, names);
      if (compiled.ok) {
        for (const term of compiled.compiled.terms) {
          const key = termName(term, names);
          helperNames.push(key);
          if (emittedCheck(emitted, key)) continue;
          lines.push(`    ${py(key)}: ${pandasTermTuple(term, names)},`);
        }
      } else {
        lines.push(`    # expression could not be translated: ${measure.expr}`);
        entries?.push({
          label: `aggregate: expression ${measure.expr}`,
          status: "manual_step_required",
          note: "the expression references something the generator cannot name",
        });
      }
      continue;
    }
    const index = measures.indexOf(measure);
    const key = measureName(measure, names);
    const weighted =
      measure.weight !== undefined &&
      measure.column !== null &&
      (measure.agg === "sum" || measure.agg === "mean") &&
      names[measure.weight ?? -1] !== undefined;
    if (weighted) {
      const helper = `_agg_${index}`;
      const weightHelper = `_aggw_${index}`;
      weightedHelpers.push(helper, `_wx_${index}`);
      emittedCheck(emitted, helper);
      lines.push(`    ${py(helper)}: ("_wx_${index}", "sum"),`);
      if (measure.agg === "mean") {
        emittedCheck(emitted, weightHelper);
        lines.push(`    ${py(weightHelper)}: (${py(names[measure.weight ?? -1] ?? "?")}, "sum"),`);
        weightedHelpers.push(weightHelper);
        weightedPost.push(
          `df[${py(key)}] = df[${py(helper)}] / df[${py(weightHelper)}]`,
        );
      } else {
        weightedPost.push(`df[${py(key)}] = df[${py(helper)}]`);
      }
      continue;
    }
    if (emittedCheck(emitted, key)) continue;
    const conditionHelper = conditionHelpers.get(index);
    if (conditionHelper !== undefined) {
      const helper = `_agg_${index}`;
      const method =
        measure.agg === "mean" ? "mean" : measure.agg === "sum" ? "sum" : "count";
      lines.push(`    ${py(helper)}: (${py(conditionHelper)}, "${method}"),`);
      weightedHelpers.push(helper);
      weightedPost.push(`df[${py(key)}] = df[${py(helper)}]`);
      continue;
    }
    lines.push(`    ${py(key)}: ${pandasMeasure(measure, names)},`);
  }
  lines.push("})");

  // Expression measures: compute the arithmetic from the named term columns.
  for (const measure of measures) {
    if (measure.agg !== "expr" || measure.expr === undefined) continue;
    const translated = translateExpression(measure.expr, names);
    if (translated !== null) {
      lines.push(`df[${py(measure.expr)}] = ${translated}`);
    }
  }
  lines.push(...weightedPost);
  const dropped = [
    ...new Set([...helperNames, ...weightedHelpers]),
  ].filter((name) => !simpleNames.has(name) && !weightedHelpers.includes(name));
  if (dropped.length > 0) {
    lines.push(`df = df.drop(columns=[${dropped.map((name) => py(name)).join(", ")}])`);
  }
  if (weightedHelpers.length > 0) {
    lines.push(
      `df = df.drop(columns=[${[...new Set(weightedHelpers)].map((name) => py(name)).join(", ")}])`,
    );
  }

  measures.forEach((measure) => {
    for (const post of measure.post ?? []) {
      const column = target(measureName(measure, names));
      entries?.push({
        label: `aggregate: ${post.op} on ${measureName(measure, names)}`,
        status: "manual_step_required",
        note: "post-aggregation window ops stay comments; apply them after the groupby",
      });
      switch (post.op) {
        case "cumulative":
          lines.push(`# post-aggregation: ${column} = ${column}.cumsum()`);
          break;
        case "rolling":
          lines.push(`# post-aggregation: ${column} = ${column}.rolling(${post.window}).mean()`);
          break;
        case "diff":
          lines.push(`# post-aggregation: ${column} = ${column}.diff()`);
          break;
        case "pctChange":
          lines.push(`# post-aggregation: ${column} = ${column}.pct_change()`);
          break;
        case "pctTotal":
          lines.push(`# post-aggregation: ${column} = ${column} / ${column}.sum()`);
          break;
        case "rank":
          lines.push(`# post-aggregation: ${column} = ${column}.rank(ascending=False)`);
          break;
        case "yoy":
          lines.push(
            `# post-aggregation: ${column} = ${column}.pct_change(periods=12)  # align on the same period last year`,
          );
          break;
      }
    }
  });
  return lines;
}

/** The pandas recipe for one saved view (Copy as pandas in the Views lens). */
export function viewToPandas(view: ViewDef, columnNames: readonly string[]): string {
  const lines = [
    `# View: ${view.name}`,
    ...viewPandasLines(view.dimensions, view.measures, columnNames, view.fill),
  ];
  const pivot = view.pivot;
  const measure = view.measures[0];
  if (pivot !== undefined && pivot > 0 && view.dimensions.length >= 2 && measure !== undefined) {
    const dimRef = (index: number): string => {
      const spec = view.dimensions[index];
      if (spec === undefined) return "?";
      return spec.by === "value"
        ? columnNames[spec.column] ?? `Column ${spec.column + 1}`
        : `_group${index}`;
    };
    if (
      (measure.agg === "sum" && measure.column !== null) ||
      (measure.agg === "count" && measure.column === null)
    ) {
      lines.push(
        `df = df.pivot(index=${py(dimRef(0))}, columns=${py(dimRef(pivot))}, values=${py(measureName(measure, columnNames))}).fillna(0)`,
      );
    } else {
      lines.push(
        `# pivot rendering: df.pivot_table(index=..., columns=..., values=..., aggfunc=...)`,
      );
    }
  }
  if (view.partial === "exclude") {
    lines.push("# incomplete first/last periods were excluded in the app; trim the same edges here");
  }
  return lines.join("\n");
}

function cleanLines(
  name: string,
  ops: readonly CleanOp[],
  entries: SupportEntry[],
): string[] {
  const column = target(name);
  return ops.map((op) => {
    entries.push({ label: `${name}: ${describeCleanOp(op)}`, status: "supported" });
    switch (op.kind) {
      case "trim":
        return `${column} = ${column}.str.strip().str.replace(r"\\s+", " ", regex=True)`;
      case "case": {
        const method = op.style === "title" ? "title" : op.style;
        return `${column} = ${column}.str.${method}()`;
      }
      case "replace":
        if (op.ignoreCase) {
          return `${column} = ${column}.str.replace(r"(?i)${escapeRegex(op.find)}", ${py(op.replacement)}, regex=True)`;
        }
        return `${column} = ${column}.str.replace(${py(op.find)}, ${py(op.replacement)}, regex=False)`;
      case "toNumber":
        if (op.locale === "comma") {
          return `${column} = pd.to_numeric(${column}.str.replace(".", "", regex=False).str.replace(",", ".", regex=False).str.replace(r"[^0-9eE+\\-.]", "", regex=True), errors="coerce")`;
        }
        return `${column} = pd.to_numeric(${column}.str.replace(r"[^0-9eE+\\-.]", "", regex=True), errors="coerce")`;
      case "repairDecimal":
        if (op.locale === "dot") {
          return `${column} = ${column}.astype(str).str.replace(r"^([+-]?\\d{1,3}(?:\\.\\d{3})*),(\\d{1,2})$", r"\\1.\\2", regex=True)`;
        }
        return `${column} = ${column}.astype(str).str.replace(r"^([+-]?\\d{1,3}(?:,\\d{3})*)\\.(\\d{1,2})$", r"\\1,\\2", regex=True)`;
      case "escapeFormulas":
        // Mirrors looksLikeFormula(): =, @, tab and CR always; a leading sign
        // only when the rest is not a plain number.
        return `${column} = ${column}.map(lambda v: ("'" + v) if isinstance(v, str) and v != "" and (v[0] in "=@\\t\\r" or (v[0] in "+-" and v[1:] != "" and not re.fullmatch(r"[0-9.,\\s]+", v[1:]))) else v)`;
      case "toDate":
        return `${column} = pd.to_datetime(${column}, dayfirst=${op.order === "dmy" ? "True" : "False"}, errors="coerce")`;
      case "toDateTime":
        return `${column} = pd.to_datetime(${column}, dayfirst=${op.order === "dmy" ? "True" : "False"}, utc=True, errors="coerce")`;
    }
  });
}

function transformLines(
  transforms: readonly TransformOp[],
  schema: readonly ColumnSchema[],
  entries: SupportEntry[],
): string[] {
  const lines: string[] = [];
  let current = schema.slice();
  for (const op of transforms) {
    const names = current.map((entry) => entry.name);
    const before = entries.length;
    switch (op.kind) {
      case "dedupe": {
        const keep = op.keep === "none" ? "False" : py(op.keep);
        lines.push(`df = df.drop_duplicates(keep=${keep})`);
        break;
      }
      case "drop": {
        const dropped = names[op.column];
        if (dropped === undefined) {
          lines.push("# drop skipped in the script: the column is no longer in the schema");
          entries.push({
            label: `drop: column ${op.column + 1}`,
            status: "manual_step_required",
            note: "the tracked schema no longer has this column",
          });
          break;
        }
        lines.push(`df = df.drop(columns=[${py(dropped)}])`);
        break;
      }
      case "round": {
        const rounded = names[op.column];
        if (rounded === undefined) {
          lines.push("# round skipped in the script: the column is no longer in the schema");
          entries.push({
            label: `round: column ${op.column + 1}`,
            status: "manual_step_required",
            note: "the tracked schema no longer has this column",
          });
          break;
        }
        lines.push(`${target(rounded)} = ${target(rounded)}.round(${op.decimals})`);
        break;
      }
      case "groupBy": {
        const dimensionName = names[op.dimension];
        const measureName = op.measure === null ? null : names[op.measure];
        if (dimensionName === undefined || (op.measure !== null && measureName === undefined)) {
          lines.push("# groupBy skipped in the script: a referenced column is gone");
          entries.push({
            label: `groupBy: column ${op.dimension + 1}${op.measure === null ? "" : ` by ${op.measure + 1}`}`,
            status: "manual_step_required",
            note: "the tracked schema no longer has the referenced columns",
          });
          break;
        }
        const dimension = py(dimensionName);
        const header =
          measureName === null
            ? op.aggregate.charAt(0).toUpperCase() + op.aggregate.slice(1)
            : `${op.aggregate.charAt(0).toUpperCase() + op.aggregate.slice(1)}(${measureName})`;
        if (op.measure === null || op.aggregate === "count") {
          lines.push(`df = df.groupby(${dimension}, as_index=False).size()`);
          lines.push(`df = df.rename(columns={"size": ${py(header)}})`);
        } else {
          const method = op.aggregate === "median" ? "median" : op.aggregate;
          lines.push(`df = df.groupby(${dimension}, as_index=False)[${py(measureName ?? "")}].${method}()`);
          lines.push(`df = df.rename(columns={${py(measureName ?? "")}: ${py(header)}})`);
        }
        break;
      }
      case "impute": {
        const columnName = names[op.column];
        if (columnName === undefined) {
          lines.push("# impute skipped in the script: the column is no longer in the schema");
          entries.push({
            label: `impute: column ${op.column + 1}`,
            status: "manual_step_required",
            note: "the tracked schema no longer has this column",
          });
          break;
        }
        const column = target(columnName);
        switch (op.strategy.kind) {
          case "constant":
            lines.push(`${column} = ${column}.fillna(${py(op.strategy.value)})`);
            break;
          case "mean":
          case "median":
            if (op.groupColumn !== null && names[op.groupColumn] !== undefined) {
              const group = target(names[op.groupColumn]);
              lines.push(
                `${column} = df.groupby(${group})[${py(columnName)}].transform(lambda s: s.fillna(s.${op.strategy.kind}()))`,
              );
            } else {
              lines.push(`${column} = ${column}.fillna(${column}.${op.strategy.kind}())`);
            }
            break;
          case "mode":
            if (op.groupColumn !== null && names[op.groupColumn] !== undefined) {
              const group = target(names[op.groupColumn]);
              lines.push(
                `${column} = df.groupby(${group})[${py(columnName)}].transform(lambda s: s.fillna(s.mode().iloc[0]) if not s.mode().empty else s)`,
              );
              entries.push({
                label: `impute: mode of ${columnName} within ${names[op.groupColumn]}`,
                status: "supported_with_warning",
                note: "pandas picks the smallest mode on ties; TurboFuzz picks the most frequent",
              });
            } else {
              lines.push(`${column} = ${column}.fillna(${column}.mode().iloc[0])`);
            }
            break;
          case "forward":
            lines.push(`${column} = ${column}.ffill()`);
            break;
          case "backward":
            lines.push(`${column} = ${column}.bfill()`);
            break;
        }
        break;
      }
      case "knn": {
        lines.push(
          `# KNN impute ${op.fill.map((index) => names[index]).join(", ")} from ${
            op.predictors.map((index) => names[index]).join(", ") || "no predictors"
          } (k=${op.k}) — use sklearn.impute.KNNImputer`,
        );
        entries.push({
          label: `knn: impute ${op.fill.map((index) => names[index] ?? `column ${index + 1}`).join(", ")} (k=${op.k})`,
          status: "manual_step_required",
          note: "use sklearn.impute.KNNImputer with the generated predictor columns",
        });
        break;
      }
      case "melt": {
        const idVars = op.idVars.filter((index) => names[index] !== undefined);
        const idSet = new Set(idVars);
        const valueVars = (
          op.valueVars.length > 0
            ? op.valueVars
            : names.map((_, index) => index).filter((index) => !idSet.has(index))
        ).filter((index) => names[index] !== undefined);
        const ids = idVars.map((index) => py(names[index])).join(", ");
        const values = valueVars.map((index) => py(names[index])).join(", ");
        const varName = py(op.varName.trim() || "variable");
        const valueName = py(op.valueName.trim() || "value");
        lines.push(
          `df = df.melt(id_vars=[${ids}], value_vars=[${values}], var_name=${varName}, value_name=${valueName})`,
        );
        break;
      }
      case "aggregate": {
        lines.push(...viewPandasLines(op.dimensions, op.measures, names, op.fill ?? "none", entries));
        break;
      }
      case "winsorize": {
        const columnName = names[op.column];
        if (columnName === undefined) {
          lines.push("# winsorize skipped in the script: the column is no longer in the schema");
          entries.push({
            label: `winsorize: column ${op.column + 1}`,
            status: "manual_step_required",
            note: "the tracked schema no longer has this column",
          });
          break;
        }
        const column = target(columnName);
        const q = op.percent / 100;
        lines.push(
          `${column} = pd.to_numeric(${column}, errors="coerce").clip(lower=${column}.quantile(${q}), upper=${column}.quantile(${1 - q}))`,
        );
        break;
      }
      case "flagAnomalies":
        lines.push(
          `# outlier flags for ${names[op.column]} depend on fences computed from the data (robust median/MAD or quantiles); recompute before exporting`,
        );
        entries.push({
          label: `flagAnomalies: ${names[op.column] ?? `column ${op.column + 1}`}`,
          status: "manual_step_required",
          note: "fences come from the data; recompute them or re-run the app's flag action",
        });
        break;
      case "combineDate": {
        const fields = new Map<string, string>();
        const prep: string[] = [];
        let temp = 0;
        const dayfirst = op.order === "dmy" ? "True" : "False";
        op.parts.forEach((part) => {
          const partName = names[part.column];
          if (partName === undefined) {
            prep.push(`# column ${part.column + 1}: no longer in the schema — skipped`);
            entries.push({
              label: `combineDate: column ${part.column + 1}`,
              status: "manual_step_required",
              note: "the tracked schema no longer has this column",
            });
            return;
          }
          if (part.role === "auto") {
            prep.push(`# ${partName}: role auto-detected by TurboFuzz`);
            entries.push({
              label: `combineDate: auto role for ${partName}`,
              status: "manual_step_required",
              note: "re-run auto-detection or state the role explicitly",
            });
            return;
          }
          const source = target(partName);
          switch (part.role) {
            case "year":
            case "month":
            case "day":
            case "hour":
            case "minute":
            case "second":
              fields.set(part.role, source);
              break;
            case "millisecond":
              fields.set("microsecond", `${source}.astype(float).fillna(0) * 1000`);
              break;
            case "meridiem":
              prep.push(`# ${partName}: AM/PM column — merge into the hour before combining`);
              entries.push({
                label: `combineDate: AM/PM column ${partName}`,
                status: "manual_step_required",
                note: "merge the meridian into the hour before combining",
              });
              break;
            case "offset":
              prep.push(`# ${partName}: UTC offset column — use dt.tz_localize after combining`);
              entries.push({
                label: `combineDate: UTC offset column ${partName}`,
                status: "manual_step_required",
                note: "apply the offset with dt.tz_localize after combining",
              });
              break;
            case "epoch": {
              const name = `_part${temp++}`;
              prep.push(`${name} = pd.to_datetime(${source}, unit="s", errors="coerce")`);
              fields.set("year", `${name}.dt.year`);
              fields.set("month", `${name}.dt.month`);
              fields.set("day", `${name}.dt.day`);
              fields.set("hour", `${name}.dt.hour`);
              fields.set("minute", `${name}.dt.minute`);
              fields.set("second", `${name}.dt.second`);
              break;
            }
            default: {
              const name = `_part${temp++}`;
              prep.push(
                `${name} = pd.to_datetime(${source}, errors="coerce", format="mixed", dayfirst=${dayfirst})`,
              );
              if (part.role === "datetime" || part.role === "date") {
                fields.set("year", `${name}.dt.year`);
                fields.set("month", `${name}.dt.month`);
                fields.set("day", `${name}.dt.day`);
              }
              if (part.role === "datetime" || part.role === "time") {
                fields.set("hour", `${name}.dt.hour`);
                fields.set("minute", `${name}.dt.minute`);
                fields.set("second", `${name}.dt.second`);
              }
              break;
            }
          }
        });
        lines.push(...prep);
        const outputName = op.outputName.trim() || (op.output === "date" ? "date" : "datetime");
        const output = target(outputName);
        const dict = [...fields].map(([key, value]) => `${key}=${value}`).join(", ");
        lines.push(`${output} = pd.to_datetime(dict(${dict}), errors="coerce")`);
        if (op.output === "date") {
          lines.push(`${output} = ${output}.dt.date`);
        } else if (op.timeZone.trim() !== "" && op.timeZone.trim().toLowerCase() !== "naive") {
          lines.push(
            `# timezone: offsets found in the data win; otherwise localize the naive values`,
          );
          lines.push(
            `${output} = ${output}.dt.tz_localize(${py(op.timeZone.trim())}, nonexistent="shift_forward", ambiguous="Naive")`,
          );
          entries.push({
            label: `combineDate: timezone ${op.timeZone.trim()}`,
            status: "supported_with_warning",
            note: "offsets already present in the source data win over localisation",
          });
        }
        if (op.dropParts) {
          const droppedParts = [...new Set(op.parts.map((part) => names[part.column]))].filter(
            (partName): partName is string => partName !== undefined && partName !== outputName,
          );
          if (droppedParts.length > 0) {
            lines.push(`df = df.drop(columns=[${droppedParts.map((partName) => py(partName)).join(", ")}])`);
          }
        }
        break;
      }
      case "splitColumn": {
        const sourceName = names[op.column];
        if (sourceName === undefined) {
          lines.push("# split skipped in the script: the column is no longer in the schema");
          entries.push({
            label: `splitColumn: column ${op.column + 1}`,
            status: "manual_step_required",
            note: "the tracked schema no longer has this column",
          });
          break;
        }
        const source = target(sourceName);
        const prefix = op.prefix.trim() === "" ? sourceName : op.prefix.trim();
        if (op.regex) {
          lines.push(`# capture groups of ${py(op.pattern)} become columns`);
          lines.push(`_split = ${source}.str.extract(${py(op.pattern)})`);
        } else {
          lines.push(`_split = ${source}.str.split(${py(op.pattern)}, expand=True)`);
        }
        lines.push(`_split.columns = [f${py(`${prefix}_{i + 1}`)} for i in range(_split.shape[1])]`);
        lines.push(`df = pd.concat([df, _split], axis=1)`);
        if (op.dropOriginal) {
          lines.push(`df = df.drop(columns=[${py(sourceName)}])`);
        }
        if (op.dropEmpty) {
          lines.push(
            "# drop-empty parts are packed per row in TurboFuzz; pandas keeps the split positions",
          );
          entries.push({
            label: `splitColumn: ${sourceName} (drop empty parts)`,
            status: "manual_step_required",
            note: "per-row packing has no direct pandas equivalent; positions are preserved here",
          });
        }
        break;
      }
    }
    if (entries.length === before) {
      entries.push({ label: describeTransformOp(op, names), status: "supported" });
    }
    current = schemaAfter(current, op);
  }
  return lines;
}

/** Per-column missing-value policy lines, applied right after the read. */
function nullPolicyLines(
  nulls: NonNullable<RecipeInput["nulls"]>,
  entries: SupportEntry[],
): string[] {
  const lines: string[] = [];
  for (const { name, extra, keep } of nulls) {
    if (extra.length > 0) {
      lines.push(`${target(name)} = ${target(name)}.replace([${extra.map((token) => py(token)).join(", ")}], pd.NA)`);
      entries.push({
        label: `nulls: treat ${extra.map((token) => `“${token}”`).join(", ")} as missing in “${name}”`,
        status: "supported",
      });
    }
    for (const token of keep) {
      lines.push(
        `# “${name}”: “${token}” stays a value — read with keep_default_na=False and list the real missing tokens of this column in na_values`,
      );
      entries.push({
        label: `nulls: keep “${token}” as a value in “${name}”`,
        status: "manual_step_required",
        note: "the default reader nulls it before the value can be recovered; adjust the reader",
      });
    }
  }
  return lines;
}

/** Logical-type conversions, applied after the value cleans. */
function typeLines(
  types: NonNullable<RecipeInput["types"]>,
  entries: SupportEntry[],
): string[] {
  const lines: string[] = [];
  for (const { name, type } of types) {
    const column = target(name);
    switch (type) {
      case "integer":
      case "number":
        lines.push(`${column} = pd.to_numeric(${column}, errors="coerce")`);
        entries.push({ label: `type: ${name} → ${type}`, status: "supported" });
        break;
      case "date":
        lines.push(`${column} = pd.to_datetime(${column}, errors="coerce").dt.date`);
        entries.push({ label: `type: ${name} → date`, status: "supported" });
        break;
      case "datetime":
        lines.push(`${column} = pd.to_datetime(${column}, errors="coerce")`);
        entries.push({ label: `type: ${name} → datetime`, status: "supported" });
        break;
      case "time":
        lines.push(`${column} = pd.to_datetime(${column}, errors="coerce", format="mixed").dt.time`);
        entries.push({
          label: `type: ${name} → time`,
          status: "supported_with_warning",
          note: "requires pandas 2.0+ for format=\"mixed\"",
        });
        break;
      case "duration":
        lines.push(`${column} = pd.to_timedelta(${column}, errors="coerce")`);
        entries.push({
          label: `type: ${name} → duration`,
          status: "supported_with_warning",
          note: "colon and unit forms parse; verify unusual spellings",
        });
        break;
      case "category":
        lines.push(`${column} = ${column}.astype("category")`);
        entries.push({ label: `type: ${name} → category`, status: "supported" });
        break;
      case "boolean":
        lines.push(
          `# “${name}” was read as boolean; map the source spellings (yes/no, y/n, 1/0) to true/false explicitly`,
        );
        entries.push({
          label: `type: ${name} → boolean`,
          status: "manual_step_required",
          note: "map the exact source spellings",
        });
        break;
      case "identifier":
      case "string":
        lines.push(`# “${name}” stays text; read it with dtype=str if the reader would coerce it`);
        entries.push({
          label: `type: ${name} → ${type}`,
          status: "supported_with_warning",
          note: "read the column as text so leading zeroes survive",
        });
        break;
    }
  }
  return lines;
}

/**
 * Generates a pandas script from the applied steps, plus a per-step support
 * report. Never silently drops a step: anything the generator cannot express
 * appears as a comment and in the report (and the header warning list).
 */
export function pandasRecipeScript(input: RecipeInput): RecipeScript {
  const entries: SupportEntry[] = [];
  const body: string[] = [];

  for (const { name, ops } of input.cleans) {
    if (ops.length === 0) continue;
    body.push("", `# Clean: ${name}`);
    body.push(...cleanLines(name, ops, entries));
  }

  const nulls = input.nulls ?? [];
  if (nulls.length > 0) {
    const lines = nullPolicyLines(nulls, entries);
    if (lines.length > 0) {
      body.push("", "# Missing-value policy");
      body.push(...lines);
    }
  }

  const types = input.types ?? [];
  if (types.length > 0) {
    const lines = typeLines(types, entries);
    if (lines.length > 0) {
      body.push("", "# Logical types");
      body.push(...lines);
    }
  }

  const transforms = transformLines(input.transforms, input.schema, entries);
  if (transforms.length > 0) {
    body.push("", "# Transform");
    body.push(...transforms);
  }

  if ((input.deletedRows ?? 0) > 0) {
    body.push(
      "",
      `# ${input.deletedRows?.toLocaleString()} rows were deleted interactively; they are not in this script`,
    );
    entries.push({
      label: `rows: ${input.deletedRows?.toLocaleString()} deleted`,
      status: "manual_step_required",
      note: "row deletions are data-dependent and cannot be regenerated",
    });
  }

  body.push("", 'df.to_csv("cleaned.csv", index=False)');

  const needsRe = body.some((line) => /\bre\./.test(line));
  const header = [
    "# TurboFuzz pandas recipe — generated from the applied Recipe.",
    "# Requirements: pip install pandas  (pandas >= 2.0 for format=\"mixed\" parsing)",
    "# Input: the app does not record the source file format; point the reader at your data.",
    "# Conventions: date → Python date objects (datetime64, midnight);",
    "#   datetime → datetime64[ns] (naive timestamps are read as UTC);",
    "#   time → Python time; duration → timedelta64.",
    "# Nulls: pandas NaN/NaT; unparseable values become NaN/NaT via errors=\"coerce\".",
    ...supportHeaderLines(entries),
  ];
  const setup = [
    ...(needsRe ? ["import re", ""] : []),
    "import pandas as pd",
    "",
    "# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).",
    'df = pd.read_csv("input.csv")',
  ];
  const code = [...header, "", ...setup, ...body].join("\n");
  return { target: "pandas", code, entries };
}

/** Back-compat wrapper used by the Recipe drawer's Copy button. */
export function pandasRecipe(input: RecipeInput): string {
  return pandasRecipeScript(input).code;
}
