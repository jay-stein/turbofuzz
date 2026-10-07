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

/**
 * Process Log: every clean, missing-value, type and transform change currently
 * baked into the dataset, each individually reversible, with cleans
 * reorderable within their column and a pandas recipe export of the pipeline.
 */
export function openStepsPanel(
  entries: readonly StepsPanelEntry[],
  callbacks: StepsPanelCallbacks,
): void {
  const overlay = el("div", { class: "modal-overlay drawer-overlay" });
  const modal = el("div", { class: "modal clean-modal drawer" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, [`Process Log (${entries.length})`]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const hint = el("div", { class: "clean-hint" }, [
    "Changes apply in order. The undo icon reverses a change; clean operations can be reordered within their column. The line under each entry is its technical signature.",
  ]);
  const list = el("div", { class: "clean-op-list" });
  modal.append(hint, list);

  const lastTransformIndex = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].kind === "transform") return i;
    }
    return -1;
  })();

  entries.forEach((entry, index) => {
    const row = el("div", { class: "clean-op" });
    const info = el("div", { class: "clean-op-info" });
    info.append(el("span", { class: "clean-op-desc" }, [entry.label]));
    if (entry.detail !== undefined) {
      info.append(el("span", { class: "clean-op-detail" }, [entry.detail]));
    }
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

    row.append(el("span", { class: "clean-op-index" }, [String(index + 1)]), info);

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

    list.append(row);
  });

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
