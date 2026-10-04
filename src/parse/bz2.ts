interface Bz2Decoder {
  decompress(data: Uint8Array, crc?: boolean): Uint8Array;
}

function isDecoder(value: unknown): value is Bz2Decoder {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Bz2Decoder).decompress === "function"
  );
}

/**
 * The bz2 package attaches itself to `window.bz2` in browsers and to
 * `module.exports` in Node, so accept either shape (plus the CJS default
 * interop object) before giving up.
 */
function resolveDecoder(imported: unknown): Bz2Decoder | null {
  const namespace = imported as { decompress?: unknown; default?: unknown };
  if (isDecoder(namespace)) return namespace;
  if (isDecoder(namespace.default)) return namespace.default;
  const globalDecoder = (globalThis as { bz2?: unknown }).bz2;
  return isDecoder(globalDecoder) ? globalDecoder : null;
}

/** Lazy bzip2 decompression, keeping the decoder out of the main bundle. */
export async function decompressBzip2(buffer: ArrayBuffer): Promise<Uint8Array> {
  const imported = await import("bz2");
  const decoder = resolveDecoder(imported);
  if (decoder === null) throw new Error("bzip2 decoder unavailable");
  return decoder.decompress(new Uint8Array(buffer));
}
