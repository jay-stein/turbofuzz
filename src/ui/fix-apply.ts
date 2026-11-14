import type { CleanOp } from "../data/clean-ops.js";
import { n, plural } from "../data/dq-copy.js";
import type { FixStep, PageIssue } from "../data/dq-issues.js";

/** What the fixes are applied to: the table as it is when Apply is pressed. */
export interface FixTarget {
  /** The column's name, or null when it no longer exists. */
  name(column: number): string | null;
  /** The clean steps already on the column, in order. */
  cleanOps(column: number): readonly CleanOp[];
  /** The text already treated as missing in the column. */
  missingTokens(column: number): readonly string[];
}

/** One ticked fix, broken into what it will change. */
export interface PlannedFix {
  issue: PageIssue;
  /** The name used in the summary: the column, or the issue title. */
  label: string;
  cleans: { column: number; op: CleanOp }[];
  missing: { column: number; tokens: string[] }[];
  drops: number[];
  /** Why nothing will run for this fix, or null. */
  skipped: string | null;
}

export interface FixPlan {
  fixes: PlannedFix[];
  /** Every column's full clean list after all the fixes: sent to the worker as one rebuild. */
  cleans: { column: number; ops: CleanOp[] }[];
}

const sameOp = (a: CleanOp, b: CleanOp): boolean => JSON.stringify(a) === JSON.stringify(b);

function cleanOpOf(step: FixStep): CleanOp | null {
  if (step.kind === "standardise") return { kind: "recode", pairs: step.pairs };
  if (step.kind === "numberSymbols") return { kind: "toNumber", locale: step.locale };
  if (step.kind === "dateFormat") return { kind: "toDate", order: step.order };
  return null;
}

/**
 * Turns the ticked issues into one plan, in the order they were listed. Clean
 * steps on the same column stack in that order. A fix whose change is already in
 * place (or whose column is gone) is skipped with the reason, never re-applied.
 */
export function planFixes(issues: readonly PageIssue[], chosen: readonly string[], target: FixTarget): FixPlan {
  const ops = new Map<number, CleanOp[]>();
  const missing = new Map<number, Set<string>>();
  const dropped = new Set<number>();
  const fixes: PlannedFix[] = [];
  for (const issue of issues.filter((candidate) => chosen.includes(candidate.id))) {
    const fix: PlannedFix = { issue, label: issue.columnName ?? issue.title, cleans: [], missing: [], drops: [], skipped: null };
    const reasons: string[] = [];
    for (const step of issue.fixes) {
      if (step.kind === "convert") continue;
      if (target.name(step.column) === null || dropped.has(step.column)) {
        reasons.push("column no longer exists");
        continue;
      }
      if (step.kind === "dropColumn") {
        dropped.add(step.column);
        fix.drops.push(step.column);
        continue;
      }
      if (step.kind === "placeholders") {
        let have = missing.get(step.column);
        if (have === undefined) {
          have = new Set(target.missingTokens(step.column));
          missing.set(step.column, have);
        }
        const tokens = step.tokens.filter((token) => !have.has(token));
        if (tokens.length === 0) {
          reasons.push("already treated as missing");
          continue;
        }
        for (const token of tokens) have.add(token);
        fix.missing.push({ column: step.column, tokens });
        continue;
      }
      const op = cleanOpOf(step);
      if (op === null) continue;
      let list = ops.get(step.column);
      if (list === undefined) {
        list = [...target.cleanOps(step.column)];
        ops.set(step.column, list);
      }
      if (list.some((existing) => sameOp(existing, op))) {
        reasons.push("already applied");
        continue;
      }
      list.push(op);
      fix.cleans.push({ column: step.column, op });
    }
    if (fix.cleans.length + fix.missing.length + fix.drops.length === 0) fix.skipped = reasons[0] ?? "nothing to change";
    fixes.push(fix);
  }
  const cleans = [...ops.entries()]
    .filter(([column]) => fixes.some((fix) => fix.cleans.some((step) => step.column === column)))
    .map(([column, list]) => ({ column, ops: list }));
  return { fixes, cleans };
}

/** How the app carries out a plan. Each call resolves once its change is in the table. */
export interface FixRunner {
  /**
   * Applies every column's clean list in one rebuild. Calls `record` once the data
   * is in, before anything else runs, and resolves with what happened.
   */
  clean(updates: FixPlan["cleans"], record: () => void): Promise<"applied" | "unchanged" | "failed">;
  /** Records one fix's clean steps in the Recipe as their own undoable action. */
  recordCleans(fix: PlannedFix): void;
  /** Adds text to treat as missing in a column; resolves true when it changed the table. */
  missing(fix: PlannedFix, column: number, tokens: string[]): Promise<boolean>;
  /** Drops columns as one step; resolves true when they were dropped. */
  drop(columns: number[]): Promise<boolean>;
  /** Progress for the button while the fixes run. */
  progress?(done: number, total: number): void;
}

export interface FixReport {
  /** Fixes that changed the table, in plan order. */
  applied: PlannedFix[];
  skipped: { fix: PlannedFix; reason: string }[];
  /** How many fixes were ticked. */
  total: number;
}

/**
 * Runs a plan one change at a time, each awaited: the clean steps of every fix
 * in a single worker rebuild (each still its own Recipe step), then the
 * missing-value changes, then dropped columns last (dropping shifts positions).
 */
export async function runFixPlan(plan: FixPlan, runner: FixRunner): Promise<FixReport> {
  const failed = new Map<PlannedFix, string>();
  const total = plan.fixes.length;
  let done = 0;
  const tick = (): void => runner.progress?.(Math.min(++done, total), total);
  const live = plan.fixes.filter((fix) => fix.skipped === null);
  if (plan.cleans.length > 0) {
    const withCleans = live.filter((fix) => fix.cleans.length > 0);
    const result = await runner.clean(plan.cleans, () => {
      for (const fix of withCleans) runner.recordCleans(fix);
    });
    if (result !== "applied") {
      for (const fix of withCleans) failed.set(fix, result === "unchanged" ? "already clean" : "could not be applied");
    }
    for (let i = 0; i < withCleans.length; i++) tick();
  }
  const changedByMissing = new Set<PlannedFix>();
  for (const fix of live) {
    for (const step of fix.missing) {
      if (await runner.missing(fix, step.column, step.tokens)) changedByMissing.add(fix);
    }
    if (fix.missing.length > 0 && fix.cleans.length === 0) tick();
  }
  const dropping = live.filter((fix) => fix.drops.length > 0);
  if (dropping.length > 0) {
    const ok = await runner.drop(dropping.flatMap((fix) => fix.drops));
    if (!ok) for (const fix of dropping) failed.set(fix, "could not be applied");
    for (let i = 0; i < dropping.length; i++) tick();
  }
  const report: FixReport = { applied: [], skipped: [], total };
  for (const fix of plan.fixes) {
    if (fix.skipped !== null) {
      report.skipped.push({ fix, reason: fix.skipped });
      continue;
    }
    const cleanFailed = fix.cleans.length > 0 && failed.has(fix);
    const dropFailed = fix.drops.length > 0 && failed.has(fix);
    const anyChange =
      (fix.cleans.length > 0 && !cleanFailed) || changedByMissing.has(fix) || (fix.drops.length > 0 && !dropFailed);
    if (anyChange) report.applied.push(fix);
    else report.skipped.push({ fix, reason: failed.get(fix) ?? "no longer matches" });
  }
  return report;
}

/** "7 fixes applied" or "5 of 7 fixes applied. Skipped: state (already clean), …". */
export function fixReportText(report: FixReport): string {
  const applied = report.applied.length;
  const head =
    applied === report.total
      ? `${n(applied)} ${plural(applied, "fix", "fixes")} applied`
      : applied === 0
        ? "No fixes applied"
        : `${n(applied)} of ${n(report.total)} ${plural(report.total, "fix", "fixes")} applied`;
  if (report.skipped.length === 0) return head;
  const skipped = report.skipped.map(({ fix, reason }) => `${fix.label} (${reason})`).join(", ");
  return `${head}. Skipped: ${skipped}`;
}
