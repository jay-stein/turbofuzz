import { buildDataset, rebuildDataset } from "../src/data/build.js";
import { ColumnData } from "../src/data/column.js";
import { applyCleanOps, applyCleanOpsIncremental, type CleanOp } from "../src/data/clean-ops.js";
import { count, measure, ms } from "./bench-utils.js";
import { generateDataset } from "./data.js";

interface Case {
  label: string;
  budgetMs: number;
  run: () => void;
}

const sizeArgs = process.argv.find((arg) => arg.startsWith("--sizes="));
const sizes = (sizeArgs?.slice("--sizes=".length) ?? "100000,300000")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);
const iterationsArg = process.argv.find((arg) => arg.startsWith("--iterations="));
const iterations = Number.parseInt(iterationsArg?.slice("--iterations=".length) ?? "5", 10);

const NAMES = [
  "customer_name",
  "company",
  "suburb",
  "state",
  "annual_usage",
  "year",
  "install_date",
  "status",
  "nmi",
  "solar",
] as const;
const trimUpper: CleanOp[] = [{ kind: "trim" }, { kind: "case", style: "upper" }];

function makeRows(size: number): { headers: string[]; rows: string[][] } {
  const generated = generateDataset(size, 42);
  const headers = [...NAMES];
  const rows = new Array<string[]>(size);
  for (let row = 0; row < size; row++) {
    rows[row] = headers.map((name) => generated.columns[name][row] ?? "");
  }
  return { headers, rows };
}

function cleanCase(size: number, columnsToClean: number): Case {
  const { headers, rows } = makeRows(size);
  const current = buildDataset("clean-bench", headers, rows);
  const source = current.columns.map((column) => column);
  const affected = Array.from({ length: Math.min(columnsToClean, source.length) }, (_, index) => index);
  const label =
    columnsToClean === 1
      ? `${count(size)} rows - trim + uppercase one column`
      : `${count(size)} rows - trim + uppercase ${affected.length} columns`;
  return {
    label,
    budgetMs: size >= 300000 ? 600 : columnsToClean > 1 ? 2000 : 250,
    run: () => {
      const columns = current.columns.slice();
      for (const index of affected) {
        const old = source[index];
        const opApplied = applyCleanOpsIncremental(
          current.columns[index].raw,
          old.raw,
          [],
          trimUpper,
        );
        columns[index] = ColumnData.create(old.name, opApplied.values, old.nullPolicy, old.numberLocale, {
          type: old.type,
          skipSuggestions: true,
          dateOrder: old.dateOrder,
          numberLocale: old.numberLocale,
        });
      }
      rebuildDataset(current, columns, affected);
    },
  };
}

function undoCase(size: number): Case {
  const { headers, rows } = makeRows(size);
  const current = buildDataset("clean-undo-bench", headers, rows);
  const source = current.columns[0];
  const applied = applyCleanOps(source.raw, trimUpper);
  const cleaned = ColumnData.create(source.name, applied, source.nullPolicy, source.numberLocale, {
    type: source.type,
    skipSuggestions: true,
  });
  return {
    label: `${count(size)} rows - clear a completed clean (full replay)`,
    budgetMs: 250,
    run: () => {
      const columns = current.columns.slice();
      columns[0] = cleaned;
      const rebuilt = rebuildDataset(current, columns, [0]);
      const reverted = current.columns.slice();
      reverted[0] = ColumnData.create(
        source.name,
        current.columns[0].raw,
        source.nullPolicy,
        source.numberLocale,
        { type: source.type, skipSuggestions: true },
      );
      rebuildDataset(rebuilt, reverted, [0]);
    },
  };
}

let failed = false;
for (const size of sizes) {
  const cases = [cleanCase(size, 1)];
  if (size <= 100000) cases.push(cleanCase(size, 10), undoCase(size));
  for (const item of cases) {
    const timing = measure(item.run, { iterations, warmup: 1 });
    const status = timing.p95 <= item.budgetMs ? "ok" : "OVER";
    if (status === "OVER") failed = true;
    console.log(
      `${status.padEnd(4)} ${item.label.padEnd(58)} p50 ${ms(timing.p50)} ms  p95 ${ms(timing.p95)} ms  budget ${item.budgetMs} ms`,
    );
  }
}
if (failed) process.exitCode = 1;