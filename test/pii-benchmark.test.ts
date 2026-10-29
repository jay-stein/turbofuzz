import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { scansForSensitivity, scoreSensitivity, type ColumnSensitivityInput } from "../src/data/sensitivity.js";
import { embeddedShapes, textProfile } from "../src/data/text-profile.js";
import { buildCorpus } from "./fixtures/pii-corpus.js";

function toInputs(table: { name: string; values: string[] }[]): ColumnSensitivityInput[] {
  return table.map(({ name, values }, column) => {
    const data = ColumnData.create(name, values);
    const textual = scansForSensitivity(data.type, name);
    const profile = textual ? textProfile(values, data.nullMask, 1, false) : null;
    return {
      column,
      name,
      type: data.type,
      semantic: data.semantic,
      shapes: profile?.shapes ?? null,
      sampled: profile?.rows ?? 0,
      scanned: values.length - data.stats.nulls,
      embedded: profile !== null && profile.avgLength > 40 ? embeddedShapes(values, data.nullMask) : null,
    };
  });
}

/** Precision and recall at a confidence cut: "high" counts only High, "any" counts every flag. */
function measure(cut: "high" | "any") {
  const corpus = buildCorpus();
  const findings = scoreSensitivity(toInputs(corpus));
  const flagged = new Set(findings.filter((f) => cut === "any" || f.confidence === "high").map((f) => f.name));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const falsePositives: string[] = [];
  const misses: string[] = [];
  for (const column of corpus) {
    // High-confidence recall is judged on the classes that can reach High at all.
    if (cut === "high" && column.advisory === true) continue;
    const hit = flagged.has(column.name);
    if (hit && column.sensitive) tp++;
    else if (hit) {
      fp++;
      falsePositives.push(column.name);
    } else if (column.sensitive) {
      fn++;
      misses.push(column.name);
    }
  }
  return { tp, fp, fn, precision: tp + fp === 0 ? 1 : tp / (tp + fp), recall: tp + fn === 0 ? 1 : tp / (tp + fn), falsePositives, misses };
}

test("PII benchmark: High-confidence precision and recall meet the targets, with no High false positives", () => {
  const high = measure("high");
  const any = measure("any");
  const corpus = buildCorpus();
  console.log(
    [
      "PII benchmark (seeded corpus)",
      `columns: ${corpus.length} (${corpus.filter((c) => c.sensitive).length} sensitive, ${corpus.filter((c) => !c.sensitive).length} hard negatives)`,
      "cut        precision  recall   TP  FP  FN",
      `High only  ${high.precision.toFixed(3)}      ${high.recall.toFixed(3)}    ${String(high.tp).padStart(2)}  ${String(high.fp).padStart(2)}  ${String(high.fn).padStart(2)}`,
      `Any flag   ${any.precision.toFixed(3)}      ${any.recall.toFixed(3)}    ${String(any.tp).padStart(2)}  ${String(any.fp).padStart(2)}  ${String(any.fn).padStart(2)}`,
      `High false positives: ${high.falsePositives.join(", ") || "none"}`,
      `Missed by High: ${high.misses.join(", ") || "none"}`,
    ].join("\n"),
  );
  assert.deepEqual(high.falsePositives, [], "no High false positives on the hard negatives");
  assert.ok(high.recall >= 0.9, `High recall ${high.recall.toFixed(3)} >= 0.90 (missed: ${high.misses.join(", ")})`);
  assert.ok(high.precision >= 0.95, `High precision ${high.precision.toFixed(3)} >= 0.95`);
  assert.ok(any.recall >= 0.9, `recall at any confidence ${any.recall.toFixed(3)} >= 0.90 (missed: ${any.misses.join(", ")})`);
});
