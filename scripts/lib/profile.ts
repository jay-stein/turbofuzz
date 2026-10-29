import { listLegacySheets, readLegacySheet } from "../../src/parse/xls.js";
import { ingestDataset } from "../../src/worker/ingest.js";
import { computeDQScore, type DQScore } from "../../src/data/score.js";
import { spellingVariants } from "../../src/data/variants.js";
import { skipsSimilarity } from "../../src/data/semantic-type.js";
import { scoreSensitivity, type SensitiveFinding } from "../../src/data/sensitivity.js";
import { embeddedShapes, textProfile } from "../../src/data/text-profile.js";
import type { Dataset } from "../../src/data/dataset.js";
import type { ColumnMeta } from "../../src/worker/protocol.js";

export interface Profile {
  dataset: Dataset;
  metas: ColumnMeta[];
  score: DQScore;
  sensitive: SensitiveFinding[];
  loadMs: number;
}

/**
 * Runs bytes through the app's own ingest, column profiling and scoring (no
 * browser). Mirrors what the worker puts in ColumnMeta, so results match the page.
 */
export async function profileBuffer(
  name: string,
  buffer: ArrayBuffer,
  options: { hasHeaders?: boolean } = {},
): Promise<Profile> {
  const started = performance.now();
  const hasHeaders = options.hasHeaders ?? true;
  let table: { rows: string[][]; hasHeaders: boolean } | undefined;
  if (/\.xls$/i.test(name)) {
    const listing = await listLegacySheets(buffer);
    table = { rows: await readLegacySheet(listing.workbook, listing.sheets[0].name), hasHeaders };
  }
  const { dataset } = ingestDataset({
    name,
    delimiter: "auto",
    hasHeaders,
    ...(table ? { table } : { buffer }),
  });
  const loadMs = performance.now() - started;
  const metas: ColumnMeta[] = dataset.columns.map((column, index) => {
    const profile = dataset.patternProfiles[index] ?? null;
    const built =
      column.type === "category" || column.type === "boolean" ? column.categories() : null;
    return {
      name: column.name,
      type: column.type,
      numberLocale: column.numberLocale,
      dateOrder: column.dateOrder,
      stats: column.stats,
      anomalyCounts: { values: 0, lengths: 0 },
      similarGroups: 0,
      categories: null,
      histogram: null,
      valueFence: null,
      lengthFence: null,
      nullPolicy: { extra: [], keep: [] },
      nullTokens: [...column.nullTokens],
      suggestions: column.suggestions,
      typeDowngrade: column.typeDowngrade,
      conformance: column.conformance,
      dateFormats: column.dateFormats,
      numberSymbols: column.numberSymbols,
      rangeViolation: column.rangeViolation,
      semantic: column.semantic,
      variants: skipsSimilarity(column.semantic)
        ? null
        : built !== null
          ? spellingVariants(built.labels, built.counts)
          : column.type === "string" && column.semantic?.type !== "free_text"
            ? column.spellingVariants()
            : null,
      pattern:
        profile === null
          ? null
          : {
              mask: profile.mask,
              share: profile.share,
              total: profile.total,
              offCount: profile.offCount,
              examples: profile.examples,
            },
    };
  });
  const score = computeDQScore(metas, dataset.stats, dataset.rowCount);
  const sensitive = scoreSensitivity(
    dataset.columns.map((column, index) => {
      const textual = column.type === "string" || column.type === "category" || column.type === "identifier";
      const profiled = textual ? textProfile(column.raw, column.nullMask, 1, false) : null;
      const present = dataset.rowCount - column.stats.nulls;
      return {
        column: index,
        name: column.name,
        type: column.type,
        semantic: column.semantic,
        shapes: profiled?.shapes ?? null,
        sampled: profiled?.rows ?? 0,
        scanned: present,
        embedded:
          profiled !== null && profiled.avgLength > 40 ? embeddedShapes(column.raw, column.nullMask) : null,
      };
    }),
  );
  return { dataset, metas, score, sensitive, loadMs };
}

/** What a flag in expect.json can point at. */
export type FlagKind =
  | "variants" // case/space spelling variants of one value
  | "validity" // cells failing the column's type or format
  | "sentinel" // value that probably means missing (see `value`)
  | "convert" // an offer to convert the column to another type
  | "empty" // column with no values, left out of the score
  | "formula" // formula-like cells (export safety)
  | "sensitive"; // possibly sensitive column; `value` is the class

export interface Flag {
  kind: FlagKind;
  column: string;
  /** For sentinel: the value, e.g. "0" or "-9". */
  value?: string;
  /** Minimum affected cells/rows; flags below it do not count. */
  min?: number;
  /** For sensitive flags: high, medium or low. */
  confidence?: string;
}

/** Every flag the current code raises, in the same vocabulary as expect.json. */
export function raisedFlags(profile: Profile): Flag[] {
  const flags: Flag[] = [];
  const { metas, score } = profile;
  for (const check of score.dimensions.flatMap((d) => d.checks)) {
    const column = check.column === null ? null : metas[check.column]?.name;
    if (column === null || column === undefined || check.fail === 0) continue;
    if (check.id.startsWith("validity.")) flags.push({ kind: "validity", column, min: check.fail });
    if (check.id.startsWith("consistency.variants.")) {
      flags.push({ kind: "variants", column, min: check.fail });
    }
    if (check.convertTo !== undefined) flags.push({ kind: "convert", column });
  }
  for (const meta of metas) {
    for (const suggestion of meta.suggestions) {
      if (suggestion.kind === "sentinel") {
        flags.push({ kind: "sentinel", column: meta.name, value: suggestion.value, min: suggestion.count });
      } else if (suggestion.kind === "formula") {
        flags.push({ kind: "formula", column: meta.name, min: suggestion.count });
      } else if (suggestion.kind === "number" || suggestion.kind === "date") {
        flags.push({ kind: "convert", column: meta.name });
      }
    }
    if (meta.typeDowngrade != null) flags.push({ kind: "convert", column: meta.name });
  }
  for (const finding of profile.sensitive) {
    flags.push({ kind: "sensitive", column: finding.name, value: finding.class, confidence: finding.confidence });
  }
  for (const empty of score.emptyColumns) flags.push({ kind: "empty", column: empty.name });
  return flags;
}

/** Does any raised flag satisfy this expectation? */
export function matchesFlag(raised: readonly Flag[], expected: Flag): boolean {
  return raised.some(
    (flag) =>
      flag.kind === expected.kind &&
      flag.column === expected.column &&
      (expected.value === undefined || flag.value === expected.value) &&
      (expected.confidence === undefined || flag.confidence === expected.confidence) &&
      (expected.min === undefined || flag.min === undefined || flag.min >= expected.min),
  );
}
