/**
 * The AutoARIMA search runs here, on its own thread, so it can take as long as it needs without freezing the table, and the
 * page can stop it by ending the worker. The first worker of a job runs the search; the backtest folds, which are independent of
 * each other and most of the work, are handed to a few workers and added up afterwards (see timeseries-arima.ts).
 */

import {
  foldScore, runAutoArima, withBacktest,
  type ArimaJob, type ArimaProgress, type ArimaResult, type FoldContext, type FoldOut,
} from "../data/timeseries/arima-run.js";

export type ArimaWorkerIn =
  | { type: "run"; job: ArimaJob; deferFolds?: boolean }
  | { type: "fold"; ctx: FoldContext; k: number }
  | { type: "combine"; result: Extract<ArimaResult, { ok: true }>; outs: FoldOut[] };
export type ArimaWorkerOut =
  | { type: "progress"; progress: ArimaProgress }
  | { type: "done"; result: ArimaResult }
  | { type: "fold"; k: number; out: FoldOut | null }
  | { type: "error"; message: string };

const post = (m: ArimaWorkerOut): void => (self as unknown as Worker).postMessage(m);

self.onmessage = (event: MessageEvent<ArimaWorkerIn>) => {
  const msg = event.data;
  try {
    if (msg.type === "run") {
      let lastPost = 0;
      const result = runAutoArima(msg.job, (progress) => {
        // A message per model would flood the page; about ten a second is plenty to watch.
        const now = Date.now();
        if (now - lastPost < 100) return;
        lastPost = now;
        post({ type: "progress", progress });
      }, () => false, { deferFolds: msg.deferFolds === true });
      post({ type: "done", result });
    } else if (msg.type === "fold") {
      post({ type: "fold", k: msg.k, out: foldScore(msg.ctx, msg.k) });
    } else if (msg.type === "combine") {
      post({ type: "done", result: withBacktest(msg.result, msg.outs) });
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
