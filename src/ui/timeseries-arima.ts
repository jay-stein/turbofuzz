/** Starts the AutoARIMA workers for one job and lets the page watch them or stop them. */

import type { ArimaJob, ArimaProgress, ArimaResult, FoldOut } from "../data/timeseries/arima-run.js";
import type { ArimaWorkerIn, ArimaWorkerOut } from "../worker/arima.worker.js";

export interface ArimaRun {
  done: Promise<ArimaResult>;
  /** Ends the workers: whatever they had found is dropped. */
  cancel(): void;
}

/** Most workers one job may use for its backtest, and how many cores are left to the page. */
const MAX_POOL = 6;

/**
 * One worker searches the orders. The backtest then refits the chosen orders on each fold's history; the folds do not depend on
 * each other, so they are dealt to as many workers as there are cores to spare (this one included) and added up afterwards.
 * The figures are the same as one worker would give; only the wait is shorter.
 */
export function startArima(job: ArimaJob, onProgress: (p: ArimaProgress) => void): ArimaRun {
  const workers: Worker[] = [];
  const spawn = (): Worker => {
    const w = new Worker(new URL("../worker/arima.worker.ts", import.meta.url), { type: "module" });
    workers.push(w);
    return w;
  };
  let stop: () => void = () => {};
  const done = new Promise<ArimaResult>((resolve) => {
    let settled = false;
    const finish = (r: ArimaResult): void => {
      if (settled) return;
      settled = true;
      for (const w of workers) w.terminate();
      resolve(r);
    };
    const fail = (why: string): void => finish({ ok: false, reason: `The search stopped with an error: ${why}` });
    stop = () => finish({ ok: false, reason: "Stopped." });
    const send = (w: Worker, m: ArimaWorkerIn): void => w.postMessage(m);

    const first = spawn();
    first.onerror = (event) => fail(event.message || "the worker crashed");
    first.onmessage = (event: MessageEvent<ArimaWorkerOut>) => {
      const m = event.data;
      if (m.type === "progress") onProgress(m.progress);
      else if (m.type === "error") fail(m.message);
      else if (m.type === "done") {
        const r = m.result;
        if (!r.ok || !r.pending) { finish(r); return; }
        backtest(r);
      }
    };
    send(first, { type: "run", job, deferFolds: true });

    const backtest = (r: Extract<ArimaResult, { ok: true }>): void => {
      const ctx = r.pending!;
      const R = job.origins.length;
      const outs: FoldOut[] = [];
      let next = 0, back = 0;
      const progress = (): void => onProgress({ stage: `Backtest, ${back} of ${R} folds`, tried: r.tried.length, best: r.label, bestAicc: r.aicc, current: "", detail: "" });
      const pump = (w: Worker): void => { if (next < R) send(w, { type: "fold", ctx, k: next++ }); };
      const watch = (w: Worker): void => {
        w.onerror = (event) => fail(event.message || "the worker crashed");
        w.onmessage = (event: MessageEvent<ArimaWorkerOut>) => {
          const m = event.data;
          if (m.type === "error") { fail(m.message); return; }
          if (m.type === "done") { finish(m.result); return; }
          if (m.type !== "fold") return;
          back++;
          if (m.out) outs.push(m.out);
          progress();
          if (next < R) pump(w);
          else if (back === R) send(first, { type: "combine", result: r, outs });
        };
      };
      const size = Math.max(1, Math.min(R, (navigator.hardwareConcurrency || 4) - 1, MAX_POOL));
      progress();
      watch(first);
      pump(first);
      for (let i = 1; i < size; i++) { const w = spawn(); watch(w); pump(w); }
    };
  });
  return { done, cancel: () => stop() };
}
