export interface ArchiveEntry {
  path: string;
  name: string;
  size: number;
}

const ARCHIVE_DATA_EXTENSIONS = [".csv", ".tsv", ".psv", ".txt", ".xlsx", ".xls"];

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot);
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function isJunk(path: string): boolean {
  if (path.endsWith("/")) return true;
  const base = basename(path);
  if (base === "" || base.startsWith(".") || base.toLowerCase() === "thumbs.db") return true;
  return path.split("/").includes("__MACOSX");
}

export function isArchiveDataName(path: string): boolean {
  return ARCHIVE_DATA_EXTENSIONS.includes(extensionOf(path));
}

/**
 * Lists supported data files (CSV/TSV/PSV/TXT/XLSX/XLS) inside a ZIP without
 * decompressing them — fflate calls the filter for every entry, so rejecting
 * all of them yields names and uncompressed sizes at directory-scan speed.
 */
export async function listArchiveEntries(buffer: ArrayBuffer): Promise<ArchiveEntry[]> {
  // Loaded on demand so the main bundle stays lean.
  const { unzipSync } = await import("fflate");
  const entries: ArchiveEntry[] = [];
  unzipSync(new Uint8Array(buffer), {
    filter: (file) => {
      if (!isJunk(file.name) && isArchiveDataName(file.name)) {
        entries.push({ path: file.name, name: basename(file.name), size: file.originalSize });
      }
      return false;
    },
  });
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/** Decompresses a single entry by path (other entries are skipped). */
export async function readArchiveEntry(buffer: ArrayBuffer, path: string): Promise<Uint8Array> {
  const { unzip } = await import("fflate");
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), { filter: (file) => file.name === path }, (error, files) => {
      if (error !== null) {
        reject(error);
        return;
      }
      const data = files[path];
      if (data === undefined) reject(new Error(`“${path}” not found in archive`));
      else resolve(data);
    });
  });
}

/** Decompresses several entries in one pass (used by the Import-all flow). */
export async function readArchiveEntries(
  buffer: ArrayBuffer,
  paths: readonly string[],
): Promise<Map<string, Uint8Array>> {
  const { unzip } = await import("fflate");
  const wanted = new Set(paths);
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), { filter: (file) => wanted.has(file.name) }, (error, files) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(new Map(Object.entries(files)));
    });
  });
}

/**
 * Reads only the first `maxBytes` of several entries, a few at a time, so a
 * ZIP of large files can be header-checked without inflating everything into
 * memory at once. Peaks at one file per concurrent worker.
 */
export async function readArchivePrefixes(
  buffer: ArrayBuffer,
  paths: readonly string[],
  maxBytes: number,
  options: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, Uint8Array>> {
  const { unzip } = await import("fflate");
  const concurrency = Math.min(Math.max(1, options.concurrency ?? 4), paths.length);
  const out = new Map<string, Uint8Array>();
  let next = 0;
  let done = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const path = paths[index];
      if (path === undefined) return;
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        unzip(
          new Uint8Array(buffer),
          { filter: (file) => file.name === path },
          (error, files) => {
            if (error !== null) {
              reject(error);
              return;
            }
            const data = files[path];
            if (data === undefined) reject(new Error(`“${path}” not found in archive`));
            else resolve(data);
          },
        );
      });
      out.set(path, bytes.slice(0, maxBytes));
      done++;
      options.onProgress?.(done, paths.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, run));
  return out;
}
