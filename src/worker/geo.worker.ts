/**
 * Boundary files, read on their own thread and only when someone loads one, so the projection and shapefile code is no
 * weight on anyone who never does. Keeps the file, so another coordinate system or layer needs no new upload.
 */
import { GeoCrsNeededError, parseGeoFile, type GeoDataset } from "../data/geo-file.js";
import type { CrsChoice } from "../data/geo-crs.js";
import { buildShapes, chooseLabelProperty, type RegionShape } from "../data/regions.js";

export interface GeoWorkerRequest {
  id: number;
  buffer?: ArrayBuffer;
  fileName?: string;
  crs?: string;
  layer?: string;
}

export type GeoWorkerReply =
  | { id: number; ok: true; fileName: string; geo: GeoDataset; shapes: RegionShape[]; tolerances: number[]; labelProperty: string | null; points: number; ms: number }
  | { id: number; ok: false; fileName: string; crsNeeded: string; guesses: CrsChoice[]; range: GeoCrsNeededError["range"]; stated: string | null }
  | { id: number; ok: false; fileName: string; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GeoWorkerRequest>) => void) | null;
  postMessage(message: GeoWorkerReply): void;
};

let file: { buffer: ArrayBuffer; fileName: string; layer?: string } | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  void (async () => {
    const started = performance.now();
    if (message.buffer !== undefined) file = { buffer: message.buffer, fileName: message.fileName ?? "boundaries" };
    if (file === null) {
      scope.postMessage({ id: message.id, ok: false, fileName: "", error: "Load a boundary file first." });
      return;
    }
    if (message.layer !== undefined) file.layer = message.layer;
    try {
      const geo = await parseGeoFile(file.buffer, file.fileName, {
        ...(message.crs === undefined ? {} : { crs: message.crs }),
        ...(file.layer === undefined ? {} : { layer: file.layer }),
      });
      const labelProperty = chooseLabelProperty(geo.features);
      if (labelProperty !== null) {
        for (const feature of geo.features) {
          const value = feature.properties[labelProperty];
          if (value !== null && value !== undefined && String(value) !== "") feature.label = String(value);
        }
      }
      const { shapes, tolerances, points } = buildShapes(geo);
      scope.postMessage({ id: message.id, ok: true, fileName: file.fileName, geo, shapes, tolerances, labelProperty, points, ms: performance.now() - started });
    } catch (error) {
      if (error instanceof GeoCrsNeededError) scope.postMessage({ id: message.id, ok: false, fileName: file.fileName, crsNeeded: error.message, guesses: error.guesses, range: error.range, stated: error.stated });
      else scope.postMessage({ id: message.id, ok: false, fileName: file.fileName, error: error instanceof Error ? error.message : "Could not read that file." });
    }
  })();
};
