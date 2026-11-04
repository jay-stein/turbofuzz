import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface WorkspaceProgress {
  /** Moves the bar to `done` of the total, and says what is happening now. */
  update(done: number, label: string): void;
  close(): void;
}

/**
 * A panel over the whole page while a workspace file is replayed: what step is running and how far along it is. Nothing behind it is
 * seen to change, so the page does not flash through its pages; it ends on the Table.
 */
export function openWorkspaceProgress(name: string, total: number): WorkspaceProgress {
  const overlay = el("div", { class: "modal-overlay workspace-progress-overlay" });
  const modal = el("div", { class: "modal confirm-modal workspace-progress", role: "status" });
  const title = el("h2", {}, [`Opening ${name === "" ? "the workspace" : `“${name}”`}`]);
  const count = el("div", { class: "workspace-progress-count" }, [`Step 0 of ${total}`]);
  const track = el("div", { class: "workspace-progress-track" });
  const bar = el("div", { class: "workspace-progress-bar" });
  track.append(bar);
  const label = el("div", { class: "workspace-progress-label", "aria-live": "polite" }, ["Getting ready…"]);
  modal.append(title, count, track, label);
  overlay.append(modal);
  document.body.append(overlay);
  setupDialog(overlay, "Opening the workspace");
  return {
    update(done, text) {
      const shown = Math.max(0, Math.min(total, done));
      count.textContent = `Step ${shown} of ${total}`;
      bar.style.width = `${total === 0 ? 100 : Math.round((shown / total) * 100)}%`;
      label.textContent = text;
    },
    close() {
      overlay.remove();
    },
  };
}
