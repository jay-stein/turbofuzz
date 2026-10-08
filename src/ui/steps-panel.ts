import { setupDialog } from "./dialog.js";
import { el, svgIcon } from "./dom.js";

export interface StepsPanelEntry {
  kind: "clean" | "transform" | "rows" | "nulls" | "type";
  label: string;
  /** Technical signature shown under the label (Power BI-style detail). */
  detail?: string;
  /** Column index for clean/null/type steps; -1 for transforms and removed rows. */
  column: number;
  opIndex: number;
  /** Number of ops in the same group (used to enable reorder buttons). */
  groupSize: number;
  /** Optional batch membership; consecutive entries with the same id collapse. */
  group?: { id: string; label: string; detail?: string };
}

export interface StepsGroup {
  id: string;
  label: string;
  detail?: string;
  entries: StepsPanelEntry[];
}

export interface StepsPanelCallbacks {
  onRemoveClean: (column: number, opIndex: number) => void;
  onMoveClean: (column: number, opIndex: number, direction: -1 | 1) => void;
  onRemoveLastTransform: () => void;
  onRestoreRows: () => void;
  onUndoPolicy: (column: number, opIndex: number) => void;
  onUndoType: (column: number, opIndex: number) => void;
  onClearAll: () => void;
  onCopyRecipe: () => Promise<boolean>;
  onClose: () => void;
}

const UNDO_ICON =
  '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>';

function undoIcon(): SVGElement {
  return svgIcon(UNDO_ICON, "undo-icon");
}

function cleanDescription(label: string): string {
  const separator = label.indexOf(": ");
  return separator < 0 ? label : label.slice(separator + 2);
}

/**
 * Condenses the flat step list into display groups. Explicit batches (for
 * example the ops applied by one Transform commit) collapse by their group id;
 * consecutive identical clean operations across three or more columns are
 * recognised as a single "apply to all columns" action; everything else stays
 * a single row.
 */
export function groupSteps(entries: readonly StepsPanelEntry[]): StepsGroup[] {
  const groups: StepsGroup[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (entry.group !== undefined) {
      const id = entry.group.id;
      const members: StepsPanelEntry[] = [];
      while (index < entries.length && entries[index].group?.id === id) {
        members.push(entries[index++]);
      }
      groups.push({ id, label: entry.group.label, detail: entry.group.detail, entries: members });
      continue;
    }

    if (entry.kind === "clean") {
      const blockStart = index;
      const perColumn = entry.groupSize;
      const detailKey = JSON.stringify(
        entries.slice(index, index + perColumn).map((member) => member.detail ?? ""),
      );
      const columns = new Set<number>();
      let cursor = index;
      while (cursor + perColumn <= entries.length) {
        const current = entries[cursor];
        if (
          current.kind !== "clean" ||
          current.group !== undefined ||
          current.groupSize !== perColumn
        ) {
          break;
        }
        const blockKey = JSON.stringify(
          entries.slice(cursor, cursor + perColumn).map((member) => member.detail ?? ""),
        );
        if (blockKey !== detailKey) break;
        let distinct = true;
        for (let offset = 0; offset < perColumn; offset++) {
          if (columns.has(entries[cursor + offset].column)) {
            distinct = false;
            break;
          }
        }
        if (!distinct) break;
        for (let offset = 0; offset < perColumn; offset++) {
          columns.add(entries[cursor + offset].column);
        }
        cursor += perColumn;
      }

      if (columns.size >= 3) {
        const descriptions: string[] = [];
        for (let offset = 0; offset < perColumn; offset++) {
          descriptions.push(cleanDescription(entries[blockStart + offset].label));
        }
        groups.push({
          id: `clean-batch-${blockStart}`,
          label:
            perColumn === 1
              ? `${descriptions[0]} · ${columns.size} columns`
              : `${perColumn} operations · ${columns.size} columns`,
          detail: descriptions.join(" → "),
          entries: entries.slice(blockStart, cursor),
        });
        index = cursor;
        continue;
      }
    }

    groups.push({ id: `single-${index}`, label: entry.label, entries: [entry] });
    index++;
  }
  return groups;
}

/**
 * Process Log: every clean, missing-value, type and transform change currently
 * baked into the dataset, each individually reversible, with cleans
 * reorderable within their column and a pandas recipe export of the pipeline.
 * Batches from a single action are condensed under a + toggle.
 */
export function openStepsPanel(
  entries: readonly StepsPanelEntry[],
  callbacks: StepsPanelCallbacks,
): void {
  const groups = groupSteps(entries);
  const overlay = el("div", { class: "modal-overlay drawer-overlay" });
  const modal = el("div", { class: "modal clean-modal drawer" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, [`Process Log (${groups.length})`]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const hint = el("div", { class: "clean-hint" }, [
    "Changes apply in order. Batches from one action are condensed — click + to show their sub-steps. The undo icon reverses a change; clean operations can be reordered within their column.",
  ]);
  const list = el("div", { class: "clean-op-list" });
  modal.append(hint, list);

  const lastTransformIndex = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].kind === "transform") return i;
    }
    return -1;
  })();
  const indexOf = new Map<StepsPanelEntry, number>();
  entries.forEach((entry, index) => indexOf.set(entry, index));

  const undo = (title: string, action: () => void, disabled = false): HTMLButtonElement => {
    const button = el("button", { class: "icon-btn undo-btn", type: "button", title }, []);
    button.append(undoIcon());
    button.disabled = disabled;
    if (!disabled) {
      button.addEventListener("click", () => {
        action();
        callbacks.onClose();
      });
    }
    return button;
  };

  const renderRow = (entry: StepsPanelEntry, numberText: string, substep: boolean): HTMLElement => {
    const row = el("div", { class: `clean-op${substep ? " step-substep" : ""}` });
    const info = el("div", { class: "clean-op-info" });
    info.append(el("span", { class: "clean-op-desc" }, [entry.label]));
    if (entry.detail !== undefined) {
      info.append(el("span", { class: "clean-op-detail" }, [entry.detail]));
    }
    row.append(el("span", { class: "clean-op-index" }, [numberText]), info);

    if (entry.kind === "clean") {
      const up = el("button", { class: "icon-btn", type: "button", title: "Move up" }, ["↑"]);
      up.disabled = entry.opIndex === 0;
      up.addEventListener("click", () => {
        callbacks.onMoveClean(entry.column, entry.opIndex, -1);
        callbacks.onClose();
      });
      const down = el("button", { class: "icon-btn", type: "button", title: "Move down" }, ["↓"]);
      down.disabled = entry.opIndex >= entry.groupSize - 1;
      down.addEventListener("click", () => {
        callbacks.onMoveClean(entry.column, entry.opIndex, 1);
        callbacks.onClose();
      });
      row.append(
        up,
        down,
        undo("Undo this step", () => callbacks.onRemoveClean(entry.column, entry.opIndex)),
      );
    } else if (entry.kind === "rows") {
      row.append(undo("Undo the row deletions", () => callbacks.onRestoreRows()));
    } else if (entry.kind === "nulls") {
      row.append(
        undo("Undo this missing-value change", () =>
          callbacks.onUndoPolicy(entry.column, entry.opIndex),
        ),
      );
    } else if (entry.kind === "type") {
      row.append(
        undo("Undo this type change", () => callbacks.onUndoType(entry.column, entry.opIndex)),
      );
    } else {
      const index = indexOf.get(entry) ?? -1;
      row.append(
        undo(
          index === lastTransformIndex
            ? "Undo this step"
            : "Only the last transform step can be undone",
          () => callbacks.onRemoveLastTransform(),
          index !== lastTransformIndex,
        ),
      );
    }
    return row;
  };

  let display = 0;
  for (const group of groups) {
    if (group.entries.length === 1) {
      display++;
      list.append(renderRow(group.entries[0], String(display), false));
      continue;
    }

    display++;
    const wrapper = el("div", { class: "clean-op step-group" });
    const toggle = el(
      "button",
      { class: "icon-btn step-toggle", type: "button", title: "Show sub-steps" },
      ["+"],
    ) as HTMLButtonElement;
    const info = el("div", { class: "clean-op-info" });
    info.append(el("span", { class: "clean-op-desc" }, [group.label]));
    info.append(
      el("span", { class: "clean-op-detail" }, [group.detail ?? `${group.entries.length} steps`]),
    );
    wrapper.append(
      el("span", { class: "clean-op-index" }, [String(display)]),
      info,
      el("span", { class: "step-count" }, [`${group.entries.length} steps`]),
      toggle,
    );
    const children = el("div", { class: "step-group-children hidden" });
    group.entries.forEach((entry, sub) => {
      children.append(renderRow(entry, `${display}.${sub + 1}`, true));
    });
    wrapper.append(children);
    toggle.addEventListener("click", () => {
      const hidden = children.classList.toggle("hidden");
      toggle.textContent = hidden ? "+" : "−";
      toggle.title = hidden ? "Show sub-steps" : "Hide sub-steps";
    });
    list.append(wrapper);
  }

  if (entries.length === 0) {
    list.append(el("div", { class: "clean-empty" }, ["No changes logged yet."]));
  }

  const footer = el("div", { class: "clean-footer" });
  const undoAll = el("button", { class: "ghost", type: "button" }, ["Undo all"]);
  undoAll.title = "Undo every applied change and restore the original data";
  undoAll.disabled = entries.length === 0;
  undoAll.addEventListener("click", () => {
    callbacks.onClearAll();
    callbacks.onClose();
  });
  const copy = el("button", { class: "ghost", type: "button" }, ["Copy pandas recipe"]);
  copy.disabled = entries.length === 0;
  copy.addEventListener("click", () => {
    void callbacks.onCopyRecipe().then((ok) => {
      copy.textContent = ok ? "Copied" : "Clipboard blocked";
      window.setTimeout(() => {
        copy.textContent = "Copy pandas recipe";
      }, 2000);
    });
  });
  footer.append(undoAll, copy, el("span", { class: "grow" }));
  modal.append(footer);

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

  overlay.append(modal);
  document.body.append(overlay);
  setupDialog(overlay, "Process Log");
}
