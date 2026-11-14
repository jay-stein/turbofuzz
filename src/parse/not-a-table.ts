/** How many leading bytes are inspected: enough to tell a binary file from text, cheap to read. */
export const NOT_A_TABLE_SAMPLE_BYTES = 8192;

interface Kind {
  /** "a PDF", "an image". */
  label: string;
  /** Where to open it instead. */
  openIn: string;
}

const PDF: Kind = { label: "a PDF", openIn: "Open it in a PDF reader" };
const IMAGE: Kind = { label: "an image", openIn: "Open it in an image viewer" };
const WORD: Kind = { label: "a Word document", openIn: "Open it in Word" };
const SLIDES: Kind = { label: "a PowerPoint file", openIn: "Open it in PowerPoint" };
const AUDIO: Kind = { label: "an audio file", openIn: "Open it in a media player" };
const VIDEO: Kind = { label: "a video file", openIn: "Open it in a media player" };
const PROGRAM: Kind = { label: "a program", openIn: "It cannot be opened here" };
const ZIPPED: Kind = { label: "a zipped Office or archive file", openIn: "Open it in the program that made it" };
const BINARY: Kind = { label: "a binary file", openIn: "Open it in the program that made it" };

const BY_EXTENSION: Record<string, Kind> = {
  ".pdf": PDF, ".png": IMAGE, ".jpg": IMAGE, ".jpeg": IMAGE, ".gif": IMAGE, ".bmp": IMAGE, ".webp": IMAGE, ".ico": IMAGE,
  ".docx": WORD, ".doc": WORD, ".pptx": SLIDES, ".ppt": SLIDES,
  ".mp3": AUDIO, ".wav": AUDIO, ".flac": AUDIO, ".ogg": AUDIO,
  ".mp4": VIDEO, ".mov": VIDEO, ".avi": VIDEO, ".mkv": VIDEO,
  ".exe": PROGRAM, ".dll": PROGRAM, ".msi": PROGRAM,
};

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((value, i) => bytes[i] === value);
}

function ascii(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

function byMagic(bytes: Uint8Array): Kind | null {
  if (startsWith(bytes, ascii("%PDF"))) return PDF;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff]) || startsWith(bytes, ascii("GIF8"))) return IMAGE;
  if (startsWith(bytes, ascii("MZ"))) return PROGRAM;
  if (startsWith(bytes, ascii("ID3")) || startsWith(bytes, ascii("OggS"))) return AUDIO;
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return ZIPPED;
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) || startsWith(bytes, ascii("SQLite format 3")) || startsWith(bytes, ascii("Rar!")) || startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf])) return BINARY;
  return null;
}

/** UTF-16 text is full of zero bytes on one side of every pair: legitimate, not binary. */
function looksUtf16(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return true;
  const pairs = bytes.length >> 1;
  if (pairs < 4) return false;
  let even = 0;
  let odd = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0) even++;
    if (bytes[i + 1] === 0) odd++;
  }
  return (odd > pairs * 0.4 && even < pairs * 0.05) || (even > pairs * 0.4 && odd < pairs * 0.05);
}

/** True when the bytes are not text in any encoding the app reads: NULs, or many stray control characters. */
function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || looksUtf16(bytes)) return false;
  let controls = 0;
  for (const byte of bytes) {
    if (byte === 0) return true;
    // Tab, line feed, form feed, carriage return and escape are ordinary in text files.
    if ((byte < 0x20 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13 && byte !== 27) || byte === 0x7f) controls++;
  }
  return controls > bytes.length * 0.05;
}

/**
 * A plain refusal message when a file about to be read as delimited text is plainly something
 * else (a PDF, an image, a program, random bytes), or null when it may be text. Pass the file's
 * first bytes. Workbooks, Parquet and archives are read by their own paths and must not be asked.
 */
export function notATableMessage(name: string, head: Uint8Array): string | null {
  const bytes = head.length > NOT_A_TABLE_SAMPLE_BYTES ? head.subarray(0, NOT_A_TABLE_SAMPLE_BYTES) : head;
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot).toLowerCase();
  const kind = byMagic(bytes) ?? BY_EXTENSION[extension] ?? (looksBinary(bytes) ? BINARY : null);
  if (kind === null) return null;
  const how = kind === PROGRAM ? "Open the data in a program that can export it to CSV or Excel first." : `${kind.openIn}, or export its table to CSV or Excel first.`;
  return `“${name}” is ${kind.label}, not a table. ${how}`;
}
