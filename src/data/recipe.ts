import type { CleanOp } from "./clean-ops.js";
import { compileExpression, type ExprTerm, type DimensionSpec, type MeasureSpec, type ViewDef } from "./aggregate.js";
import { schemaAfter, type ColumnSchema, type TransformOp } from "./transform-ops.js";

export interface RecipeInput {
  cleans: readonly { name: string; ops: readonly CleanOp[] }[];
  transforms: readonly TransformOp[];
  /** Schema as authored before the transform steps. */
  schema: readonly ColumnSchema[];
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
): string[] {
  const lines: string[] = [];
  const groupExprs = dimensions.map((spec, index) => {
    const name = names[spec.column] ?? `Column ${spec.column + 1}`;
    const by = spec.by;
    if (typeof by === "object" && "time" in by) {
      const temp = `_group${index}`;
      lines.push(
        `${temp} = pd.to_datetime(df[${py(name)}]).dt.to_period(${py(PERIOD[by.time] ?? "D")}).dt.to_timestamp()`,
      );
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
      }
    }
  });
  return lines;
}

/** The pandas recipe for one saved view (Copy as pandas in the Views lens). */
export function viewToPandas(view: ViewDef, columnNames: readonly string[]): string {
  const lines = [
    `# View: ${view.name}`,
    ...viewPandasLines(view.dimensions, view.measures, columnNames),
  ];
  return lines.join("\n");
}

function cleanLines(name: string, ops: readonly CleanOp[]): string[] {
  const column = target(name);
  return ops.map((op) => {
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
        return `# escape leading =, @, + or - so spreadsheet apps treat the cell as text`;
      case "toDate":
        return `${column} = pd.to_datetime(${column}, dayfirst=${op.order === "dmy" ? "True" : "False"}, errors="coerce")`;
    }
  });
}

function transformLines(
  transforms: readonly TransformOp[],
  schema: readonly ColumnSchema[],
): string[] {
  const lines: string[] = [];
  let current = schema.slice();
  for (const op of transforms) {
    const names = current.map((entry) => entry.name);
    switch (op.kind) {
      case "dedupe": {
        const keep = op.keep === "none" ? "False" : py(op.keep);
        lines.push(`df = df.drop_duplicates(keep=${keep})`);
        break;
      }
      case "drop":
        lines.push(`df = df.drop(columns=[${py(names[op.column])}])`);
        break;
      case "round":
        lines.push(`${target(names[op.column])} = ${target(names[op.column])}.round(${op.decimals})`);
        break;
      case "groupBy": {
        const dimension = py(names[op.dimension]);
        const measureName = op.measure === null ? null : names[op.measure];
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
        const column = target(names[op.column]);
        const within =
          op.groupColumn !== null
            ? ` groupby ${target(names[op.groupColumn])}`
            : "";
        switch (op.strategy.kind) {
          case "constant":
            lines.push(`${column} = ${column}.fillna(${py(op.strategy.value)})`);
            break;
          case "mean":
          case "median":
            if (op.groupColumn !== null) {
              const group = target(names[op.groupColumn]);
              lines.push(
                `${column} = df.groupby(${group})[${py(names[op.column])}].transform(lambda s: s.fillna(s.${op.strategy.kind}()))`,
              );
            } else {
              lines.push(`${column} = ${column}.fillna(${column}.${op.strategy.kind}())`);
            }
            break;
          case "mode":
            if (op.groupColumn !== null) {
              lines.push(
                `# Mode within ${within}: ${names[op.column]} — fill per group with the most frequent value`,
              );
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
      case "knn":
        lines.push(
          `# KNN impute ${op.fill.map((index) => names[index]).join(", ")} from ${
            op.predictors.map((index) => names[index]).join(", ") || "no predictors"
          } (k=${op.k}) — use sklearn.impute.KNNImputer`,
        );
        break;
      case "melt": {
        const idVars = op.idVars.map((index) => py(names[index])).join(", ");
        const valueVars = op.valueVars.map((index) => py(names[index])).join(", ");
        const varName = py(op.varName.trim() || "variable");
        const valueName = py(op.valueName.trim() || "value");
        lines.push(
          `df = df.melt(id_vars=[${idVars}], value_vars=[${valueVars}], var_name=${varName}, value_name=${valueName})`,
        );
        break;
      }
      case "aggregate": {
        lines.push(...viewPandasLines(op.dimensions, op.measures, names));
        break;
      }
      case "combineDate": {
        const fields = new Map<string, string>();
        const prep: string[] = [];
        let temp = 0;
        const dayfirst = op.order === "dmy" ? "True" : "False";
        op.parts.forEach((part) => {
          if (part.role === "auto") {
            prep.push(`# ${names[part.column]}: role auto-detected by TurboFuzz`);
            return;
          }
          const source = target(names[part.column]);
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
              prep.push(`# ${names[part.column]}: AM/PM column — merge into the hour before combining`);
              break;
            case "offset":
              prep.push(`# ${names[part.column]}: UTC offset column — use dt.tz_localize after combining`);
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
        const output = target(op.outputName.trim() || (op.output === "date" ? "date" : "datetime"));
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
        }
        break;
      }
      case "splitColumn": {
        const sourceName = names[op.column];
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
        break;
      }
    }
    current = schemaAfter(current, op);
  }
  return lines;
}

/**
 * Generates a pandas script from the applied steps. This is a best-effort
 * translation for sharing and reproducibility; KNN imputation is emitted as a
 * comment because it needs scikit-learn.
 */
export function pandasRecipe(input: RecipeInput): string {
  const lines: string[] = [
    "import pandas as pd",
    "",
    'df = pd.read_csv("your-file.csv")  # adjust to your source',
  ];

  for (const { name, ops } of input.cleans) {
    if (ops.length === 0) continue;
    lines.push("", `# Clean: ${name}`);
    lines.push(...cleanLines(name, ops));
  }

  const transforms = transformLines(input.transforms, input.schema);
  if (transforms.length > 0) {
    lines.push("", "# Transform");
    lines.push(...transforms);
  }

  lines.push("", 'df.to_csv("cleaned.csv", index=False)');
  return lines.join("\n");
}
