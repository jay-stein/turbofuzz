import type { KnnEvaluation, KnnPredictorScore } from "../data/knn.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface KnnTargetOption {
  index: number;
  name: string;
  missing: number;
}

export interface KnnDialogOptions {
  /** Columns with empty cells that a fill can write. */
  targets: KnnTargetOption[];
  initial: number;
  total: number;
  plan(target: number): Promise<{ missing: number; scores: KnnPredictorScore[] }>;
  evaluate(target: number, predictors: number[], k: number): Promise<KnnEvaluation | null>;
}

export interface KnnChoice {
  fill: number;
  predictors: number[];
  k: number;
  evaluation: KnnEvaluation | null;
  fillName: string;
  predictorNames: string[];
}

const n = (value: number): string => value.toLocaleString();

/** Strong, middling or weak, in words: the number alone means little to most people. */
export function strength(relatedness: number | null): { label: string; cls: "strong" | "some" | "weak" | "none" } {
  if (relatedness === null) return { label: "can't tell", cls: "none" };
  if (relatedness >= 0.5) return { label: "strong", cls: "strong" };
  if (relatedness >= 0.25) return { label: "some", cls: "some" };
  return { label: "weak", cls: "weak" };
}

/** How many of the others to tick for the person: the clearly related ones, a few at most. */
export function recommendedPredictors(scores: readonly KnnPredictorScore[]): number[] {
  return scores
    .filter((entry) => entry.reason === null && entry.relatedness !== null && entry.relatedness >= 0.2 && entry.missingShare <= 0.5)
    .sort((a, b) => (b.relatedness ?? 0) - (a.relatedness ?? 0))
    .slice(0, 6)
    .map((entry) => entry.index);
}

/** One sentence on how well the fill did on values it was not shown. */
export function accuracySentence(evaluation: KnnEvaluation, k: number, fillName: string): { text: string; tone: "good" | "okay" | "poor" } {
  const found = evaluation.results.find((entry) => entry.k === k) ?? evaluation.results.find((entry) => entry.k === evaluation.bestK);
  if (found === undefined || !Number.isFinite(found.score) || evaluation.tested === 0) {
    return { text: "Not enough known values to test this fill.", tone: "poor" };
  }
  const tested = n(evaluation.tested);
  if (evaluation.kind === "number") {
    const base = evaluation.baseline.score;
    const better = base > 0 ? 1 - found.score / base : 0;
    const typical = Number(found.score.toPrecision(3)).toLocaleString();
    const plain = Number(base.toPrecision(3)).toLocaleString();
    const lead = `Tested by hiding ${tested} known values of “${fillName}” and filling them back: typically off by ${typical}, against ${plain} if you had used the ${evaluation.baseline.name}.`;
    if (better >= 0.25) return { text: `${lead} That is ${Math.round(better * 100)}% closer: a clear gain.`, tone: "good" };
    if (better >= 0.08) return { text: `${lead} That is ${Math.round(better * 100)}% closer: a modest gain.`, tone: "okay" };
    return { text: `${lead} It is barely better than the ${evaluation.baseline.name}: these columns do not pin the value down, so the simple fill is about as good.`, tone: "poor" };
  }
  const right = Math.round(found.score * 100);
  const base = Math.round(evaluation.baseline.score * 100);
  const lead = `Tested by hiding ${tested} known values of “${fillName}” and filling them back: right ${right}% of the time, against ${base}% if you always chose the ${evaluation.baseline.name}.`;
  if (found.score - evaluation.baseline.score >= 0.15) return { text: `${lead} A clear gain.`, tone: "good" };
  if (found.score - evaluation.baseline.score >= 0.05) return { text: `${lead} A modest gain.`, tone: "okay" };
  return { text: `${lead} Barely better than guessing the most common value.`, tone: "poor" };
}

function kChart(evaluation: KnnEvaluation, selected: number, onPick: (k: number) => void): HTMLElement {
  const lowerIsBetter = evaluation.kind === "number";
  const scores = evaluation.results.map((entry) => entry.score).filter(Number.isFinite);
  const bestScore = lowerIsBetter ? Math.min(...scores) : Math.max(...scores);
  // For numbers, a full-height bar is the error of using the median: every k is read against it.
  const worst = Math.max(...scores, evaluation.baseline.score);
  const wrap = el("div", { class: "knn-kchart", role: "group", "aria-label": "Error for each number of neighbours" });
  for (const entry of evaluation.results) {
    const height = lowerIsBetter
      ? worst > 0 ? entry.score / worst : 0
      : entry.score;
    const bar = el("button", {
      class: `knn-kbar${entry.k === selected ? " on" : ""}${entry.k === evaluation.bestK ? " best" : ""}`,
      type: "button",
      title: lowerIsBetter
        ? `k = ${entry.k}: typically off by ${Number(entry.score.toPrecision(3)).toLocaleString()}`
        : `k = ${entry.k}: right ${Math.round(entry.score * 100)}% of the time`,
    });
    const column = el("span", { class: "knn-kfill" });
    column.style.height = `${Math.max(6, Math.min(100, height * 100)).toFixed(0)}%`;
    // Words, not colours, say which bar is which: "best" is the best in the test, "in use" is what will be filled with.
    const best = entry.k === evaluation.bestK, inUse = entry.k === selected;
    const flag = el("span", { class: "knn-kflag" }, [best && inUse ? "best · in use" : best ? "best" : inUse ? "in use" : ""]);
    bar.append(flag, column, el("span", { class: "knn-klabel" }, [String(entry.k)]));
    bar.addEventListener("click", () => onPick(entry.k));
    wrap.append(bar);
  }
  const plain = el("span", { class: "knn-kbar plain", title: `${evaluation.baseline.name}: ${lowerIsBetter ? `typically off by ${Number(evaluation.baseline.score.toPrecision(3)).toLocaleString()}` : `right ${Math.round(evaluation.baseline.score * 100)}% of the time`}` });
  const plainFill = el("span", { class: "knn-kfill" });
  plainFill.style.height = `${Math.max(6, Math.min(100, (lowerIsBetter ? (worst > 0 ? evaluation.baseline.score / worst : 0) : evaluation.baseline.score) * 100)).toFixed(0)}%`;
  plain.append(el("span", { class: "knn-kflag" }, ["plain fill"]), plainFill, el("span", { class: "knn-klabel" }, [lowerIsBetter ? "median" : "most common"]));
  wrap.append(plain);
  const holder = el("div", { class: "knn-kholder" });
  holder.append(
    el("div", { class: "knn-kaxis" }, [lowerIsBetter ? "Typical error: a shorter bar is better" : "How often it was right: a taller bar is better"]),
    wrap,
  );
  return holder;
}

/**
 * The KNN fill, built for choosing: the column to fill, which other columns
 * describe a similar row (ranked by how strongly each goes with it, the
 * column itself and unusable ones greyed with the reason), a k with a test
 * to pick it, and what the fill would write before anything changes.
 */
export function openKnnDialog(options: KnnDialogOptions): Promise<KnnChoice | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal knn-modal" });
    const head = el("div", { class: "modal-head" });
    const title = el("h2", {}, ["Fill empty cells from similar rows (k nearest neighbours)"]);
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(title, closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body knn-body" });
    const intro = el("p", { class: "clean-hint" });
    const targetSelect = el("select", { class: "text-input", "aria-label": "Column to fill" }) as HTMLSelectElement;
    for (const target of options.targets) {
      targetSelect.append(el("option", { value: String(target.index) }, [`${target.name} · ${n(target.missing)} empty`]));
    }
    targetSelect.value = String(options.initial);
    body.append(
      el("label", { class: "clean-field" }, [el("span", { class: "clean-label" }, ["Column to fill"]), targetSelect]),
      intro,
    );

    const listHead = el("div", { class: "knn-listhead" }, [
      el("span", { class: "clean-label" }, ["1 · Which columns describe a similar row?"]),
    ]);
    const find = el("input", { class: "text-input knn-find", type: "search", placeholder: "Find a column…", "aria-label": "Find a column", spellcheck: "false" }) as HTMLInputElement;
    const recommend = el("button", { class: "ghost small", type: "button", title: "Tick the columns that go most strongly with the one being filled" }, ["Use recommended"]);
    const none = el("button", { class: "ghost small", type: "button" }, ["Clear"]);
    listHead.append(el("span", { class: "grow" }), recommend, none);
    const list = el("div", { class: "knn-list", role: "group", "aria-label": "Columns that describe a similar row" });
    // The columns of the list named once, so the bar is not a mystery: it is how closely that column goes with the one being filled.
    const listCols = el("div", { class: "knn-item knn-listcols", "aria-hidden": "true" }, [
      el("span"), el("span", {}, ["Column"]), el("span", { class: "knn-listcols-wide" }, ["Kind · strength"]),
      el("span", { class: "knn-listcols-bar" }, ["How closely it goes with the column being filled"]),
    ]);
    body.append(listHead, find, listCols, list);
    body.append(
      el("p", { class: "clean-hint knn-note" }, [
        "Two rows count as similar when they are close on the ticked columns. Fill from a few columns that really go with the one being filled: unrelated ones only add noise.",
      ]),
    );

    const kRow = el("div", { class: "knn-krow" });
    const kInput = el("input", { class: "text-input knn-k", type: "number", min: "1", max: "100", value: "5", "aria-label": "Number of neighbours" }) as HTMLInputElement;
    const kHint = el("span", { class: "knn-khint" });
    const useBest = el("button", { class: "ghost small hidden", type: "button" }, ["Use the best"]);
    useBest.addEventListener("click", () => {
      if (evaluation === null) return;
      kInput.value = String(evaluation.bestK);
      kTouched = true;
      renderVerdict();
      scheduleEvaluate(true);
    });
    kRow.append(
      el("span", { class: "clean-label", title: "k is the number of most similar rows each empty cell borrows from" }, ["2 · How many similar rows to copy from? (k)"]),
      kInput,
      kHint,
      useBest,
    );
    const chart = el("div", { class: "knn-chartbox" });
    body.append(kRow, chart);

    const verdict = el("div", { class: "knn-verdict", role: "status", "aria-live": "polite" });
    body.append(el("span", { class: "clean-label knn-step3" }, ["3 · How well did it do on values it was not shown?"]));
    const preview = el("div", { class: "knn-preview" });
    body.append(verdict, preview);
    modal.append(body);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const apply = el("button", { class: "primary", type: "button" }, ["Fill cells"]);
    footer.append(cancel, el("span", { class: "grow" }), apply);
    modal.append(footer);

    let scores: KnnPredictorScore[] = [];
    let evaluation: KnnEvaluation | null = null;
    let missing = 0;
    let busy = false;
    let generation = 0;
    const ticked = new Set<number>();
    let kTouched = false;
    let timer = 0;

    const currentTarget = (): number => Number(targetSelect.value);
    const targetName = (): string => options.targets.find((target) => target.index === currentTarget())?.name ?? "column";
    const currentK = (): number => Math.max(1, Math.min(100, Math.round(Number(kInput.value) || 5)));

    const renderList = (): void => {
      list.replaceChildren();
      const query = find.value.trim().toLowerCase();
      const usable = scores.filter((entry) => entry.reason === null).sort((a, b) => (b.relatedness ?? -1) - (a.relatedness ?? -1));
      const unusable = scores.filter((entry) => entry.reason !== null);
      const recommended = new Set(recommendedPredictors(scores));
      for (const entry of [...usable, ...unusable]) {
        if (query !== "" && !entry.name.toLowerCase().includes(query)) continue;
        const disabled = entry.reason !== null;
        const box = el("input", { type: "checkbox", "aria-label": entry.name }) as HTMLInputElement;
        box.checked = !disabled && ticked.has(entry.index);
        box.disabled = disabled;
        const strong = strength(entry.relatedness);
        const meter = el("span", { class: `knn-meter ${strong.cls}`, title: entry.relatedness === null ? "Not enough rows with both values to tell" : `Goes with “${targetName()}”: ${Math.round(entry.relatedness * 100)}%` });
        const fill = el("i");
        fill.style.width = `${Math.round((entry.relatedness ?? 0) * 100)}%`;
        meter.append(fill);
        const detail = disabled
          ? entry.reason ?? ""
          : `${entry.kind === "number" ? "numbers" : "categories"} · ${strong.label}${entry.missingShare >= 0.2 ? ` · ${Math.round(entry.missingShare * 100)}% empty` : ""}`;
        const row = el("label", { class: `knn-item${disabled ? " disabled" : ""}` }, [
          box,
          el("span", { class: "knn-name" }, [entry.name]),
          recommended.has(entry.index) ? el("span", { class: "knn-rec" }, ["Recommended"]) : el("span"),
          el("span", { class: "knn-detail" }, [detail]),
          disabled ? el("span") : meter,
        ]);
        if (disabled) row.title = entry.reason ?? "";
        box.addEventListener("change", () => {
          if (box.checked) ticked.add(entry.index);
          else ticked.delete(entry.index);
          scheduleEvaluate();
        });
        list.append(row);
      }
      if (list.childElementCount === 0) list.append(el("p", { class: "clean-hint" }, ["No column matches."]));
    };

    const renderVerdict = (): void => {
      preview.replaceChildren();
      chart.replaceChildren();
      verdict.className = "knn-verdict";
      if (ticked.size === 0) {
        verdict.textContent = "Tick at least one column to measure similarity.";
        kHint.textContent = "";
        useBest.classList.add("hidden");
        return;
      }
      if (busy) {
        verdict.textContent = "Testing the fill…";
        return;
      }
      if (evaluation === null) {
        verdict.textContent = "This column cannot be filled this way.";
        return;
      }
      const k = currentK();
      const sentence = accuracySentence(evaluation, k, targetName());
      verdict.classList.add(sentence.tone);
      verdict.textContent = sentence.text;
      if (evaluation.thin) verdict.append(el("div", { class: "knn-thin" }, ["Few rows are available to test with, so treat this as a rough guide."]));
      kHint.textContent = k === evaluation.bestK ? `${k} is the best in the test, and it is in use` : `${k} in use; the test found ${evaluation.bestK} does best`;
      useBest.classList.toggle("hidden", k === evaluation.bestK);
      useBest.textContent = `Use ${evaluation.bestK}`;
      chart.append(
        el("div", { class: "clean-hint" }, [
          evaluation.kind === "number"
            ? "Each bar is a different k, tested by hiding known values and filling them back. The bar on the right is the plain fill (the median) to beat. A small k copies a few lookalikes and is noisy; a large k averages many and blurs real differences. Click a bar to use that k."
            : "Each bar is a different k, tested by hiding known values and filling them back. The bar on the right is always choosing the most common value, the plain fill to beat. Click a bar to use that k.",
        ]),
        kChart(evaluation, k, (value) => {
          kInput.value = String(value);
          kTouched = true;
          renderVerdict();
          scheduleEvaluate(true);
        }),
      );
      if (evaluation.preview.length > 0) {
        preview.append(el("div", { class: "clean-label" }, [`What it would write (${n(evaluation.missing)} cells in all)`]));
        const table = el("table", { class: "knn-sample" });
        table.append(el("thead", {}, [el("tr", {}, [el("th", {}, ["Row"]), el("th", {}, ["Would become"]), el("th", {}, ["Copied from rows"])])]));
        const bodyRows = el("tbody");
        for (const sample of evaluation.preview) {
          bodyRows.append(
            el("tr", {}, [
              el("td", {}, [n(sample.row + 1)]),
              el("td", {}, [el("strong", {}, [sample.value])]),
              el("td", { class: "knn-from" }, [sample.neighbours.map((row) => n(row + 1)).join(", ")]),
            ]),
          );
        }
        table.append(bodyRows);
        preview.append(table);
      }
    };

    const refreshApply = (): void => {
      apply.disabled = ticked.size === 0 || busy || missing === 0;
      apply.textContent = missing > 0 ? `Fill ${n(missing)} cells` : "Fill cells";
    };

    const evaluateNow = async (keepK: boolean): Promise<void> => {
      const mine = ++generation;
      if (ticked.size === 0) {
        evaluation = null;
        busy = false;
        renderVerdict();
        refreshApply();
        return;
      }
      busy = true;
      renderVerdict();
      refreshApply();
      const usedK = currentK();
      const result = await options.evaluate(currentTarget(), [...ticked], usedK).catch(() => null);
      if (mine !== generation) return;
      busy = false;
      evaluation = result;
      // Until the person chooses a k, the tested best is the one in use.
      if (result !== null && !kTouched && !keepK) {
        kInput.value = String(result.bestK);
        // The preview rows were filled with the k tested first: show them with the one now in use.
        if (result.bestK !== usedK) {
          renderVerdict();
          await evaluateNow(true);
          return;
        }
      }
      renderVerdict();
      refreshApply();
    };
    function scheduleEvaluate(keepK = false): void {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void evaluateNow(keepK), 350);
    }

    const loadTarget = async (): Promise<void> => {
      const mine = ++generation;
      busy = true;
      evaluation = null;
      ticked.clear();
      kTouched = false;
      list.replaceChildren(el("p", { class: "clean-hint" }, ["Looking at how the columns go with this one…"]));
      renderVerdict();
      refreshApply();
      const plan = await options.plan(currentTarget()).catch(() => null);
      if (mine !== generation) return;
      scores = plan?.scores ?? [];
      missing = plan?.missing ?? 0;
      const pct = options.total > 0 ? Math.round((missing / options.total) * 100) : 0;
      intro.textContent = `${n(missing)} empty cell${missing === 1 ? "" : "s"} in “${targetName()}” (${pct}% of ${n(options.total)} rows). Each is filled from the k nearest neighbours: the k rows most like it on the columns you tick below, so a house with two bedrooms and a small block borrows from other houses like it, not from every house. Three steps: pick the columns, pick k, check the test.`;
      for (const index of recommendedPredictors(scores)) ticked.add(index);
      busy = false;
      renderList();
      await evaluateNow(false);
    };

    targetSelect.addEventListener("change", () => void loadTarget());
    find.addEventListener("input", renderList);
    recommend.addEventListener("click", () => {
      ticked.clear();
      for (const index of recommendedPredictors(scores)) ticked.add(index);
      renderList();
      scheduleEvaluate();
    });
    none.addEventListener("click", () => {
      ticked.clear();
      renderList();
      scheduleEvaluate();
    });
    kInput.addEventListener("input", () => {
      kTouched = true;
      renderVerdict();
      scheduleEvaluate(true);
    });

    let settled = false;
    const finish = (value: KnnChoice | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    apply.addEventListener("click", () => {
      if (apply.disabled) return;
      finish({
        fill: currentTarget(),
        predictors: [...ticked],
        k: currentK(),
        evaluation,
        fillName: targetName(),
        predictorNames: scores.filter((entry) => ticked.has(entry.index)).map((entry) => entry.name),
      });
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Fill empty cells from similar rows (k nearest neighbours)");
    void loadTarget();
  });
}

export interface KnnResultOptions {
  fillName: string;
  filled: number;
  k: number;
  predictorNames: string[];
  evaluation: KnnEvaluation | null;
  /** Jump to a filled row in the table. */
  onShow(row: number): void;
  onUndo(): void;
}

/** What the fill just did: how many cells, how well it tested, and a few filled cells to go and look at. */
export function openKnnResult(options: KnnResultOptions): void {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal knn-modal knn-result" });
  const head = el("div", { class: "modal-head" });
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(el("h2", {}, [`Filled ${n(options.filled)} cell${options.filled === 1 ? "" : "s"} in “${options.fillName}”`]), closeButton);
  modal.append(head);
  const body = el("div", { class: "chart-setup-body knn-body" });
  body.append(
    el("p", { class: "clean-hint" }, [
      `Each came from its ${options.k} most similar row${options.k === 1 ? "" : "s"}, judged on ${options.predictorNames.join(", ")}. The filled cells are highlighted in the table (Show changes / Hide changes switches that), and the step is in the Recipe.`,
    ]),
  );
  if (options.evaluation !== null) {
    const sentence = accuracySentence(options.evaluation, options.k, options.fillName);
    body.append(el("div", { class: `knn-verdict ${sentence.tone}` }, [sentence.text]));
    if (options.evaluation.preview.length > 0) {
      body.append(el("div", { class: "clean-label" }, ["A few of the filled cells"]));
      const table = el("table", { class: "knn-sample" });
      table.append(el("thead", {}, [el("tr", {}, [el("th", {}, ["Row"]), el("th", {}, ["Filled with"]), el("th", {}, ["Copied from rows"]), el("th", {}, [""])])]));
      const rows = el("tbody");
      for (const sample of options.evaluation.preview) {
        const show = el("button", { class: "ghost small", type: "button" }, ["Show in table"]);
        show.addEventListener("click", () => {
          close();
          options.onShow(sample.row);
        });
        rows.append(
          el("tr", {}, [
            el("td", {}, [n(sample.row + 1)]),
            el("td", {}, [el("strong", {}, [sample.value])]),
            el("td", { class: "knn-from" }, [sample.neighbours.map((row) => n(row + 1)).join(", ")]),
            el("td", {}, [show]),
          ]),
        );
      }
      table.append(rows);
      body.append(table);
    }
  }
  modal.append(body);
  const footer = el("div", { class: "clean-footer" });
  const undo = el("button", { class: "ghost", type: "button", title: "Put the cells back as they were" }, ["Undo this fill"]);
  const done = el("button", { class: "primary", type: "button" }, ["Done"]);
  footer.append(undo, el("span", { class: "grow" }), done);
  modal.append(footer);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  closeButton.addEventListener("click", close);
  done.addEventListener("click", close);
  undo.addEventListener("click", () => {
    close();
    options.onUndo();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  overlay.append(modal);
  document.body.append(overlay);
  setupDialog(overlay, "KNN fill result");
}
