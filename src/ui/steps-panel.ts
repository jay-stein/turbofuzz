import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface StepsPanelEntry {
  kind: "clean" | "transform" | "rows";
  label: string;
  /** Column index for clean steps; -1 for transforms and removed rows. */
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
  onClearAll: () => void;
  onCopyRecipe: () => Promise<boolean>;
  onClose: () => void;
}

/**
 * Applied-steps list: every clean and transform currently baked into the
 * dataset, each individually removable, with cleans reorderable within their
 * column and a pandas recipe export of the whole pipeline.
 */
export function openStepsPanel(
  entries: readonly StepsPanelEntry[],
  callbacks: StepsPanelCallbacks,
): void {
  const overlay = el("div", { class: "modal-overlay drawer-overlay" });
  const modal = el("div", { class: "modal clean-modal drawer" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, [`Applied steps (${entries.length})`]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const hint = el("div", { class: "clean-hint" }, [
    "Steps apply in order. Undo removes a step; clean steps can be reordered within their column.",
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
    row.append(el("span", { class: "clean-op-index" }, [String(index + 1)]));
    row.append(el("span", { class: "clean-op-desc" }, [entry.label]));

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
      const remove = el("button", { class: "icon-btn", type: "button", title: "Undo step" }, ["×"]);
      remove.addEventListener("click", () => {
        callbacks.onRemoveClean(entry.column, entry.opIndex);
        callbacks.onClose();
      });
      row.append(up, down, remove);
    } else if (entry.kind === "rows") {
      const restore = el(
        "button",
        { class: "icon-btn", type: "button", title: "Restore the removed rows" },
        ["×"],
      );
      restore.addEventListener("click", () => {
        callbacks.onRestoreRows();
        callbacks.onClose();
      });
      row.append(restore);
    } else {
      const remove = el("button", { class: "icon-btn", type: "button" }, ["×"]);
      if (index === lastTransformIndex) {
        remove.title = "Undo this step";
        remove.addEventListener("click", () => {
          callbacks.onRemoveLastTransform();
          callbacks.onClose();
        });
      } else {
        remove.title = "Only the last transform step can be undone";
        remove.disabled = true;
      }
      row.append(remove);
    }

    list.append(row);
  });

  if (entries.length === 0) {
    list.append(el("div", { class: "clean-empty" }, ["No steps applied yet."]));
  }

  const footer = el("div", { class: "clean-footer" });
  const clearAll = el("button", { class: "ghost", type: "button" }, ["Clear all"]);
  clearAll.disabled = entries.length === 0;
  clearAll.addEventListener("click", () => {
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
  footer.append(clearAll, copy, el("span", { class: "grow" }));
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
  setupDialog(overlay, "Applied steps");
}
