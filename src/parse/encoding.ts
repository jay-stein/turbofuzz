/** `utf-8-repaired`: a UTF-8 file with a few unreadable bytes, each shown as U+FFFD instead of corrupting every accent. */
export type FileEncoding = "utf-8" | "utf-8-repaired" | "windows-1252" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be";

/** Replacement characters (U+FFFD) in decoded text: how many, and the file line of the first. */
export interface ReplacedChars {
  count: number;
  line: number;
}

export interface DecodedText {
  text: string;
  encoding: FileEncoding;
  /** Present only when the decoded text holds U+FFFD: unreadable bytes, a lone surrogate, a cut-off character. */
  replaced?: ReplacedChars;
}

/** Counts U+FFFD in decoded text; null (and no scan beyond one native search) when there is none. */
export function findReplaced(text: string): ReplacedChars | null {
  const first = text.indexOf("�");
  if (first < 0) return null;
  let count = 0;
  for (let at = first; at >= 0; at = text.indexOf("�", at + 1)) count++;
  let line = 1;
  for (let at = text.indexOf("\n"); at >= 0 && at < first; at = text.indexOf("\n", at + 1)) line++;
  return { count, line };
}

// WHATWG windows-1252 maps 0x80-0x9F to typographic characters. Browsers do
// this in TextDecoder, but Node (and a few runtimes) decode that range as C1
// control characters, so the mapping is applied explicitly and idempotently.
const C1_MAP: readonly (string | null)[] = [
  "\u20AC", null, "\u201A", "\u0192", "\u201E", "\u2026", "\u2020", "\u2021",
  "\u02C6", "\u2030", "\u0160", "\u2039", "\u0152", null, "\u017D", null,
  null, "\u2018", "\u2019", "\u201C", "\u201D", "\u2022", "\u2013", "\u2014",
  "\u02DC", "\u2122", "\u0161", "\u203A", "\u0153", null, "\u017E", "\u0178",
];

function repairWindows1252(text: string): string {
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x80 && code <= 0x9f) {
      start = i;
      break;
    }
  }
  if (start < 0) return text;

  let out = text.slice(0, start);
  for (let i = start; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x80 && code <= 0x9f) {
      out += C1_MAP[code - 0x80] ?? text[i];
    } else {
      out += text[i];
    }
  }
  return out;
}

/** A byte-order mark: UTF-32 first (its LE mark starts like UTF-16 LE's), then UTF-16. */
function bomOf(bytes: Uint8Array): FileEncoding | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) return "utf-32le";
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff) return "utf-32be";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

/** UTF-32 without a mark: ASCII-range text puts three zero bytes in every group of four. */
function utf32WithoutMark(bytes: Uint8Array): "utf-32le" | "utf-32be" | null {
  const groups = bytes.length >> 2;
  if (groups < 4) return null;
  let little = 0;
  let big = 0;
  for (let g = 0; g < groups; g++) {
    const i = g * 4;
    if (bytes[i] !== 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 0) little++;
    else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] !== 0) big++;
  }
  if (little >= groups * 0.8) return "utf-32le";
  return big >= groups * 0.8 ? "utf-32be" : null;
}

/** Share of the decoded characters that are ordinary text: not a control code, a lone surrogate, a replacement or a private-use code. */
function plausibleShare(text: string): number {
  let good = 0;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    total++;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        good++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) continue;
    if ((code >= 0x7f && code <= 0x9f) || code === 0xfffd || code === 0xfffe || code === 0xffff || (code >= 0xe000 && code <= 0xf8ff)) continue;
    good++;
  }
  return total === 0 ? 0 : good / total;
}

/**
 * UTF-16 (Excel's "Unicode Text", some Windows tools): by its byte-order mark,
 * or without one when ASCII-range text puts a zero in every other byte. Read
 * as 8-bit it would put a NUL between every character. Text that is mostly CJK
 * has few zero bytes (a tab, a line break), but the zeros still sit on one side
 * of every pair, which no 8-bit text does: that reading must also decode to
 * ordinary characters before it is trusted.
 */
function utf16Of(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const bom = bomOf(bytes);
  if (bom === "utf-16le" || bom === "utf-16be") return bom;
  const pairs = bytes.length >> 1;
  if (pairs < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0) evenZeros++;
    if (bytes[i + 1] === 0) oddZeros++;
  }
  if (oddZeros > pairs * 0.4 && evenZeros < pairs * 0.05) return "utf-16le";
  if (evenZeros > pairs * 0.4 && oddZeros < pairs * 0.05) return "utf-16be";
  // Few zeros, all on one side: only a UTF-16 reading that decodes to real text counts.
  const little = oddZeros >= pairs * 0.01 && evenZeros <= pairs * 0.001;
  const big = evenZeros >= pairs * 0.01 && oddZeros <= pairs * 0.001;
  if (!little && !big) return null;
  const encoding = little ? "utf-16le" : "utf-16be";
  const even = bytes.subarray(0, pairs * 2);
  return plausibleShare(new TextDecoder(encoding).decode(even)) >= 0.95 ? encoding : null;
}

/** UTF-32 has no decoder in TextDecoder: four bytes per code point, anything out of range or a surrogate becomes U+FFFD. */
function decodeUtf32(bytes: Uint8Array, little: boolean): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >> 2;
  const parts: string[] = [];
  let chunk: number[] = [];
  const flush = (): void => {
    parts.push(String.fromCodePoint(...chunk));
    chunk = [];
  };
  for (let i = 1; i < count; i++) {
    let code = view.getUint32(i * 4, little);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd;
    chunk.push(code);
    if (chunk.length === 8192) flush();
  }
  // Bytes left over after the last whole character: a cut-off file.
  if (bytes.length % 4 !== 0) chunk.push(0xfffd);
  if (chunk.length > 0) flush();
  return parts.join("");
}

/**
 * Decodes an uploaded file. UTF-8 is attempted strictly, so any invalid byte
 * sequence falls back to windows-1252 — which never fails and covers the most
 * common legacy CSV encoding (including the euro sign and accented Latin-1
 * letters). A UTF-8 BOM is consumed in both paths. UTF-32 with a byte-order
 * mark is decoded; without one it cannot be told from other data. U+FFFD in
 * the result is counted so the page can say where the first one is.
 */
export function decodeText(buffer: ArrayBuffer): DecodedText {
  const decoded = decodeBytes(buffer);
  const replaced = findReplaced(decoded.text);
  return replaced === null ? decoded : { ...decoded, replaced };
}

function decodeBytes(buffer: ArrayBuffer): DecodedText {
  const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
  const bom = bomOf(head);
  if (bom === "utf-32le" || bom === "utf-32be") {
    return { text: decodeUtf32(new Uint8Array(buffer), bom === "utf-32le"), encoding: bom };
  }
  const bare = utf32WithoutMark(head);
  if (bare !== null) {
    // No mark to skip: decodeUtf32 starts after the first code point, so put a mark in front of it.
    const marked = new Uint8Array(buffer.byteLength + 4);
    marked.set(new Uint8Array(buffer), 4);
    return { text: decodeUtf32(marked, bare === "utf-32le"), encoding: bare };
  }
  const utf16 = utf16Of(head);
  if (utf16 !== null) return { text: new TextDecoder(utf16).decode(buffer), encoding: utf16 };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, encoding: "utf-8" };
  } catch {
    // Not clean UTF-8. If it is overwhelmingly UTF-8 with a few stray bytes, reading the whole file
    // as windows-1252 would turn every accent into mojibake (Ã©), so keep UTF-8 and mark the bad bytes.
    const { valid, invalid } = scanUtf8(new Uint8Array(buffer));
    if (valid > 0 && valid >= invalid * 5) {
      return { text: new TextDecoder("utf-8").decode(buffer), encoding: "utf-8-repaired" };
    }
    const text = repairWindows1252(new TextDecoder("windows-1252").decode(buffer));
    return { text, encoding: "windows-1252" };
  }
}

/** Counts well-formed multi-byte UTF-8 sequences and stray high bytes that cannot start or finish one. */
export function scanUtf8(bytes: Uint8Array): { valid: number; invalid: number } {
  let valid = 0;
  let invalid = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b < 0x80) continue;
    const need = b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : -1;
    let ok = need > 0;
    if (ok) {
      for (let k = 1; k <= need; k++) {
        const c = bytes[i + k];
        if (c === undefined || c < 0x80 || c > 0xbf) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      valid++;
      i += need;
    } else {
      invalid++;
    }
  }
  return { valid, invalid };
}

/** Characters windows-1252 shows for the bytes 0x80-0x9F, back to their byte (the five undefined bytes have none). */
const CP1252_BYTE = new Map<string, number>(
  C1_MAP.flatMap((char, index) => (char === null ? [] : [[char, 0x80 + index] as [string, number]])),
);

/**
 * Classic double-encoding: UTF-8 text that was read as windows-1252, so "é" arrived as "Ã©" and "’" as "â€™".
 * A lead character (Â-ß, à-ï, ð-ô) followed by the characters that continuation bytes 0x80-0xBF show as.
 */
const CONT = "[\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]";
export const MOJIBAKE = new RegExp(`[\u00C2-\u00DF]${CONT}|[\u00E0-\u00EF]${CONT}{2}|[\u00F0-\u00F4]${CONT}{3}`);

/**
 * The text a mojibake value really was: its characters taken back to the windows-1252 bytes they came from and read as
 * UTF-8. Exact and lossless: null (leave the cell alone) when any character has no windows-1252 byte or the bytes are
 * not valid UTF-8, so a correct "café" is never touched. The pandas and Polars scripts use the same two steps.
 */
export function repairMojibake(value: string): string | null {
  if (!MOJIBAKE.test(value)) return null;
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes[i] = code;
    else {
      const mapped = CP1252_BYTE.get(value[i]!);
      if (mapped === undefined) return null;
      bytes[i] = mapped;
    }
  }
  try {
    const fixed = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return fixed === value || fixed.includes("�") ? null : fixed;
  } catch {
    return null;
  }
}
