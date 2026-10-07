import { clear, el } from "./dom.js";
import type { CleanOp } from "../data/clean-ops.js";
import { clusterSimilar, type SimilarCluster } from "../search/similar.js";
import type { ColumnMeta } from "../worker/protocol.js";

export interface MergePanelCallbacks {
  onApply: (column: number, ops: CleanOp[]) => void;
  onClose: () => void;
}

const LEVELS: readonly { value: string; label: string }[] = [
  { value: "0.94", label: "Strict (near-identical)" },
  { value: "0.9", label: "Standard" },
  { value: "0.84", label: "Loose (more suggestions)" },
];

/**
 * Merge similar values: clusters a category column's labels with the same
 * Jaro-Winkler matcher used by fuzzy search, suggests the most frequent
 * spelling as canonical, and turns the accepted merges into literal replace
 * cleans so they stay non-destructive and visible in the steps list.
 */
export function openMergePanel(
  meta: ColumnMeta,
  column: number,
  callbacks: MergePanelCallbacks,
): void {
  const overlay = el("div", { class: "modal-overlay drawer-overlay" });
  const modal = el("div", { class: "modal clean-modal drawer" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, [`Merge similar values — ${meta.name}`]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const labels = meta.categories?.labels ?? [];
  const counts = meta.categories?.counts ?? [];
  const values = labels.map((value, index) => ({ value, count: counts[index] }));

  const levelField = el("label", { class: "clean-field" });
  levelField.append(el("span", { class: "clean-label" }, ["Match"]));
  const levelSelect = el("select") as HTMLSelectElement;
  for (const { value, label } of LEVELS) {
    levelSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
  }
  levelSelect.value = "0.9";
  levelField.append(levelSelect);

  const hint = el("div", { class: "clean-hint" }, [
    "Pick the spelling to keep for each group. Merged values are rewritten with literal find-and-replace steps you can undo.",
  ]);

  const list = el("div", { class: "merge-list" });
  const summary = el("div", { class: "clean-summary" });

  type Selection = { canonical: string; included: Set<string> };
  let selections = new Map<number, Selection>();
  let clusters: SimilarCluster[] = [];

  function rebuild(): void {
    clusters = clusterSimilar(values, Number(levelSelect.value));
    selections = new Map();
    clusters.forEach((cluster, index) => {
      selections.set(index, {
        canonical: cluster.suggested,
        included: new Set(cluster.values.map((entry) => entry.value)),
      });
    });
    render();
  }

  function selectedMerges(): { find: string; replacement: string; count: number }[] {
    const merges: { find: string; replacement: string; count: number }[] = [];
    clusters.forEach((cluster, index) => {
      const selection = selections.get(index);
      if (selection === undefined) return;
      for (const member of cluster.values) {
        if (member.value === selection.canonical) continue;
        if (!selection.included.has(member.value)) continue;
        merges.push({
          find: member.value,
          replacement: selection.canonical,
          count: member.count,
        });
      }
    });
    return merges;
  }

  function selectedOps(): CleanOp[] {
    return selectedMerges().map(({ find, replacement }) => ({
      kind: "replace",
      find,
      replacement,
      ignoreCase: false,
    }));
  }

  function render(): void {
    clear(list);
    if (values.length === 0) {
      list.append(el("div", { class: "clean-empty" }, ["This column has no category values."]));
      summary.textContent = "Nothing to merge.";
      return;
    }
    if (clusters.length === 0) {
      list.append(
        el("div", { class: "clean-empty" }, ["No similar values found at this match level."]),
      );
      summary.textContent = "No merges suggested.";
      return;
    }

    clusters.forEach((cluster, index) => {
      const selection = selections.get(index);
      if (selection === undefined) return;
      const card = el("div", { class: "merge-cluster" });
      const clusterHead = el("div", { class: "merge-canonical" });
      clusterHead.append(el("span", { class: "clean-label" }, ["Keep"]));
      const canonicalSelect = el("select", { class: "merge-select" }) as HTMLSelectElement;
      for (const member of cluster.values) {
        const option = el(
          "option",
          { value: member.value },
          [`${member.value} (${member.count.toLocaleString()})`],
        ) as HTMLOptionElement;
        if (member.value === selection.canonical) option.selected = true;
        canonicalSelect.append(option);
      }
      canonicalSelect.addEventListener("change", () => {
        selection.canonical = canonicalSelect.value;
        updateSummary();
        render();
      });
      clusterHead.append(canonicalSelect);
      card.append(clusterHead);

      for (const member of cluster.values) {
        const isCanonical = member.value === selection.canonical;
        const row = el("label", { class: "merge-row" });
        const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
        checkbox.checked = isCanonical || selection.included.has(member.value);
        checkbox.disabled = isCanonical;
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selection.included.add(member.value);
          else selection.included.delete(member.value);
          updateSummary();
        });
        row.append(
          checkbox,
          el("span", { class: "merge-value", title: member.value }, [member.value]),
          el("span", { class: "value-count" }, [member.count.toLocaleString()]),
          ...(isCanonical ? [el("span", { class: "merge-keep" }, ["keep"])] : []),
        );
        card.append(row);
      }
      list.append(card);
    });
    updateSummary();
  }

  function updateSummary(): void {
    const merges = selectedMerges();
    const affected = merges.reduce((sum, merge) => sum + merge.count, 0);
    summary.textContent =
      merges.length === 0
        ? "No merges selected."
        : `${merges.length} value${merges.length === 1 ? "" : "s"} merged (${affected.toLocaleString()} rows affected)`;
  }

  levelSelect.addEventListener("change", rebuild);

  const footer = el("div", { class: "clean-footer" });
  const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
  cancel.addEventListener("click", close);
  const apply = el("button", { class: "primary", type: "button" }, ["Apply merges"]);
  apply.addEventListener("click", () => {
    const ops = selectedOps();
    if (ops.length > 0) callbacks.onApply(column, ops);
    close();
  });
  footer.append(cancel, el("span", { class: "grow" }), apply);
  modal.append(levelField, hint, list, summary, footer);

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    callbacks.onClose();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  rebuild();
  overlay.append(modal);
  document.body.append(overlay);
}
