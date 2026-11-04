import type { ViewDef } from "./aggregate.js";
import type { CleanOp } from "./clean-ops.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { Rule } from "./rules.js";
import type { TransformOp } from "./transform-ops.js";
import type { ColumnType } from "../types.js";

/**
 * A workspace file: everything done to a table, in order, plus the pivot views,
 * charts, filters and checks built on it, so opening it beside the same data file
 * brings the page back to the state it was saved in. Plain JSON, columns by name,
 * no data inside. Steps made before a transform are kept in their own phase so the
 * order of clean, transform, clean again is replayed as it happened.
 */
export const WORKSPACE_KIND = "turbofuzz-workspace";
export const WORKSPACE_VERSION = 1;

export interface WorkspaceNullPolicy {
  name: string;
  extra: string[];
  keep: string[];
}

/** Cleans, missing-value and type changes made between two transforms. */
export interface PipelineBatch {
  cleans: { name: string; ops: CleanOp[] }[];
  nulls: WorkspaceNullPolicy[];
  types: { name: string; type: ColumnType }[];
}

/** A batch of steps, then the transforms that ran on top of it (a clean after a transform starts the next phase). */
export interface PipelinePhase extends PipelineBatch {
  transforms: TransformOp[];
}

export interface WorkspacePipeline {
  /** Oldest first: each phase's batch, then its transforms. */
  phases: PipelinePhase[];
  /** Steps made after the last phase's transforms. */
  after: PipelineBatch;
  archetype?: string;
}

export interface WorkspaceTable {
  filters: { column: string; filter: ColumnFilter }[];
  sort: { column: string; dir: 1 | -1; reversed: boolean } | null;
  hidden: string[];
  frozenThrough: string | null;
}

export interface WorkspaceFile {
  kind: typeof WORKSPACE_KIND;
  version: typeof WORKSPACE_VERSION;
  savedAt: string;
  /** What the data file was when it was loaded: the replay checks it and warns on a difference. */
  data: { name: string; columns: string[]; rows: number | null };
  pipeline: WorkspacePipeline;
  /** Dataset row ids removed by hand after the last transform. */
  removedRows: number[];
  /** Rows removed by hand before a transform cannot be replayed; how many were lost. */
  removedRowsLost: number;
  mode: "general" | "research";
  view: string;
  table: WorkspaceTable;
  views: { columns: string[]; defs: ViewDef[]; active: number } | null;
  /** Chart cards by column name, in tab order. */
  charts: unknown[] | null;
  quality: {
    rules: Rule[];
    reviewed: Record<string, { rows: number; title: string }>;
    optional: Record<string, boolean>;
  };
}

export function emptyBatch(): PipelineBatch {
  return { cleans: [], nulls: [], types: [] };
}

export function batchIsEmpty(batch: PipelineBatch): boolean {
  return batch.cleans.length === 0 && batch.nulls.length === 0 && batch.types.length === 0;
}

/** Reads and checks a workspace file; throws a sentence a person can act on. */
export function parseWorkspaceFile(text: string): WorkspaceFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON, so it cannot be a workspace.");
  }
  if (raw === null || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== WORKSPACE_KIND) {
    throw new Error("That file is not a TurboFuzz workspace (a recipe file opens from Recipe → Replay recipe).");
  }
  const file = raw as WorkspaceFile;
  if (file.version !== WORKSPACE_VERSION) {
    throw new Error(`This workspace is version ${String(file.version)}; this app reads version ${WORKSPACE_VERSION}.`);
  }
  if (file.pipeline === undefined || file.pipeline.after === undefined) {
    throw new Error("The workspace is missing its steps.");
  }
  return {
    ...file,
    removedRows: Array.isArray(file.removedRows) ? file.removedRows : [],
    removedRowsLost: typeof file.removedRowsLost === "number" ? file.removedRowsLost : 0,
    table: file.table ?? { filters: [], sort: null, hidden: [], frozenThrough: null },
    quality: file.quality ?? { rules: [], reviewed: {}, optional: {} },
    pipeline: { ...file.pipeline, phases: Array.isArray(file.pipeline.phases) ? file.pipeline.phases : [] },
  };
}

/** The columns a workspace expects and the data file does not have, in the saved order. */
export function missingColumns(file: WorkspaceFile, current: readonly string[]): string[] {
  const have = new Set(current);
  return file.data.columns.filter((name) => !have.has(name));
}

/** Sentences about how far the data file in hand differs from the one the workspace was saved on (empty when it matches). */
export function dataWarnings(file: WorkspaceFile, current: readonly string[], rows: number): string[] {
  const out: string[] = [];
  const missing = missingColumns(file, current);
  if (missing.length > 0) {
    out.push(`This data has no column ${missing.length === 1 ? `“${missing[0]}”` : `${missing.slice(0, 4).map((name) => `“${name}”`).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}`} that the workspace uses: steps on ${missing.length === 1 ? "it" : "them"} are skipped.`);
  }
  if (file.data.rows !== null && file.data.rows !== rows) {
    out.push(`The workspace was saved on ${file.data.rows.toLocaleString()} rows; this data has ${rows.toLocaleString()}. Results will differ.`);
  }
  if (file.removedRowsLost > 0) {
    out.push(`${file.removedRowsLost.toLocaleString()} row${file.removedRowsLost === 1 ? "" : "s"} removed by hand before a transform cannot be replayed.`);
  }
  return out;
}
