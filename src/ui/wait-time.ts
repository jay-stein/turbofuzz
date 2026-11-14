/**
 * The figure the status bar prints is the time the person waited: from the
 * moment a request left the main thread to the moment its answer arrived. That
 * covers a column's one-off preparation, the facet and histogram rebuild and
 * message passing, none of which the worker's own matching timer includes.
 * The worker's figure still wins when it is larger (it never is, but a fake
 * clock in a test may say so).
 */
export function waitedMs(sentAt: number, now: number, workerMs: number): number {
  const waited = Math.max(0, now - sentAt);
  return Math.max(waited, Number.isFinite(workerMs) ? workerMs : 0);
}

/** "12 ms", "1,204 ms"; never "<1 ms" for work that ran, and null when there is nothing measured to print. */
export function formatWait(ms: number | null): string | null {
  if (ms === null || !(ms > 0)) return null;
  return `${Math.max(1, Math.round(ms)).toLocaleString()} ms`;
}

/** How long a first-use preparation may run before the person is told about it. */
export const PREPARE_NOTE_DELAY_MS = 250;

/** Shows a "preparing" note only when the work is still running after a short delay. */
export class PrepareNote {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly show: (text: string) => void,
    // Wrapped, not passed bare: a browser refuses setTimeout called with this set to the note.
    private readonly schedule: (run: () => void, ms: number) => ReturnType<typeof setTimeout> = (run, ms) => setTimeout(run, ms),
    private readonly cancel: (timer: ReturnType<typeof setTimeout>) => void = (timer) => clearTimeout(timer),
  ) {}

  start(columnName: string): void {
    this.stop();
    this.timer = this.schedule(() => {
      this.timer = null;
      this.show(`Preparing the ${columnName} column (first use)…`);
    }, PREPARE_NOTE_DELAY_MS);
  }

  stop(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
}
