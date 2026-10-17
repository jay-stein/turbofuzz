// The package's CJS entry only exposes a default to Node's ESM loader; the
// ESM build resolves everywhere (Vite bundles it, Node imports it directly).
import { GIFEncoder, applyPalette, quantize } from "gifenc/dist/gifenc.esm.js";

export interface GifFrameInput {
  /** RGBA pixels, row-major (canvas ImageData layout). */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Encodes RGBA frames into a looping GIF89a. Each frame is quantised to its
 * own 256-colour table: chart frames share a stable palette, so per-frame
 * tables are simpler than a global pass and avoid cross-frame dithering.
 */
export function encodeGif(frames: readonly GifFrameInput[], delayMs = 500): Uint8Array {
  if (frames.length === 0) return new Uint8Array(0);
  const gif = GIFEncoder();
  frames.forEach((frame, index) => {
    const palette = quantize(frame.data, 256);
    const indexed = applyPalette(frame.data, palette);
    gif.writeFrame(indexed, frame.width, frame.height, {
      palette,
      delay: Math.max(20, Math.round(delayMs)),
      repeat: 0,
      first: index === 0,
    });
  });
  gif.finish();
  return gif.bytes();
}
