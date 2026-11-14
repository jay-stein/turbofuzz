/** What the load panel says, kept apart from the DOM so it can be tested. */

export interface LoadReport {
  detail: string;
  current?: number;
  total?: number;
}

/** "42 s", "1 min 29 s". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** A whole percent when the report can back one (a positive total, current within it); otherwise null. */
export function percentOf(report: LoadReport): number | null {
  const { current, total } = report;
  if (current === undefined || total === undefined || !(total > 0) || current < 0 || current > total) return null;
  return Math.min(100, Math.round((current / total) * 100));
}

/** The panel's detail line: the worker's words, the percent when real, and how long it has run. */
export function loadDetailText(report: LoadReport, startedAt: number, now: number): string {
  const percent = percentOf(report);
  const parts = [report.detail.replace(/[.…]+$/, ""), ...(percent === null ? [] : [`${percent}%`]), formatElapsed(now - startedAt)];
  return parts.join(" · ");
}
