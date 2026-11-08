export type FileEncoding = "utf-8" | "windows-1252" | "utf-16le" | "utf-16be";

export interface DecodedText {
  text: string;
  encoding: FileEncoding;
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

/**
 * UTF-16 (Excel's "Unicode Text", some Windows tools): by its byte-order mark,
 * or without one when ASCII-range text puts a zero in every other byte. Read
 * as 8-bit it would put a NUL between every character.
 */
function utf16Of(buffer: ArrayBuffer): "utf-16le" | "utf-16be" | null {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
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
  return null;
}

/**
 * Decodes an uploaded file. UTF-8 is attempted strictly, so any invalid byte
 * sequence falls back to windows-1252 — which never fails and covers the most
 * common legacy CSV encoding (including the euro sign and accented Latin-1
 * letters). A UTF-8 BOM is consumed in both paths.
 */
export function decodeText(buffer: ArrayBuffer): DecodedText {
  const utf16 = utf16Of(buffer);
  if (utf16 !== null) return { text: new TextDecoder(utf16).decode(buffer), encoding: utf16 };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, encoding: "utf-8" };
  } catch {
    const text = repairWindows1252(new TextDecoder("windows-1252").decode(buffer));
    return { text, encoding: "windows-1252" };
  }
}
