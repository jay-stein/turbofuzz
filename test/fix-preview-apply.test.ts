import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { CleanOp } from "../src/data/clean-ops.js";
import type { FixStep, PageIssue } from "../src/data/dq-issues.js";
import { fixReportText, planFixes, runFixPlan, type FixPlan, type FixRunner, type FixTarget, type PlannedFix } from "../src/ui/fix-apply.js";
import { openFixPreview } from "../src/ui/fix-preview-dialog.js";
import { SendQueue } from "../src/ui/send-queue.js";
import { groupSteps, type StepsPanelEntry } from "../src/ui/steps-panel.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function issue(id: string, columnName: string, fixes: FixStep[]): PageIssue {
  return {
    id,
    severity: "fix",
    kind: "variants",
    column: fixes[0]?.column ?? null,
    columnName,
    title: `Fix ${columnName}`,
    evidence: "",
    impact: null,
    points: 1,
    examples: [],
    dist: null,
    fixes,
    fixLabel: "Fix",
    batchSafe: true,
    rows: 10,
  };
}

const NAMES = ["order_date", "state", "segment", "returned", "customer_name", "priority", "sales_rep", "empty_col"];

/** The seven safe fixes from the 100,000-row report, plus an empty column to drop. */
function sevenFixes(): PageIssue[] {
  const recode = (column: number, from: string, to: string): FixStep => ({ kind: "standardise", column, pairs: [[from, to]], preview: [] });
  return [
    issue("dateFormat.0", "order_date", [{ kind: "dateFormat", column: 0, order: "dmy", preview: [] }]),
    issue("variants.1", "state", [recode(1, "nsw", "NSW")]),
    issue("variants.2", "segment", [recode(2, "consumer", "Consumer")]),
    issue("variants.3", "returned", [recode(3, "yes", "Yes")]),
    issue("variants.4", "customer_name", [recode(4, "ann lee", "Ann Lee")]),
    issue("variants.5", "priority", [recode(5, "high", "High")]),
    issue("placeholders.6", "sales_rep", [{ kind: "placeholders", column: 6, tokens: ["N/A", "-"], preview: [] }]),
  ];
}

/**
 * A stand-in for the app: a worker behind the app's real send queue, and a Recipe
 * that is one entry per clean op and per missing-value change, with undo actions
 * grouped the way the toolbar Undo groups them.
 */
class FakeApp {
  readonly queue = new SendQueue(() => 1);
  readonly cleaned = new Map<number, CleanOp[]>();
  readonly nullEdits: { column: number; tokens: string[] }[] = [];
  readonly missing = new Map<number, string[]>();
  readonly undoActions: string[][] = [];
  rebuilds = 0;
  workerCalls = 0;
  private readonly worker = (): Promise<void> => {
    this.workerCalls++;
    return new Promise((resolve) => setTimeout(resolve, 1));
  };

  recipeSteps(): number {
    return [...this.cleaned.values()].reduce((sum, ops) => sum + ops.length, 0) + this.nullEdits.length;
  }

  target(): FixTarget {
    return {
      name: (column) => NAMES[column] ?? null,
      cleanOps: (column) => this.cleaned.get(column) ?? [],
      missingTokens: (column) => this.missing.get(column) ?? [],
    };
  }

  /** How fixes were applied before: every step fired at the queue without waiting. */
  applyFireAndForget(issues: readonly PageIssue[]): void {
    for (const fix of issues) {
      for (const step of fix.fixes) {
        if (step.kind === "placeholders") {
          this.queue.latest(() => this.worker().then(() => void this.nullEdits.push({ column: step.column, tokens: step.tokens })));
        } else if (step.kind === "standardise" || step.kind === "dateFormat") {
          const existing = this.cleaned.get(step.column) ?? [];
          const op: CleanOp = step.kind === "standardise" ? { kind: "recode", pairs: step.pairs } : { kind: "toDate", order: step.order };
          this.queue.latest(() => this.worker().then(() => void this.cleaned.set(step.column, [...existing, op])));
        }
      }
    }
  }

  runner(log: string[] = []): FixRunner {
    return {
      clean: (updates, record) => {
        let result: "applied" | "unchanged" | "failed" = "failed";
        return this.queue
          .inOrder(() =>
            this.worker().then(() => {
              this.rebuilds++;
              const changed = updates.some((update) => JSON.stringify(update.ops) !== JSON.stringify(this.cleaned.get(update.column) ?? []));
              if (!changed) {
                result = "unchanged";
                return;
              }
              result = "applied";
              record();
            }),
          )
          .then(() => result);
      },
      recordCleans: (fix: PlannedFix) => {
        for (const { column, op } of fix.cleans) this.cleaned.set(column, [...(this.cleaned.get(column) ?? []), op]);
        this.undoActions.push(fix.cleans.map(({ column }) => `clean|${column}`));
        log.push(`clean ${fix.label}`);
      },
      missing: (fix, column, tokens) => {
        let changed = false;
        return this.queue
          .inOrder(() =>
            this.worker().then(() => {
              this.rebuilds++;
              changed = true;
              this.missing.set(column, [...(this.missing.get(column) ?? []), ...tokens]);
              this.nullEdits.push({ column, tokens });
              this.undoActions.push([`nulls|${column}`]);
              log.push(`missing ${fix.label}`);
            }),
          )
          .then(() => changed);
      },
      drop: (columns) =>
        this.queue
          .inOrder(() => this.worker().then(() => void log.push(`drop ${columns.join(",")}`)))
          .then(() => true),
    };
  }
}

test("the cause: firing several fixes at the latest-wins send queue keeps only the first and the last", async () => {
  const app = new FakeApp();
  const issues = sevenFixes();
  app.applyFireAndForget(issues);
  await new Promise((resolve) => setTimeout(resolve, 30));
  // Seven fixes were asked for; the five queued behind the first were replaced by each newer one.
  assert.equal(app.recipeSteps(), 2);
  assert.equal(app.workerCalls, 2);
});

test("the send queue runs every in-order send, in order, and still lets queries coalesce", async () => {
  const ran: string[] = [];
  const queue = new SendQueue(() => 1);
  const send = (name: string) => (): Promise<void> =>
    new Promise((resolve) =>
      setTimeout(() => {
        ran.push(name);
        resolve();
      }, 1),
    );
  queue.latest(send("query 1"));
  queue.latest(send("query 2"));
  const fixes = ["fix a", "fix b", "fix c", "fix d"].map((name) => queue.inOrder(send(name)));
  queue.latest(send("query 3"));
  queue.latest(send("query 4"));
  await Promise.all(fixes);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(ran, ["query 1", "query 2", "fix a", "fix b", "fix c", "fix d", "query 4"]);
});

test("in-order sends queued for an earlier table are dropped, and still resolve", async () => {
  let generation = 1;
  const ran: string[] = [];
  const queue = new SendQueue(() => generation);
  const first = queue.inOrder(() => new Promise((resolve) => setTimeout(() => (ran.push("a"), resolve()), 1)));
  const second = queue.inOrder(() => Promise.resolve(void ran.push("b")));
  generation = 2;
  await Promise.all([first, second]);
  assert.deepEqual(ran, ["a"]);
});

test("Apply all: seven safe fixes of mixed kinds land as seven Recipe steps and seven undo actions, with one rebuild for the cleans", async () => {
  const app = new FakeApp();
  const issues = sevenFixes();
  const log: string[] = [];
  const progress: string[] = [];
  const plan = planFixes(issues, issues.map((entry) => entry.id), app.target());
  const report = await runFixPlan(plan, { ...app.runner(log), progress: (done, total) => progress.push(`${done}/${total}`) });
  assert.equal(report.applied.length, 7);
  assert.equal(report.skipped.length, 0);
  assert.equal(app.recipeSteps(), 7);
  assert.equal(app.undoActions.length, 7, "each fix is its own undo action");
  // The six cleans go to the worker together; the placeholder change is its own call.
  assert.equal(app.rebuilds, 2);
  assert.deepEqual(log, [
    "clean order_date",
    "clean state",
    "clean segment",
    "clean returned",
    "clean customer_name",
    "clean priority",
    "missing sales_rep",
  ]);
  assert.equal(progress[progress.length - 1], "7/7");
  assert.equal(fixReportText(report), "7 fixes applied");
});

test("two fixes on one column stack in order instead of the second replacing the first", () => {
  const app = new FakeApp();
  app.cleaned.set(1, [{ kind: "trim" }]);
  const issues = [
    issue("a", "state", [{ kind: "standardise", column: 1, pairs: [["nsw", "NSW"]], preview: [] }]),
    issue("b", "state", [{ kind: "standardise", column: 1, pairs: [["vic", "VIC"]], preview: [] }]),
  ];
  const plan: FixPlan = planFixes(issues, ["a", "b"], app.target());
  assert.deepEqual(plan.cleans, [
    { column: 1, ops: [{ kind: "trim" }, { kind: "recode", pairs: [["nsw", "NSW"]] }, { kind: "recode", pairs: [["vic", "VIC"]] }] },
  ]);
});

test("a fix that is already in place, or whose column is gone, is skipped and named", async () => {
  const app = new FakeApp();
  app.cleaned.set(1, [{ kind: "recode", pairs: [["nsw", "NSW"]] }]);
  app.missing.set(6, ["N/A", "-"]);
  const issues = sevenFixes();
  issues.push(issue("variants.99", "gone", [{ kind: "standardise", column: 99, pairs: [["a", "A"]], preview: [] }]));
  const plan = planFixes(issues, issues.map((entry) => entry.id), app.target());
  const report = await runFixPlan(plan, app.runner());
  assert.equal(report.applied.length, 5);
  assert.equal(app.recipeSteps(), 1 + 5, "the earlier recode plus five new steps");
  assert.equal(
    fixReportText(report),
    "5 of 8 fixes applied. Skipped: state (already applied), sales_rep (already treated as missing), gone (column no longer exists)",
  );
});

test("when the worker finds nothing to change, every clean fix is reported as skipped, never silently", async () => {
  const app = new FakeApp();
  const issues = sevenFixes().slice(1, 3);
  const plan = planFixes(issues, issues.map((entry) => entry.id), app.target());
  const runner = app.runner();
  const report = await runFixPlan(plan, { ...runner, clean: () => Promise.resolve("unchanged") });
  assert.equal(report.applied.length, 0);
  assert.equal(fixReportText(report), "No fixes applied. Skipped: state (already clean), segment (already clean)");
});

test("empty columns are dropped together, after every other fix", async () => {
  const app = new FakeApp();
  const issues = [
    issue("emptyColumn.7", "empty_col", [{ kind: "dropColumn", column: 7, preview: [] }]),
    ...sevenFixes().slice(1, 2),
    issue("placeholders.6", "sales_rep", [{ kind: "placeholders", column: 6, tokens: ["N/A"], preview: [] }]),
  ];
  const log: string[] = [];
  const report = await runFixPlan(planFixes(issues, issues.map((entry) => entry.id), app.target()), app.runner(log));
  assert.deepEqual(log, ["clean state", "missing sales_rep", "drop 7"]);
  assert.equal(fixReportText(report), "3 fixes applied");
});

test("the preview stays open while fixes run: Apply shows progress and a second press does nothing", async () => {
  const window = setupDom();
  const issues = sevenFixes();
  let runs = 0;
  let finish: (value: string) => void = () => undefined;
  let report: (done: number, total: number) => void = () => undefined;
  const result = openFixPreview(issues, (ids, progress) => {
    runs++;
    report = progress;
    assert.equal(ids.length, 7);
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  await tick();
  const doc = window.document;
  const apply = doc.querySelector(".fix-preview-modal .primary") as unknown as HTMLButtonElement;
  assert.equal(apply.textContent, "Apply 7 fixes");
  apply.click();
  assert.equal(apply.disabled, true);
  report(3, 7);
  assert.equal(apply.textContent, "Applying 3 of 7…");
  apply.click();
  (doc.querySelector(".fix-preview-modal .ghost") as unknown as HTMLButtonElement).click();
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(runs, 1);
  assert.ok(doc.querySelector(".fix-preview-modal") !== null, "Cancel and Escape wait for the run");
  finish("done");
  assert.equal(await result, "done");
  assert.equal(doc.querySelector(".fix-preview-modal"), null);
});

test("fixes applied together stay one Recipe row each, while the same clean made across columns by hand still condenses", () => {
  const entry = (column: number, single: boolean): StepsPanelEntry => ({
    kind: "clean",
    label: `col${column}: Standardise 2 spellings to the most common one`,
    detail: "clean → recode(2 pairs)",
    column,
    opIndex: 0,
    groupSize: 1,
    ...(single ? { single: true } : {}),
  });
  assert.equal(groupSteps([0, 1, 2, 3].map((column) => entry(column, true))).length, 4);
  assert.equal(groupSteps([0, 1, 2, 3].map((column) => entry(column, false))).length, 1);
});

/** Each change an action fires, as the app fires it: a latest-wins send that records its name when the worker answers. */
function changes(queue: SendQueue, ran: string[], names: readonly string[]): void {
  for (const name of names) queue.latest(() => new Promise((resolve) => setTimeout(() => (ran.push(name), resolve()), 1)));
}

// Recipe "Undo all" (onClearAll): reset transforms, clear every clean, put back each missing-value rule and each type.
const CLEAR_ALL = ["transforms reset", "cleans cleared", "nulls sales_rep", "nulls state", "type amount", "type when"];
// Toolbar Undo of one action holding a clean, two missing-value changes and a type change (undoLastStep).
const UNDO_LAST = ["clean undone", "nulls sales_rep", "nulls state", "type amount"];

for (const [name, sequence] of [["Recipe Undo all", CLEAR_ALL], ["Undo of a multi-step action", UNDO_LAST]] as const) {
  test(`${name}: every change reaches the worker in order (before, only the first and last did)`, async () => {
    const before: string[] = [];
    changes(new SendQueue(() => 1), before, sequence);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(before, [sequence[0], sequence[sequence.length - 1]], "the old behaviour drops the middle");

    const ran: string[] = [];
    const queue = new SendQueue(() => 1);
    queue.latest(() => new Promise((resolve) => setTimeout(() => (ran.push("query in flight"), resolve()), 1)));
    queue.ordered(() => changes(queue, ran, sequence));
    // A query typed afterwards still coalesces as before.
    queue.latest(() => Promise.resolve(void ran.push("query a")));
    queue.latest(() => Promise.resolve(void ran.push("query b")));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(ran, ["query in flight", ...sequence, "query b"]);
  });
}
