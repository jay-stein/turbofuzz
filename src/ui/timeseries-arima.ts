/** Starts the AutoARIMA worker for one job and lets the page watch it or stop it. */

import type { ArimaJob, ArimaProgress, ArimaResult } from "../data/timeseries/arima-run.js";
import type { ArimaWorkerOut } from "../worker/arima.worker.js";

export interface ArimaRun {
  done: Promise<ArimaResult>;
  /** Ends the worker: whatever it had found is dropped. */
  cancel(): void;
}

export function startArima(job: ArimaJob, onProgress: (p: ArimaProgress) => void): ArimaRun {
  const worker = new Worker(new URL("../worker/arima.worker.ts", import.meta.url), { type: "module" });
  let settled = false;
  const done = new Promise<ArimaResult>((resolve) => {
    const finish = (r: ArimaResult): void => { if (settled) return; settled = true; worker.terminate(); resolve(r); };
    worker.onmessage = (event: MessageEvent<ArimaWorkerOut>) => {
      const m = event.data;
      if (m.type === "progress") onProgress(m.progress);
      else if (m.type === "done") finish(m.result);
      else finish({ ok: false, reason: `The search stopped with an error: ${m.message}` });
    };
    worker.onerror = (event) => finish({ ok: false, reason: `The search stopped with an error: ${event.message || "the worker crashed"}` });
    (worker as unknown as { cancelHook?: () => void }).cancelHook = () => finish({ ok: false, reason: "Stopped." });
    worker.postMessage({ type: "run", job });
  });
  return { done, cancel: () => (worker as unknown as { cancelHook?: () => void }).cancelHook?.() };
}
