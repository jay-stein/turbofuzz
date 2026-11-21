import { decodeText } from "../parse/encoding.js";
import { detectTable, type DetectedTable, type HeaderLayout } from "../parse/header-detect.js";
import { parseDelimited } from "../parse/parse.js";
import { openHeaderRowDialog } from "./header-row-dialog.js";

/** A delimited file held in memory (B in Compare), read from its first and last `bytes` for the check. */
export function bufferLayoutSource(name: string, buffer: ArrayBuffer, bytes: number, rows: number): LayoutCheckSource {
  const parse = (text: string): string[][] => parseDelimited(text, { delimiter: "auto", hasHeaders: false, normalizeRows: false }).rows;
  return {
    name,
    readPreview: async () =>
      parseDelimited(decodeText(buffer.slice(0, bytes)).text, { delimiter: "auto", hasHeaders: false, normalizeRows: false, preview: rows }).rows,
    readTail: async () => {
      const text = decodeText(buffer.slice(Math.max(0, buffer.byteLength - bytes))).text;
      // A slice from the middle of the file starts part-way through a row: drop that first line.
      const cut = buffer.byteLength > bytes ? text.indexOf("\n") : -1;
      return parse(cut >= 0 ? text.slice(cut + 1) : text).slice(-30);
    },
  };
}

/** Where a table's first and last rows can be read for the check (a file, a sheet, B in Compare). */
export interface LayoutCheckSource {
  name: string;
  /** The first rows as parsed, before any header handling. */
  readPreview: () => Promise<string[][]>;
  /** The preview is the whole source. */
  complete?: boolean;
  /** The last rows of a source too big to read whole. */
  readTail?: () => Promise<string[][]>;
  /** Extra line in the dialog, e.g. that one layout applies to several files. */
  note?: string;
}

/**
 * Before a first load: when the automatic read of the table is not plain (rows left out, a header that is
 * not one row, stacked sections, a close call…), the person checks it before anything loads. Resolves null
 * for a plain table (load as read), the layout the person settled on, or "cancel" (do not load).
 * `previewRows` is how many rows a preview holds when the source is not complete.
 */
export async function checkLayoutBeforeLoad(
  source: LayoutCheckSource,
  previewRows: number,
  /** The automatic read of the first rows, when it is taken as is: the load card shows them while the rest loads. */
  onRead?: (table: DetectedTable) => void,
): Promise<HeaderLayout | null | "cancel"> {
  let preview: string[][];
  try {
    preview = await source.readPreview();
  } catch {
    return null;
  }
  if (preview.length === 0) return null;
  const complete = source.complete === true || preview.length < previewRows;
  let tail: string[][] = [];
  if (!complete && source.readTail !== undefined) {
    try {
      tail = await source.readTail();
    } catch {
      tail = [];
    }
  }
  // The end of a big file is read from its last rows, so footnotes there are reviewed too.
  const auto = detectTable(complete || tail.length === 0 ? preview : [...preview, [""], ...tail]);
  const reasons = (auto.review ?? []).map((reason) => reason.message);
  if (reasons.length === 0) {
    onRead?.(auto);
    return null;
  }
  const result = await openHeaderRowDialog({
    name: source.name,
    preview,
    complete,
    tail,
    current: { skipRows: auto.skipRows, headerRows: auto.headerRows, skipAfter: auto.skipAfter },
    overridden: false,
    reasons,
    ...(source.note === undefined ? {} : { note: source.note }),
  });
  if (result === null) return "cancel";
  return result.kind === "layout" ? result.layout : null;
}
