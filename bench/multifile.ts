import { ingestFilesAsync } from "../src/worker/ingest.js";
import { count, ms } from "./bench-utils.js";

const sizeArg = process.argv.find((arg) => arg.startsWith("--rows="));
const perFile = Number.parseInt(sizeArg?.slice("--rows=".length) ?? "25000", 10);
const files = [0, 1, 2, 3].map((file) => {
  const lines = ["id,region,amount,when"];
  for (let row = 0; row < perFile; row++) {
    lines.push(`${file * perFile + row},R${row % 8},${(row % 500) + 0.5},2024-01-${String((row % 28) + 1).padStart(2, "0")}`);
  }
  return { name: `file-${file}.csv`, text: lines.join("\n") };
});

const started = performance.now();
const result = await ingestFilesAsync(files, {
  name: "4 files",
  delimiter: "auto",
  hasHeaders: true,
});
const elapsed = performance.now() - started;
const budget = 5000;
const rows = result?.dataset.rowCount ?? 0;
console.log(
  `${elapsed <= budget ? "ok  " : "OVER"} multi-file 4 x ${count(perFile)} rows -> ${count(rows)} rows  ${ms(elapsed)} ms  budget ${budget} ms`,
);
if (result === null || elapsed > budget) process.exitCode = 1;