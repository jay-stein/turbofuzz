import { describeCleanOp, type CleanOp } from "./clean-ops.js";
import { FORMULA_PRELUDE, formulaPython } from "./formula-export.js";
import {
  compileExpression,
  type ExprTerm,
  type DimensionSpec,
  type MeasureSpec,
} from "./aggregate.js";
import {
  schemaAfter,
  freeColumnName,
  describeTransformOp,
  type TransformOp,
} from "./transform-ops.js";
import {
  supportHeaderLines,
  type RecipeScript,
  type SupportEntry,
} from "./recipe-support.js";
import type { RecipeInput } from "./recipe.js";
import { polarsDateExpr } from "../parse/date-format.js";

function py(value: string): string {
  return JSON.stringify(value);
}

function col(name: string): string {
  return `pl.col(${py(name)})`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const GRAIN_INTERVAL: Record<string, string> = {
  minute: "1m",
  hour: "1h",
  day: "1d",
  week: "1w",
  month: "1mo",
  quarter: "1q",
  year: "1y",
};

const POLARS_AGG: Record<string, string> = {
  sum: "sum",
  mean: "mean",
  min: "min",
  max: "max",
  median: "median",
  stddev: "std",
  variance: "var",
  first: "first",
  last: "last",
  distinct: "n_unique",
};

function captureGroupCount(source: string): number {
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === "(" && source[i + 1] !== "?") count++;
  }
  return count;
}

/** `df = df.with_columns(expr.alias("name"))` for one column update. */
function assign(expression: string, name: string): string {
  return `df = df.with_columns(${expression}.alias(${py(name)}))`;
}

function polarsCleanLines(
  name: string,
  ops: readonly CleanOp[],
  entries: SupportEntry[],
): string[] {
  const column = col(name);
  return ops.map((op) => {
    entries.push({ label: `${name}: ${describeCleanOp(op)}`, status: "supported" });
    switch (op.kind) {
      case "trim":
        return assign(`${column}.str.strip_chars().str.replace_all(r"\\s+", " ")`, name);
      case "case": {
        const method =
          op.style === "title"
            ? "to_titlecase"
            : op.style === "upper"
              ? "to_uppercase"
              : "to_lowercase";
        return assign(`${column}.str.${method}()`, name);
      }
      case "replace":
        if (op.ignoreCase) {
          return assign(
            `${column}.str.replace_all(${py(`(?i)${escapeRegex(op.find)}`)}, ${py(op.replacement)})`,
            name,
          );
        }
        return assign(`${column}.str.replace_all(${py(op.find)}, ${py(op.replacement)}, literal=True)`, name);
      case "toNumber": {
        const base =
          op.locale === "comma"
            ? `${column}.str.replace_all(".", "", literal=True).str.replace_all(",", ".", literal=True)`
            : column;
        return assign(
          `${base}.str.replace_all(r"[^0-9eE+\\-.]", "").cast(pl.Float64, strict=False)`,
          name,
        );
      }
      case "repairDecimal": {
        // Runtime replaces only values written in the other convention; the
        // regex mirrors the pandas generator's anchored pattern.
        const pattern =
          op.locale === "dot"
            ? String.raw`^([+-]?\d{1,3}(?:\.\d{3})*),(\d{1,2})$`
            : String.raw`^([+-]?\d{1,3}(?:,\d{3})*)\.(\d{1,2})$`;
        const replacement = op.locale === "dot" ? "${1}.${2}" : "${1},${2}";
        return assign(`${column}.str.replace_all(${py(pattern)}, ${py(replacement)})`, name);
      }
      case "escapeFormulas": {
        const text = `${column}.cast(pl.Utf8, strict=False)`;
        return [
          `df = df.with_columns(`,
          `    pl.when(`,
          `        ${text}.str.contains(r"^[=@\\t\\r]")`,
          `        | (`,
          `            ${text}.str.contains(r"^[+-]")`,
          `            & (${text}.str.len_chars() > 1)`,
          `            & ~${text}.str.contains(r"^[+-][0-9.,\\s]+$")`,
          `        )`,
          `    )`,
          `    .then("'" + ${text})`,
          `    .otherwise(${column})`,
          `    .alias(${py(name)})`,
          `)`,
        ].join("\n");
      }
      case "recode":
        return [
          `_tf_recode = {${op.pairs.map(([from, to]) => `${py(from)}: ${py(to)}`).join(", ")}}`,
          assign(
            `${column}.map_elements(lambda v: _tf_recode.get(v.strip(), v) if v is not None else v, return_dtype=pl.Utf8)`,
            name,
          ),
        ].join("\n");
      case "mask":
        entries[entries.length - 1] = {
          ...entries[entries.length - 1],
          status: "manual_step_required",
          note: "TurboFuzz also leaves missing-value markers (N/A, null) unmasked; the generated function only skips blanks",
        };
        return [
          "def _tf_mask(v, first, last):",
          "    if v is None or v.strip() == \"\":",
          "        return v",
          "    s = v.strip()",
          "    at = s.rfind(\"@\")",
          "    if at > 0:",
          "        return s[:max(1, first)] + \"***\" + s[at:]",
          "    if len(s) <= first + last:",
          "        return \"*\" * len(s)",
          "    return s[:first] + \"*\" * min(8, max(3, len(s) - first - last)) + (s[-last:] if last > 0 else \"\")",
          assign(
            `${column}.map_elements(lambda v: _tf_mask(v, ${op.keepFirst}, ${op.keepLast}), return_dtype=pl.Utf8)`,
            name,
          ),
        ].join("\n");
      case "hash":
        entries[entries.length - 1] = {
          ...entries[entries.length - 1],
          status: "manual_step_required",
          note: "TurboFuzz also leaves missing-value markers (N/A, null) unhashed; the generated code only skips blanks",
        };
        return [
          "import hashlib",
          assign(
            `${column}.map_elements(lambda v: hashlib.sha256((${py(op.salt)} + "\\x00" + v.strip()).encode("utf-8")).hexdigest()[:16] if v is not None and v.strip() != "" else v, return_dtype=pl.Utf8)`,
            name,
          ),
        ].join("\n");
      case "toDate":
      case "toDateTime": {
        const { expr, review } = polarsDateExpr(column, op.order, op.kind === "toDateTime" ? ", time_zone=\"UTC\"" : "");
        if (review !== null) entries[entries.length - 1] = { ...entries[entries.length - 1], status: "manual_step_required", note: review };
        return assign(expr, name);
      }
      case "cast":
        entries[entries.length - 1] = {
          ...entries[entries.length - 1],
          status: "manual_step_required",
          note: `cast to ${op.target} (${op.policy}) needs manual review`,
        };
        return `# cast ${column} to ${op.target} (${op.policy}) - review the conversion manually`;
    }
  });
}

function polarsNullLines(
  nulls: NonNullable<RecipeInput["nulls"]>,
  entries: SupportEntry[],
): string[] {
  const lines: string[] = [];
  for (const { name, extra, keep } of nulls) {
    if (extra.length > 0) {
      lines.push(
        `df = df.with_columns(pl.when(${col(name)}.is_in([${extra.map((token) => py(token)).join(", ")}])).then(None).otherwise(${col(name)}).alias(${py(name)}))`,
      );
      entries.push({
        label: `nulls: treat ${extra.map((token) => `“${token}”`).join(", ")} as missing in “${name}”`,
        status: "supported",
      });
    }
    for (const token of keep) {
      lines.push(
        `# “${name}”: “${token}” stays a value — read with null_values=[] and list the real missing tokens for this column`,
      );
      entries.push({
        label: `nulls: keep “${token}” as a value in “${name}”`,
        status: "manual_step_required",
        note: "the default reader maps it to null before the value can be recovered; adjust the reader",
      });
    }
  }
  return lines;
}

function polarsTypeLines(
  types: NonNullable<RecipeInput["types"]>,
  entries: SupportEntry[],
): string[] {
  const lines: string[] = [];
  for (const { name, type } of types) {
    const column = col(name);
    switch (type) {
      case "integer":
        lines.push(assign(`${column}.cast(pl.Int64, strict=False)`, name));
        entries.push({ label: `type: ${name} → integer`, status: "supported" });
        break;
      case "number":
        lines.push(assign(`${column}.cast(pl.Float64, strict=False)`, name));
        entries.push({ label: `type: ${name} → number`, status: "supported" });
        break;
      case "date":
        lines.push(assign(`${column}.str.to_datetime(strict=False).dt.date()`, name));
        entries.push({ label: `type: ${name} → date`, status: "supported" });
        break;
      case "datetime":
        lines.push(assign(`${column}.str.to_datetime(strict=False)`, name));
        entries.push({ label: `type: ${name} → datetime`, status: "supported" });
        break;
      case "time":
        lines.push(assign(`${column}.str.to_time(strict=False)`, name));
        entries.push({ label: `type: ${name} → time`, status: "supported" });
        break;
      case "duration":
        lines.push(assign(`${column}.str.to_duration(strict=False)`, name));
        entries.push({
          label: `type: ${name} → duration`,
          status: "supported_with_warning",
          note: "ISO 8601 and humantime durations parse; verify app-style spellings",
        });
        break;
      case "category":
        lines.push(assign(`${column}.cast(pl.Categorical)`, name));
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
        lines.push(`# “${name}” stays text; read the column with schema_overrides={${py(name)}: pl.Utf8}`);
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

function polarsMeasureExpression(measure: MeasureSpec, names: readonly string[]): string | null {
  const source = measure.column === null ? null : names[measure.column];
  if (measure.column !== null && source === undefined) return null;
  if (measure.agg === "count") {
    return source === undefined || source === null ? "pl.len()" : `${col(source)}.count()`;
  }
  if (source === undefined || source === null) return null;
  if (measure.agg === "mode") return `${col(source)}.mode().first()`;
  const percentile = /^p(\d+(?:\.\d+)?)$/.exec(measure.agg);
  if (percentile !== null) return `${col(source)}.quantile(${Number(percentile[1]) / 100})`;
  const method = POLARS_AGG[measure.agg];
  return method === undefined ? null : `${col(source)}.${method}()`;
}

function polarsTermExpression(term: ExprTerm, names: readonly string[]): string | null {
  const source = term.column === null ? null : names[term.column];
  if (term.column !== null && source === undefined) return null;
  if (term.agg === "count") {
    return source === undefined || source === null ? "pl.len()" : `${col(source)}.count()`;
  }
  if (source === undefined || source === null) return null;
  if (term.agg === "mode") return `${col(source)}.mode().first()`;
  const percentile = /^p(\d+(?:\.\d+)?)$/.exec(term.agg);
  if (percentile !== null) return `${col(source)}.quantile(${Number(percentile[1]) / 100})`;
  const method = POLARS_AGG[term.agg];
  return method === undefined ? null : `${col(source)}.${method}()`;
}

/** Rewrites `sum(amount)` inside an expression to a reference of the agg column. */
function translateExpressionPolars(expr: string, names: readonly string[]): string | null {
  let failed = false;
  const translated = expr.replace(
    /(p\d+(?:\.\d+)?|[a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([^)]*?)\s*\)/g,
    (match, fn: string, arg: string) => {
      const name = fn.toLowerCase();
      const known =
        ["count", "distinct", "sum", "mean", "min", "max", "median", "stddev", "variance", "first", "last", "mode"].includes(name) ||
        /^p\d+(?:\.\d+)?$/.test(name);
      if (!known) {
        failed = true;
        return match;
      }
      if (arg === "*" || arg === "") return col("count(*)");
      const index = names.indexOf(arg);
      if (index < 0) {
        failed = true;
        return match;
      }
      return col(`${name}(${names[index]})`);
    },
  );
  return failed ? null : translated;
}

function measureKey(measure: MeasureSpec, names: readonly string[]): string {
  if (measure.agg === "expr") return measure.expr ?? "expr";
  const source = measure.column === null ? null : names[measure.column];
  return source === undefined || source === null ? "count(*)" : `${measure.agg}(${source})`;
}

/** Polars equivalents of viewPandasLines for aggregate transforms. */
function polarsAggregateLines(
  dimensions: readonly DimensionSpec[],
  measures: readonly MeasureSpec[],
  names: readonly string[],
  fill: "none" | "zero" | "carry",
  entries: SupportEntry[],
): string[] {
  const lines: string[] = [];
  const pre: string[] = [];

  if (fill !== "none") {
    lines.push(
      `# empty periods: ${fill === "carry" ? "carried forward" : "filled with zero"} — join the group axis to a complete calendar before the post steps`,
    );
    entries.push({
      label: `aggregate: fill empty periods (${fill === "carry" ? "carry forward" : "zero"})`,
      status: "manual_step_required",
      note: "the group axis is not completed in the generated code",
    });
  }

  const groupKeys: string[] = [];
  const groupExprs = dimensions.map((spec, index) => {
    const name = names[spec.column] ?? `Column ${spec.column + 1}`;
    const by = spec.by;
    if (typeof by === "object" && "time" in by) {
      const temp = `_group${index}`;
      if (by.fiscalStartMonth !== undefined && by.fiscalStartMonth !== 1) {
        lines.push(`# fiscal year starts in month ${by.fiscalStartMonth}: re-label Y/Q buckets after the group_by`);
        entries.push({
          label: `aggregate: fiscal year starts month ${by.fiscalStartMonth}`,
          status: "supported_with_warning",
          note: "calendar Y/Q labels need re-labelling for the fiscal calendar",
        });
      }
      if (by.tz !== undefined && by.tz.trim() !== "") {
        lines.push(
          `# timezone ${by.tz}: convert timestamps before truncating, e.g. ${col(name)}.str.to_datetime(strict=False).dt.convert_time_zone(${py(by.tz)})`,
        );
        entries.push({
          label: `aggregate: timezone ${by.tz}`,
          status: "supported_with_warning",
          note: "convert the timestamp column to the zone before the group_by",
        });
      }
      if (by.time === "week" && by.weekStart === 0) {
        entries.push({
          label: "aggregate: weeks start Sunday",
          status: "supported_with_warning",
          note: "Polars weeks start Monday; shift the bucket labels",
        });
      }
      const width = by.every !== undefined && Number.isFinite(by.every) && by.every >= 2 ? Math.floor(by.every) : 1;
      const interval = (GRAIN_INTERVAL[by.time] ?? "1d").replace(/^1/, String(width));
      lines.push(
        `${col(name)}.str.to_datetime(strict=False).dt.truncate(${py(interval)}).alias(${py(temp)})`,
      );
      groupKeys.push(temp);
      return temp;
    }
    if (typeof by === "object" && ("cohort" in by || "since" in by)) {
      const spec2 = "cohort" in by ? by.cohort : by.since;
      const entity = names[spec2.entity] ?? `Column ${spec2.entity + 1}`;
      lines.push(
        `# cohort/period-since: first period per ${entity} needs a window expression — see the TurboFuzz aggregate view`,
      );
      entries.push({
        label: `aggregate: ${"cohort" in by ? "cohort" : `periods since first ${entity}`}`,
        status: "manual_step_required",
        note: "compute the entity's first period as pl.col.min().over(entity) before truncating",
      });
      groupKeys.push(`_group${index}`);
      return `_group${index}`;
    }
    if (typeof by === "object" && "datePart" in by) {
      const temp = `_group${index}`;
      const base = `${col(name)}.str.to_datetime(strict=False).dt`;
      const accessor =
        by.datePart === "dow"
          ? "weekday() - 1"
          : by.datePart === "hour"
            ? "hour()"
            : by.datePart === "month"
              ? "month()"
              : by.datePart === "dom"
                ? "day()"
                : "week()";
      lines.push(`${base}.${accessor}.alias(${py(temp)})`);
      groupKeys.push(temp);
      return temp;
    }
    if (typeof by === "object" && "bin" in by) {
      const temp = `_group${index}`;
      if ("edges" in by.bin) {
        lines.push(`${col(name)}.cut([${by.bin.edges.join(", ")}]).alias(${py(temp)})`);
      } else if ("width" in by.bin) {
        lines.push(
          `_edges${index} = [df[${py(name)}].min() + i * ${by.bin.width} for i in range(int((df[${py(name)}].max() - df[${py(name)}].min()) / ${by.bin.width}) + 2)]`,
        );
        lines.push(`${col(name)}.cut(_edges${index}).alias(${py(temp)})`);
        entries.push({
          label: `aggregate: equal-width bins of ${by.bin.width}`,
          status: "supported_with_warning",
          note: "bin edges derive from the data minimum; fixed data required",
        });
      } else {
        lines.push(`${col(name)}.qcut(${by.bin.n}).alias(${py(temp)})`);
        entries.push({
          label: `aggregate: quantile bins (${by.bin.n})`,
          status: "supported_with_warning",
          note: "duplicate edges raise in Polars; allow_duplicates may be needed on tied data",
        });
      }
      groupKeys.push(temp);
      return temp;
    }
    groupKeys.push(name);
    return col(name);
  });

  const weighted: { helper: string; weightHelper: string | null; key: string }[] = [];
  const aggs: string[] = [];
  const emitted = new Set<string>();
  measures.forEach((measure, index) => {
    const key = measureKey(measure, names);
    if (emitted.has(key)) return;
    emitted.add(key);
    if (measure.agg === "expr" && measure.expr !== undefined) {
      const compiled = compileExpression(measure.expr, names);
      if (compiled.ok) {
        for (const term of compiled.compiled.terms) {
          const termKey = term.column === null ? "count(*)" : `${term.agg}(${names[term.column]})`;
          if (emitted.has(termKey)) continue;
          emitted.add(termKey);
          const expression = polarsTermExpression(term, names);
          if (expression !== null) aggs.push(`${expression}.alias(${py(termKey)})`);
        }
      } else {
        lines.push(`# expression could not be translated: ${measure.expr}`);
        entries.push({
          label: `aggregate: expression ${measure.expr}`,
          status: "manual_step_required",
          note: "the expression references something the generator cannot name",
        });
      }
      return;
    }

    const where = measure.where;
    const source = measure.column === null ? null : names[measure.column];
    if (where !== undefined) {
      const whereName = names[where.column];
      let mask: string | null = null;
      if (whereName !== undefined) {
        if (where.isNull === true) mask = `${col(whereName)}.is_null()`;
        else if (where.values !== undefined) {
          mask = `${col(whereName)}.is_in([${where.values.map((value) => py(value)).join(", ")}])`;
        } else {
          const numeric = `${col(whereName)}.cast(pl.Float64, strict=False)`;
          const parts: string[] = [];
          if (where.min !== undefined) parts.push(`${numeric} >= ${where.min}`);
          if (where.max !== undefined) parts.push(`${numeric} <= ${where.max}`);
          mask = parts.length === 0 ? "True" : parts.join(" & ");
        }
      }
      if (mask !== null && measure.agg === "count" && measure.column === null) {
        aggs.push(`pl.when(${mask}).then(1).otherwise(0).sum().alias(${py(key)})`);
        return;
      }
      if (mask !== null && (measure.agg === "sum" || measure.agg === "mean") && source !== undefined && source !== null) {
        aggs.push(`pl.when(${mask}).then(${col(source)}).otherwise(None).${measure.agg}().alias(${py(key)})`);
        return;
      }
      lines.push(`# “only where” for this measure is not translated: ${key}`);
      entries.push({
        label: `aggregate: “only where” on ${key}`,
        status: "manual_step_required",
        note: "this condition shape has no generated mask; apply it manually",
      });
      return;
    }

    const weightName = measure.weight === undefined ? undefined : names[measure.weight];
    if (
      measure.weight !== undefined &&
      source !== undefined &&
      source !== null &&
      weightName !== undefined &&
      (measure.agg === "sum" || measure.agg === "mean")
    ) {
      const helper = `_agg_${index}`;
      const helperExpr = `(${col(source)}.cast(pl.Float64, strict=False) * ${col(weightName)}.cast(pl.Float64, strict=False))`;
      pre.push(`df = df.with_columns(${helperExpr}.alias(${py(`_wx_${index}`)}))`);
      if (measure.agg === "mean") {
        const weightHelper = `_aggw_${index}`;
        aggs.push(`${col(`_wx_${index}`)}.sum().alias(${py(helper)})`);
        aggs.push(`${col(weightName)}.cast(pl.Float64, strict=False).sum().alias(${py(weightHelper)})`);
        weighted.push({ helper, weightHelper, key });
      } else {
        aggs.push(`${col(`_wx_${index}`)}.sum().alias(${py(helper)})`);
        weighted.push({ helper, weightHelper: null, key });
      }
      return;
    }

    const expression = polarsMeasureExpression(measure, names);
    if (expression === null) {
      lines.push(`# measure skipped in the script: ${key}`);
      entries.push({
        label: `aggregate: ${key}`,
        status: "manual_step_required",
        note: "a referenced column is gone from the tracked schema",
      });
      return;
    }
    aggs.push(`${expression}.alias(${py(key)})`);
  });

  lines.push(...pre);
  lines.push(`df = df.group_by([${groupExprs.join(", ")}]).agg([`);
  lines.push(...aggs.map((agg) => `    ${agg},`));
  lines.push(`])`);
  if (groupKeys.length > 0) {
    // Polars group_by keeps encounter order; sort to match the app's ascending
    // group order (pandas groupby sorts by keys by default).
    lines.push(`df = df.sort(${py(groupKeys[0])})`);
  }

  for (const measure of measures) {
    if (measure.agg !== "expr" || measure.expr === undefined) continue;
    const translated = translateExpressionPolars(measure.expr, names);
    if (translated !== null) {
      lines.push(`df = df.with_columns(${translated}.alias(${py(measure.expr)}))`);
    }
  }

  let droppedHelpers = weighted.flatMap((entry) =>
    entry.weightHelper === null ? [entry.helper, entry.key] : [entry.helper, entry.weightHelper, entry.key],
  );
  for (const entry of weighted) {
    const left = entry.weightHelper === null ? col(entry.helper) : `${col(entry.helper)} / ${col(entry.weightHelper)}`;
    lines.push(`df = df.with_columns((${left}).alias(${py(entry.key)}))`);
  }
  droppedHelpers = [...new Set(droppedHelpers)].filter((name) => !names.includes(name));
  if (droppedHelpers.length > 0) {
    lines.push(`df = df.drop([${droppedHelpers.map((name) => py(name)).join(", ")}])`);
  }

  measures.forEach((measure) => {
    for (const post of measure.post ?? []) {
      const key = measureKey(measure, names);
      entries.push({
        label: `aggregate: ${post.op} on ${key}`,
        status: "manual_step_required",
        note: "post-aggregation window ops stay comments; apply them after the group_by",
      });
      const column = col(key);
      switch (post.op) {
        case "cumulative":
          lines.push(`# post-aggregation: ${key} = cum_sum(${column})`);
          break;
        case "rolling":
          lines.push(`# post-aggregation: ${key} = rolling_mean(${column}, window_size=${post.window})`);
          break;
        case "diff":
          lines.push(`# post-aggregation: ${key} = diff(${column})`);
          break;
        case "pctChange":
          lines.push(`# post-aggregation: ${key} = pct_change(${column})`);
          break;
        case "pctTotal":
          lines.push(`# post-aggregation: ${key} = ${column} / ${column}.sum()`);
          break;
        case "rank":
          lines.push(`# post-aggregation: ${key} = rank(descending=True)`);
          break;
        case "yoy":
          lines.push(`# post-aggregation: ${key} = pct_change over 12 periods — align on the same period last year`);
          break;
      }
    }
  });
  return lines;
}

function polarsTransformLines(
  transforms: readonly TransformOp[],
  schema: RecipeInput["schema"],
  entries: SupportEntry[],
): string[] {
  const lines: string[] = [];
  let current = schema.slice();
  let formulaHelpers = false;
  let formulaCount = 0;
  for (const op of transforms) {
    const names = current.map((entry) => entry.name);
    const before = entries.length;
    switch (op.kind) {
      case "dedupe": {
        const keep = op.keep === "none" ? "None" : py(op.keep);
        lines.push(`df = df.unique(keep=${keep}, maintain_order=True)`);
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
        lines.push(`df = df.drop(${py(dropped)})`);
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
        lines.push(assign(`${col(rounded)}.round(${op.decimals})`, rounded));
        if (op.decimals < 0) {
          entries.push({
            label: `round: ${rounded} to ${op.decimals} decimals`,
            status: "supported_with_warning",
            note: "negative rounding may be unsupported by Polars; verify",
          });
        }
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
        const header =
          measureName === null
            ? op.aggregate.charAt(0).toUpperCase() + op.aggregate.slice(1)
            : `${op.aggregate.charAt(0).toUpperCase() + op.aggregate.slice(1)}(${measureName})`;
        if (op.measure === null || op.aggregate === "count") {
          lines.push(`df = df.group_by(${py(dimensionName)}).agg(pl.len().alias(${py(header)}))`);
        } else {
          lines.push(
            `df = df.group_by(${py(dimensionName)}).agg(${col(measureName ?? "")}.${op.aggregate}().alias(${py(header)}))`,
          );
        }
        lines.push(`df = df.sort(${py(dimensionName)})`);
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
        const groupName = op.groupColumn === null ? undefined : names[op.groupColumn];
        const within = groupName === undefined ? "" : `.over(${py(groupName)})`;
        switch (op.strategy.kind) {
          case "constant":
            lines.push(assign(`${col(columnName)}.fill_null(${py(op.strategy.value)})`, columnName));
            break;
          case "mean":
          case "median":
            lines.push(
              assign(
                `${col(columnName)}.fill_null(${col(columnName)}.${op.strategy.kind}()${within})`,
                columnName,
              ),
            );
            break;
          case "mode":
            if (groupName !== undefined) {
              lines.push(
                assign(
                  `${col(columnName)}.fill_null(${col(columnName)}.mode().sort().first().over(${py(groupName)}))`,
                  columnName,
                ),
              );
              entries.push({
                label: `impute: mode of ${columnName} within ${groupName}`,
                status: "supported_with_warning",
                note: "Polars picks the smallest mode on ties; TurboFuzz picks the most frequent",
              });
            } else {
              lines.push(assign(`${col(columnName)}.fill_null(${col(columnName)}.mode().sort().first())`, columnName));
            }
            break;
          case "forward":
            lines.push(assign(`${col(columnName)}.forward_fill()`, columnName));
            break;
          case "backward":
            lines.push(assign(`${col(columnName)}.backward_fill()`, columnName));
            break;
        }
        break;
      }
      case "knn": {
        lines.push(
          `# KNN impute ${op.fill.map((index) => names[index]).join(", ")} from ${
            op.predictors.map((index) => names[index]).join(", ") || "no predictors"
          } (k=${op.k}) — no Polars builtin; use the same neighbour logic or scikit-learn`,
        );
        entries.push({
          label: `knn: impute ${op.fill.map((index) => names[index] ?? `column ${index + 1}`).join(", ")} (k=${op.k})`,
          status: "manual_step_required",
          note: "Polars has no KNNImputer; translate the neighbour logic explicitly",
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
        lines.push(
          `df = df.unpivot(index=[${ids}], on=[${values}], variable_name=${py(op.varName.trim() || "variable")}, value_name=${py(op.valueName.trim() || "value")})`,
        );
        break;
      }
      case "aggregate": {
        lines.push(...polarsAggregateLines(op.dimensions, op.measures, names, op.fill ?? "none", entries));
        break;
      }
      case "clip": {
        const columnName = names[op.column];
        if (columnName === undefined) {
          lines.push("# clip skipped in the script: the column is no longer in the schema");
          entries.push({
            label: `clip: column ${op.column + 1}`,
            status: "manual_step_required",
            note: "the tracked schema no longer has this column",
          });
          break;
        }
        if (op.outside === "limit") {
          lines.push(
            assign(
              `${col(columnName)}.clip(${op.min ?? "None"}, ${op.max ?? "None"})`,
              columnName,
            ),
          );
        } else {
          const outside = [
            ...(op.min === null ? [] : [`(${col(columnName)} < ${op.min})`]),
            ...(op.max === null ? [] : [`(${col(columnName)} > ${op.max})`]),
          ].join(" | ");
          lines.push(
            assign(
              `pl.when(${outside === "" ? "pl.lit(False)" : outside}).then(None).otherwise(${col(columnName)})`,
              columnName,
            ),
          );
        }
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
        const q = op.percent / 100;
        lines.push(
          assign(
            `${col(columnName)}.clip(${col(columnName)}.quantile(${q}), ${col(columnName)}.quantile(${1 - q}))`,
            columnName,
          ),
        );
        break;
      }
      case "derive": {
        const code = formulaPython(op.formula, current.map((c) => ({ name: c.name, type: c.type ?? (c.numeric ? "number" : "string") })));
        if (code === null) {
          lines.push(`# new column ${JSON.stringify(op.name)}: its formula no longer reads against these columns; add it by hand`);
          entries.push({ label: `derive: ${op.name}`, status: "manual_step_required", note: `formula ${op.formula} does not compile here` });
          break;
        }
        if (!formulaHelpers) {
          lines.push(...FORMULA_PRELUDE);
          formulaHelpers = true;
        }
        const fn = `_f${++formulaCount}`;
        const name = freeColumnName(op.name, names);
        const at = Math.max(0, Math.min(op.at, names.length));
        lines.push(`# new column ${JSON.stringify(name)} = ${op.formula.replace(/\n/g, " ")}`, `def ${fn}(r):`, `    return ${code.expr}`, `df = df.insert_column(${at}, pl.Series(${py(name)}, _derive(df.iter_rows(named=True), ${fn}, ${py(code.type)}), dtype=pl.Utf8))`);
        entries.push({ label: `derive: ${name}`, status: "supported" });
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
        const fields: { role: string; expr: string }[] = [];
        const prep: string[] = [];
        let usesDay = false;
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
          switch (part.role) {
            case "auto":
              prep.push(`# ${partName}: role auto-detected by TurboFuzz`);
              entries.push({
                label: `combineDate: auto role for ${partName}`,
                status: "manual_step_required",
                note: "re-run auto-detection or state the role explicitly",
              });
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
              prep.push(`# ${partName}: UTC offset column — adjust the time zone after combining`);
              entries.push({
                label: `combineDate: UTC offset column ${partName}`,
                status: "manual_step_required",
                note: "apply the offset with the time-zone argument after combining",
              });
              break;
            case "year":
            case "month":
            case "day":
            case "hour":
            case "minute":
            case "second":
              if (part.role === "day") usesDay = true;
              fields.push({
                role: part.role,
                expr: `${col(partName)}.cast(pl.Int32, strict=False)`,
              });
              break;
            case "millisecond":
              fields.push({
                role: "microsecond",
                expr: `${col(partName)}.cast(pl.Int32, strict=False) * 1000`,
              });
              break;
            case "epoch":
              fields.push({
                role: "__epoch",
                expr: `pl.from_epoch(${col(partName)}.cast(pl.Int64, strict=False), time_unit="s")`,
              });
              break;
            case "date":
            case "datetime":
              fields.push({
                role: "__stamp",
                expr: `${col(partName)}.str.to_datetime(strict=False)`,
              });
              break;
            case "time":
              prep.push(`# ${partName}: time-only column — split into hour/minute/second before combining`);
              entries.push({
                label: `combineDate: time column ${partName}`,
                status: "manual_step_required",
                note: "extract hour/minute/second with dt accessors before combining",
              });
              break;
          }
        });
        const hasStamp = fields.some((field) => field.role === "__stamp" || field.role === "__epoch");
        const hasParts =
          fields.some((field) => field.role === "year") &&
          fields.some((field) => field.role === "month");
        lines.push(...prep);
        const outputName = op.outputName.trim() || (op.output === "date" ? "date" : "datetime");
        if (!hasStamp && !hasParts) {
          lines.push(
            `# combineDate output ${py(outputName)}: needs year and month parts (or a full timestamp part) — build it explicitly`,
          );
          entries.push({
            label: `combineDate: output ${outputName}`,
            status: "manual_step_required",
            note: "year and month parts (or a full timestamp role) are required",
          });
          break;
        }
        const stamp = fields.find((field) => field.role === "__stamp" || field.role === "__epoch");
        let expression: string;
        if (stamp !== undefined) {
          expression = stamp.expr;
        } else {
          const args: string[] = [
            `year=${(fields.find((field) => field.role === "year") as { expr: string }).expr}`,
            `month=${(fields.find((field) => field.role === "month") as { expr: string }).expr}`,
          ];
          args.push(
            usesDay
              ? `day=${(fields.find((field) => field.role === "day") as { expr: string }).expr}`
              : "day=1",
          );
          for (const role of ["hour", "minute", "second", "microsecond"]) {
            const field = fields.find((entry) => entry.role === role);
            if (field !== undefined) args.push(`${role}=${field.expr}`);
          }
          const zone =
            op.timeZone.trim() !== "" && op.timeZone.trim().toLowerCase() !== "naive"
              ? `, time_zone=${py(op.timeZone.trim())}`
              : "";
          expression = `pl.datetime(${args.join(", ")}${zone})`;
        }
        if (op.output === "date") {
          lines.push(assign(`${expression}.dt.date()`, outputName));
        } else {
          lines.push(assign(expression, outputName));
          if (op.timeZone.trim() !== "" && op.timeZone.trim().toLowerCase() !== "naive") {
            entries.push({
              label: `combineDate: timezone ${op.timeZone.trim()}`,
              status: "supported_with_warning",
              note: "source offsets in the data win over the time-zone argument",
            });
          }
        }
        if (op.dropParts) {
          const droppedParts = [...new Set(op.parts.map((part) => names[part.column]))].filter(
            (partName): partName is string => partName !== undefined && partName !== outputName,
          );
          if (droppedParts.length > 0) {
            lines.push(`df = df.drop([${droppedParts.map((partName) => py(partName)).join(", ")}])`);
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
        const prefix = op.prefix.trim() === "" ? sourceName : op.prefix.trim();
        const groups = op.regex ? captureGroupCount(op.pattern) : 0;
        if (op.regex && groups > 0) {
          lines.push(`_split = [`);
          for (let i = 1; i <= groups; i++) {
            lines.push(
              `    ${col(sourceName)}.str.extract(r${py(op.pattern)}, group_index=${i}).alias(f${py(`${prefix}_{i}`)}),`,
            );
          }
          lines.push(`]`);
          lines.push(`df = df.with_columns(_split)`);
          entries.push({
            label: `splitColumn: ${sourceName} (regex, ${groups} group${groups === 1 ? "" : "s"})`,
            status: "supported_with_warning",
            note: "new columns are appended at the end of the frame",
          });
        } else if (!op.regex) {
          lines.push(`_split = ${col(sourceName)}.str.split(${py(op.pattern)})`);
          lines.push(
            `_split_width = int(df[${py(sourceName)}].str.split(${py(op.pattern)}).list.len().max() or 0)`,
          );
          lines.push(`_split_fields = [f${py(`${prefix}_{i + 1}`)} for i in range(_split_width)]`);
          lines.push(
            `df = df.with_columns(_split.list.to_struct(fields=_split_fields).alias("_split"))`,
          );
          lines.push(`df = df.unnest("_split")`);
          entries.push({
            label: `splitColumn: ${sourceName}`,
            status: "supported_with_warning",
            note: "new columns are appended at the end of the frame",
          });
        } else {
          lines.push(
            `# regex split without capture groups: use ${col(sourceName)}.str.split(...) per match or extract groups`,
          );
          entries.push({
            label: `splitColumn: ${sourceName} (regex, no groups)`,
            status: "manual_step_required",
            note: "switch to capture groups or split explicitly",
          });
        }
        if (op.dropOriginal) {
          lines.push(`df = df.drop(${py(sourceName)})`);
        }
        if (op.dropEmpty) {
          lines.push(
            "# drop-empty parts are packed per row in TurboFuzz; Polars keeps the split positions",
          );
          entries.push({
            label: `splitColumn: ${sourceName} (drop empty parts)`,
            status: "manual_step_required",
            note: "per-row packing has no direct Polars equivalent; positions are preserved here",
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

/**
 * Generates an idiomatic Polars script from the applied steps, plus the same
 * per-step support report the pandas generator produces. Native pl.Date /
 * pl.Datetime / pl.Time / pl.Duration are used; naive timestamps stay naive.
 */
export function polarsRecipeScript(input: RecipeInput): RecipeScript {
  const entries: SupportEntry[] = [];
  const body: string[] = [];

  for (const { name, ops } of input.cleans) {
    if (ops.length === 0) continue;
    body.push("", `# Clean: ${name}`);
    body.push(...polarsCleanLines(name, ops, entries));
  }

  const nulls = input.nulls ?? [];
  if (nulls.length > 0) {
    const lines = polarsNullLines(nulls, entries);
    if (lines.length > 0) {
      body.push("", "# Missing-value policy");
      body.push(...lines);
    }
  }

  const types = input.types ?? [];
  if (types.length > 0) {
    const lines = polarsTypeLines(types, entries);
    if (lines.length > 0) {
      body.push("", "# Logical types");
      body.push(...lines);
    }
  }

  const transforms = polarsTransformLines(input.transforms, input.schema, entries);
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

  body.push("", 'df.write_csv("cleaned.csv")');

  const header = [
    "# TurboFuzz Polars recipe — generated from the applied Recipe.",
    "# Requirements: pip install polars  (polars >= 1.0)",
    "# Input: the app does not record the source file format; point the reader at your data.",
    "# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);",
    "#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).",
    ...supportHeaderLines(entries),
  ];
  const setup = [
    "import polars as pl",
    "",
    "# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).",
    'df = pl.read_csv("input.csv")',
  ];
  const code = [...header, "", ...setup, ...body].join("\n");
  return { target: "polars", code, entries };
}
