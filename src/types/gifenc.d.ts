declare module "gifenc/dist/gifenc.esm.js" {
  export type GifPixelFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface GifWriteFrameOptions {
    palette?: number[][];
    delay?: number;
    repeat?: number;
    first?: boolean;
    transparent?: boolean;
    dispose?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifWriteFrameOptions,
    ): void;
    writeHeader(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8ClampedArray | Uint8Array,
    maxColors: number,
    options?: {
      format?: GifPixelFormat;
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
    },
  ): number[][];

  export function applyPalette(
    rgba: Uint8ClampedArray | Uint8Array,
    palette: number[][],
    format?: GifPixelFormat,
  ): Uint8Array;

  export function nearestColorIndex(palette: number[][], pixel: number[]): number;
  export function snapColorsToPalette(
    palette: number[][],
    knownColors: number[][],
    threshold?: number,
  ): void;
  export function prequantize(
    rgba: Uint8ClampedArray | Uint8Array,
    options?: { roundRGB?: number; roundAlpha?: number; oneBitAlpha?: boolean | number },
  ): void;
}
