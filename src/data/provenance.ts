/**
 * Where a data-quality report's numbers came from, so the report can be audited and the run
 * repeated: which file (and its SHA-256), how it was read, what was done to the table since it
 * was read, the settings that move the score, and which build of the tool computed it.
 * Everything here is worked out in the browser; only names, counts and settings appear, never a
 * cell value.
 */

// Injected by the build (vite.config.ts); absent when the code runs outside it, as in the unit tests.
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
/** The commit the build was made from ("+" marks uncommitted changes), or null when unknown. */
export const APP_BUILD: string | null = typeof __APP_BUILD__ === "string" && __APP_BUILD__ !== "" ? __APP_BUILD__ : null;

/** Files above this are not fingerprinted: reading one a second time would double the memory it uses. */
export const HASH_LIMIT_BYTES = 512 * 1024 * 1024;
export const PROVENANCE_VERSION = 1;
/** Steps listed in a report before "and N more". */
const STEP_LABEL_LIMIT = 60;

export interface ProvenanceFile {
  name: string;
  /** Size in bytes as chosen; null when unknown. */
  bytes: number | null;
  /** The file's own last-modified time, ISO 8601 UTC, when the browser gave one. */
  modified: string | null;
  /** SHA-256 of the bytes as read, lower-case hex; null when it could not be worked out (see `hashNote`). */
  sha256: string | null;
  hashNote: string | null;
}

export interface ReportProvenance {
  version: number;
  source: {
    kind: "file" | "files" | "pasted text" | "built-in sample";
    files: ProvenanceFile[];
    /** The archive entry or worksheet the rows came from, when the file held several. */
    inside: string | null;
  };
  read: {
    encoding: string | null;
    delimiter: string | null;
    /** The delimiter was picked by the person, not detected. */
    delimiterChosen: boolean;
    /** How the header row was found, in words. */
    header: string;
    rows: number;
    columns: number;
    /** Set when only part of the file was loaded, e.g. "first 200,000 rows of ≈1,234,567". */
    sampled: string | null;
    /** Words and symbols counted as missing everywhere (n/a, null, -…). */
    missingWords: string[];
    /** Columns where the person added to or removed from that list. */
    columnOverrides: { column: string; counted: string[]; kept: string[] }[];
  };
  /** What happened to the table between loading and this report. */
  changes: {
    steps: number;
    labels: string[];
    rows: number;
    columns: number;
  };
  /** The choices that move the score. */
  scoring: {
    scoreVersion: number;
    weights: Record<string, number>;
    weightsAreDefault: boolean;
    bands: { good: number; fair: number };
    optionalColumns: string[];
    reviewedChecks: number;
    freshness: string | null;
    rules: number;
  };
  tool: { name: string; version: string; build: string | null };
}

/** SHA-256 as lower-case hex; throws where the browser has no crypto (an insecure page). */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error("No crypto in this context");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface Fingerprint {
  sha256: string | null;
  note: string | null;
}

/**
 * SHA-256 of the bytes `read` returns, or why there is none: too large, unreadable a second
 * time, a different size from when it was loaded (so a hash would describe other data), or
 * no crypto here. `expected` is the size recorded when the file was chosen.
 */
export async function fingerprintBytes(read: () => Promise<ArrayBuffer>, expected: number | null): Promise<Fingerprint> {
  if (expected !== null && expected > HASH_LIMIT_BYTES) {
    return { sha256: null, note: `larger than ${HASH_LIMIT_BYTES / 1024 / 1024} MB, so not fingerprinted` };
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await read();
  } catch {
    return { sha256: null, note: "the file could not be read again after loading (it may have moved or changed)" };
  }
  if (expected !== null && buffer.byteLength !== expected) {
    return { sha256: null, note: "the file's size changed after loading, so a fingerprint would not describe the data that was read" };
  }
  try {
    return { sha256: await sha256Hex(buffer), note: null };
  } catch {
    return { sha256: null, note: "this browser cannot fingerprint on an insecure page" };
  }
}

export interface ProvenanceInput {
  kind: ReportProvenance["source"]["kind"];
  files: ProvenanceFile[];
  inside: string | null;
  encoding: string | null;
  delimiter: string | null;
  delimiterChosen: boolean;
  header: string;
  rowsRead: number;
  columnsRead: number;
  sampled: string | null;
  missingWords: readonly string[];
  columnOverrides: { column: string; counted: string[]; kept: string[] }[];
  steps: readonly string[];
  rowsNow: number;
  columnsNow: number;
  scoreVersion: number;
  weights: Record<string, number>;
  defaultWeights: Record<string, number>;
  bands: { good: number; fair: number };
  optionalColumns: readonly string[];
  reviewedChecks: number;
  freshness: string | null;
  rules: number;
  tool: { version: string; build: string | null };
}

export function buildProvenance(input: ProvenanceInput): ReportProvenance {
  const more = input.steps.length - STEP_LABEL_LIMIT;
  return {
    version: PROVENANCE_VERSION,
    source: { kind: input.kind, files: input.files, inside: input.inside },
    read: {
      encoding: input.encoding,
      delimiter: input.delimiter,
      delimiterChosen: input.delimiterChosen,
      header: input.header,
      rows: input.rowsRead,
      columns: input.columnsRead,
      sampled: input.sampled,
      missingWords: [...input.missingWords],
      columnOverrides: input.columnOverrides,
    },
    changes: {
      steps: input.steps.length,
      labels: more > 0 ? [...input.steps.slice(0, STEP_LABEL_LIMIT), `…and ${more.toLocaleString("en")} more`] : [...input.steps],
      rows: input.rowsNow,
      columns: input.columnsNow,
    },
    scoring: {
      scoreVersion: input.scoreVersion,
      weights: input.weights,
      weightsAreDefault: Object.keys(input.defaultWeights).every((key) => input.weights[key] === input.defaultWeights[key]),
      bands: input.bands,
      optionalColumns: [...input.optionalColumns],
      reviewedChecks: input.reviewedChecks,
      freshness: input.freshness,
      rules: input.rules,
    },
    tool: { name: "TurboFuzz", ...input.tool },
  };
}

/** "44,000,000 bytes (41.9 MB)": exact for a checksum comparison, readable for a person. */
export function sizeText(bytes: number | null): string {
  if (bytes === null) return "size unknown";
  const readable = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : null;
  return `${bytes.toLocaleString("en")} bytes${readable === null ? "" : ` (${readable})`}`;
}

/**
 * The provenance as label and value pairs, in reading order: what the Markdown and HTML reports print.
 * The JSON report carries the full structure instead.
 */
export function provenanceRows(p: ReportProvenance): [string, string][] {
  const rows: [string, string][] = [];
  const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
  rows.push(["Source", p.source.kind === "files" ? `${count(p.source.files.length, "file")} appended into one table` : p.source.kind]);
  for (const file of p.source.files) {
    rows.push([p.source.files.length > 1 ? `File ${file.name}` : "File", [file.name, sizeText(file.bytes), file.modified === null ? null : `modified ${file.modified}`].filter((part) => part !== null).join(" · ")]);
    rows.push([p.source.files.length > 1 ? `SHA-256 of ${file.name}` : "SHA-256", file.sha256 ?? `not computed: ${file.hashNote ?? "unavailable"}`]);
  }
  if (p.source.inside !== null) rows.push(["Read from inside it", p.source.inside]);
  const delimiter = p.read.delimiter === null ? null : `${p.read.delimiter}-separated (${p.read.delimiterChosen ? "chosen" : "detected"})`;
  rows.push(["Read as", [p.read.encoding, delimiter, `header: ${p.read.header}`].filter((part) => part !== null).join(" · ")]);
  rows.push(["Rows read", `${count(p.read.rows, "row")} × ${count(p.read.columns, "column")}${p.read.sampled === null ? "" : ` · only part of the file: ${p.read.sampled}`}`]);
  const examples = p.read.missingWords.filter((word) => /[a-z]/i.test(word)).slice(0, 8).join(", ");
  rows.push(["Counted as missing", `${p.read.missingWords.length.toLocaleString("en")} built-in words and symbols such as ${examples}, and empty cells`]);
  for (const override of p.read.columnOverrides) {
    const parts = [override.counted.length > 0 ? `also counts ${override.counted.join(", ")} as missing` : null, override.kept.length > 0 ? `keeps ${override.kept.join(", ")} as real values` : null].filter((part) => part !== null);
    rows.push([`Missing-value rule for ${override.column}`, parts.join("; ")]);
  }
  rows.push([
    "Changes since loading",
    p.changes.steps === 0
      ? `none: this is the table as read (${count(p.changes.rows, "row")} × ${count(p.changes.columns, "column")})`
      : `${count(p.changes.steps, "step")}, so this report describes ${count(p.changes.rows, "row")} × ${count(p.changes.columns, "column")}, not the file as it arrived: ${p.changes.labels.join("; ")}`,
  ]);
  const weights = Object.entries(p.scoring.weights).map(([key, weight]) => `${key} ${weight}`).join(", ");
  rows.push(["Score", `version ${p.scoring.scoreVersion} · weights ${weights} (${p.scoring.weightsAreDefault ? "default" : "customised"}) · bands good from ${p.scoring.bands.good}, fair from ${p.scoring.bands.fair}`]);
  if (p.scoring.optionalColumns.length > 0) rows.push(["Columns treated as optional", p.scoring.optionalColumns.join(", ")]);
  if (p.scoring.reviewedChecks > 0) rows.push(["Issues reviewed and set aside", count(p.scoring.reviewedChecks, "check")]);
  if (p.scoring.freshness !== null) rows.push(["Freshness rule", p.scoring.freshness]);
  if (p.scoring.rules > 0) rows.push(["Own rules", count(p.scoring.rules, "rule")]);
  rows.push(["Computed by", `${p.tool.name} ${p.tool.version}${p.tool.build === null ? "" : ` (build ${p.tool.build})`}, in the browser`]);
  return rows;
}
