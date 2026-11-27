import { DELIMITER_LABELS, detectDelimiter, rivalDelimiter, type Delimiter } from "../parse/delimiter.js";
import { detectTable, rowLooksLikeData, type HeaderLayout } from "../parse/header-detect.js";
import { el } from "./dom.js";
import type { SplitChoice } from "./header-row-dialog.js";

/** What the import notes and dialogs read from a source: its first rows, its end, and its text. */
export interface ReadableSource {
  /** First rows as parsed, before any header handling. */
  readPreview: () => Promise<string[][]>;
  /** The preview is the whole source. */
  complete?: boolean;
  /** The last rows of a source too big to read whole, as parsed. */
  readTail?: () => Promise<string[][]>;
  /** The start of the source as text, exactly as written: delimited text only. */
  readText?: () => Promise<string>;
}

/**
 * The header row and the table's edges in one plain line, for under the Overview title: where the column names were taken from
 * and whether anything above, under or after the data was left out. `whole` says the rows seen are the whole source, so what is
 * left out at the end can be counted.
 */
export function describeHeader(preview: string[][], layout: HeaderLayout | null, whole: boolean, hasHeaders = true): string {
  const t = detectTable(preview, layout ?? undefined);
  const rows = (n: number): string => `${n} row${n === 1 ? "" : "s"}`;
  const how = layout === null ? "assumed" : "chosen by you";
  const head =
    t.headerRows === 0
      ? `No header row (${how}): columns are named Column 1, 2…`
      : t.headerRows === 1
        ? `Header: row ${t.skipRows + 1} (${how}).`
        : `Header: rows ${t.skipRows + 1}–${t.skipRows + t.headerRows}, joined (${how}).`;
  const left: string[] = [];
  if (t.skipRows > 0) left.push(`${rows(t.skipRows)} above it skipped`);
  if (t.skipAfter > 0) left.push(`${rows(t.skipAfter)} under it skipped`);
  if (whole && t.footerRows > 0) left.push(`${rows(t.footerRows)} of totals or notes after the data left out`);
  const dropped = layout?.skipColumns?.length ?? 0;
  if (dropped > 0) left.push(`${dropped} column${dropped === 1 ? "" : "s"} left out`);
  const asData =
    hasHeaders && layout === null && t.headerRows > 0 && rowLooksLikeData(preview, t.skipRows)
      ? " The first row looks like data, not a header: untick “First row is header” to use it as data."
      : "";
  return `${head}${left.length > 0 ? ` ${left.join("; ")}.` : t.headerRows > 0 && t.skipRows === 0 ? " Nothing skipped." : ""}${asData}`;
}

/** "commas", "pipes": a separator as the notes name it. */
const plural = (d: Delimiter): string => `${(DELIMITER_LABELS[d] ?? d).toLowerCase()}s`;

export interface SplitNotes {
  /** The Overview note with the separator added. */
  overview: string;
  /** For the Table page: the close call on a guessed separator, or null. */
  closeCall: string | null;
  /** For the Table page: the settings the person chose, or null when nothing was chosen. */
  chosen: string | null;
}

/**
 * Adds the separator to the header note: which one, whether it was chosen, and,
 * for a guess, another separator that fits nearly as well (a close call).
 */
export async function splitNotes(
  header: string,
  source: ReadableSource & { layout: HeaderLayout | null },
  split: Delimiter | null,
  guessed: boolean,
): Promise<SplitNotes> {
  let overview = header;
  let closeCall: string | null = null;
  if (split !== null) {
    overview = `${overview} Columns split on ${plural(split)} (${guessed ? "assumed" : "chosen by you"}).`;
    if (guessed && source.readText !== undefined) {
      const rival = rivalDelimiter(await source.readText().catch(() => ""), split);
      if (rival !== null) {
        closeCall = `Split on ${plural(split)} (assumed), but ${plural(rival)} fit almost as well. Check the columns look right.`;
        overview = `${overview} ${plural(rival).replace(/^./, (c) => c.toUpperCase())} fit almost as well: check the columns look right.`;
      }
    }
  }
  const chose = source.layout !== null || (split !== null && !guessed);
  const chosen = chose ? header + (split !== null && !guessed ? ` Columns split on ${plural(split)} (chosen by you).` : "") : null;
  return { overview, closeCall, chosen };
}

/**
 * The Table page's note on how the file was read, shown only when it matters:
 * orange when the separator was a close call, quiet when the person chose the
 * layout or separator, and hidden for a plain file read automatically.
 */
export function renderReadNote(
  bar: HTMLElement,
  notes: { closeCall: string | null; chosen: string | null } | null,
  actions: { change: () => void; hide: () => void },
): void {
  bar.replaceChildren();
  const text = notes === null ? null : (notes.closeCall ?? notes.chosen);
  if (notes === null || text === null) {
    bar.hidden = true;
    return;
  }
  const flag = notes.closeCall !== null;
  bar.classList.toggle("table-read-note-flag", flag);
  const change = el(
    "button",
    { class: flag ? "small overview-read-fix" : "small", type: "button", title: "Change what the columns are split on, the header row and where the data ends" },
    [flag ? "Change how it was read…" : "Change…"],
  );
  change.addEventListener("click", actions.change);
  const hide = el("button", { class: "icon-btn table-read-note-hide", type: "button", "aria-label": "Hide this note", title: "Hide (the Overview still says how the file was read)" }, ["×"]);
  hide.addEventListener("click", () => {
    bar.hidden = true;
    actions.hide();
  });
  bar.append(...(flag ? [el("span", { class: "table-read-note-dot", "aria-hidden": "true" })] : []), el("span", { class: "table-read-note-text" }, [text]), change, hide);
  bar.hidden = false;
}

/**
 * Delimited text can be split another way: the import dialogs re-read the preview
 * with each separator offered. Every read of a source goes through the front-page
 * separator choice (`select`), so it is swapped for each re-read only. Null for a
 * sheet, JSON or a grid (no readText).
 */
export function splitChoiceFor(source: ReadableSource, found: Delimiter, select: HTMLSelectElement, previewRows: number): SplitChoice | null {
  const readText = source.readText;
  if (readText === undefined) return null;
  return {
    found,
    current: select.value as Delimiter | "auto",
    readText,
    reparse: async (choice) => {
      const saved = select.value;
      select.value = choice;
      try {
        const rows = await source.readPreview();
        const whole = source.complete === true || rows.length < previewRows;
        const end = !whole && source.readTail !== undefined ? await source.readTail().catch(() => []) : [];
        return { preview: rows, tail: end, complete: whole };
      } finally {
        select.value = saved;
      }
    },
  };
}

/** Before a first load: the separator the read will use, offered in the check, with the one settled on kept for the load. */
export async function preloadSplitting(
  source: ReadableSource,
  select: HTMLSelectElement,
  previewRows: number,
): Promise<{ splitting?: SplitChoice & { choose(choice: Delimiter | "auto"): void } }> {
  if (source.readText === undefined) return {};
  const current = select.value as Delimiter | "auto";
  let found: Delimiter;
  try {
    found = current === "auto" ? detectDelimiter(await source.readText()) : current;
  } catch {
    return {};
  }
  const choice = splitChoiceFor(source, found, select, previewRows);
  if (choice === null) return {};
  return { splitting: { ...choice, choose: (next) => { select.value = next; } } };
}
