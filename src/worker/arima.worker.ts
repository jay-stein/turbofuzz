/**
 * The AutoARIMA search runs here, on its own thread, so it can take as long as it needs without freezing the table, and the
 * page can stop it by ending the worker. One job per worker.
 */

import { runAutoArima, type ArimaJob, type ArimaProgress, type ArimaResult } from "../data/timeseries/arima-run.js";

export type ArimaWorkerIn = { type: "run"; job: ArimaJob };
export type ArimaWorkerOut = { type: "progress"; progress: ArimaProgress } | { type: "done"; result: ArimaResult } | { type: "error"; message: string };

self.onmessage = (event: MessageEvent<ArimaWorkerIn>) => {
  if (event.data.type !== "run") return;
  let lastPost = 0;
  try {
    const result = runAutoArima(event.data.job, (progress) => {
      // A message per model would flood the page; about ten a second is plenty to watch.
      const now = Date.now();
      if (now - lastPost < 100) return;
      lastPost = now;
      (self as unknown as Worker).postMessage({ type: "progress", progress } satisfies ArimaWorkerOut);
    });
    (self as unknown as Worker).postMessage({ type: "done", result } satisfies ArimaWorkerOut);
  } catch (error) {
    (self as unknown as Worker).postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) } satisfies ArimaWorkerOut);
  }
};
