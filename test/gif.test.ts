import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeGif, type GifFrameInput } from "../src/data/gif.js";

/** Minimal GIF89a structure reader for assertions. */
function parseGif(bytes: Uint8Array): {
  frames: number;
  delays: number[];
  loops: boolean;
} {
  let pos = 6; // "GIF89a"
  const flags = bytes[pos + 4] ?? 0;
  pos += 7; // logical screen descriptor
  if ((flags & 0x80) !== 0) pos += 3 * 2 ** ((flags & 7) + 1);
  let frames = 0;
  const delays: number[] = [];
  let loops = false;
  const skipSubBlocks = (): void => {
    while (pos < bytes.length && bytes[pos] !== 0) pos += 1 + (bytes[pos] ?? 0);
    pos++;
  };
  while (pos < bytes.length) {
    const intro = bytes[pos++];
    if (intro === 0x3b) break; // trailer
    if (intro === 0x21) {
      const label = bytes[pos++];
      if (label === 0xf9) {
        pos++; // block size (4)
        pos++; // flags
        delays.push((bytes[pos] ?? 0) | ((bytes[pos + 1] ?? 0) << 8));
        pos += 3; // delay + transparent index
        pos++; // terminator
      } else if (label === 0xff) {
        pos++; // block size (11)
        const app = String.fromCharCode(...bytes.slice(pos, pos + 11));
        if (app === "NETSCAPE2.0") loops = true;
        pos += 11;
        skipSubBlocks();
      } else {
        skipSubBlocks();
      }
    } else if (intro === 0x2c) {
      frames++;
      pos += 9; // image descriptor
      const imageFlags = bytes[pos - 1] ?? 0;
      if ((imageFlags & 0x80) !== 0) pos += 3 * 2 ** ((imageFlags & 7) + 1);
      pos++; // LZW minimum code size
      skipSubBlocks();
    } else {
      break;
    }
  }
  return { frames, delays, loops };
}

function frame(width: number, height: number, color: [number, number, number]): GifFrameInput {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    data[pixel * 4] = color[0];
    data[pixel * 4 + 1] = color[1];
    data[pixel * 4 + 2] = color[2];
    data[pixel * 4 + 3] = 255;
  }
  return { data, width, height };
}

test("encodeGif writes one looping GIF frame per input frame", () => {
  const bytes = encodeGif(
    [frame(4, 4, [255, 0, 0]), frame(4, 4, [0, 0, 255])],
    500,
  );
  assert.ok(bytes.length > 0);
  assert.equal(String.fromCharCode(...bytes.slice(0, 6)), "GIF89a");
  const parsed = parseGif(bytes);
  assert.equal(parsed.frames, 2);
  assert.deepEqual(parsed.delays, [50, 50], "delay is in hundredths of a second");
  assert.equal(parsed.loops, true, "the Netscape loop extension is present");
  assert.equal(bytes[bytes.length - 1], 0x3b, "trailer byte");
});

test("encodeGif handles an empty frame list", () => {
  assert.equal(encodeGif([]).length, 0);
});
