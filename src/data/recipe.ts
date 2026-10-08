import type { CleanOp } from "./clean-ops.js";
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
