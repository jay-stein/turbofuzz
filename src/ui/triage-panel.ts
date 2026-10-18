import type { DatasetStats } from "../data/stats.js";
import {
  describeSuggestion,
  suggestionLabel,
  type ColumnSuggestion,
} from "../data/suggestions.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import { chipText } from "./chips.js";

export interface TriageCallbacks {
  onSuggestion(column: number, suggestion: ColumnSuggestion): void;
  onConvertToken(column: number, tokens: string[]): void;
  onOpenClean(column?: number, tab?: "values" | "nulls"): void;
  onDedupe(anchor: HTMLElement): void;
  /** The panel closed (the app clears its live handle). */
  onClose?(): void;
}

interface TriageItem {
  id: string;
  label: string;
  detail: string;
  impact: number;
  action: "fix" | "filter";
  fixLabel: string;
  /** True when clicking Apply should make the item disappear. */
  resolves: boolean;
  run(anchor: HTMLElement): void;
}

export interface TriagePanelHandle {
  /** Fresh metadata/stats: refresh the checklist in place. */
  update(metas: readonly ColumnMeta[], stats: DatasetStats): void;
  close(): void;
}

const FIXED_VISIBLE_MS = 4500;

/**
 * The triage queue: every suggested fix in one checklist, ranked by impact.
 * The panel stays live — as fixes land it re-renders from fresh metadata and
 * shows a green tick for the issues that were just cleared.
 */
export function openTriagePanel(
  metas: readonly ColumnMeta[],
  stats: DatasetStats,
  callbacks: TriageCallbacks,
): TriagePanelHandle {
  let currentMetas = metas;
  let currentStats = stats;
  let closed = false;
  /** Item ids waiting for confirmation (green tick) after Apply. */
  const applied = new Map<string, number>();
  const appliedLabels = new Map<string, string>();
  /** Confirmed fixes, shown with a green tick for a few seconds. */
  const fixedLog: { label: string; at: number }[] = [];

  const overlay = el("div", { class: "modal-overlay drawer-overlay" });
  const modal = el("div", { class: "modal clean-modal drawer" });
  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, ["Review issues"]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const hint = el("div", { class: "clean-hint" }, [
    "Every fix applies immediately and lands in the Recipe, where it can be undone. Fixed issues get a green tick and leave the list.",
  ]);
  const fixesHost = el("div", { class: "triage-fixed" });
  const list = el("div", { class: "triage-list" });
  modal.append(hint, fixesHost, list);

  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    callbacks.onClose?.();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  const buildItems = (): TriageItem[] => {
    const items: TriageItem[] = [];
    currentMetas.forEach((meta, column) => {
      for (const suggestion of meta.suggestions) {
        items.push({
          id: `suggestion-${column}-${suggestion.kind}`,
          label: `${meta.name}: ${suggestionLabel(suggestion)}`,
          detail: describeSuggestion(suggestion),
          impact: "count" in suggestion ? Number(suggestion.count) || 1 : 1,
          action: "fix",
          fixLabel: "Apply",
          resolves: true,
          run: () => callbacks.onSuggestion(column, suggestion),
        });
      }
      const tokens = meta.nullTokens.filter((token) => token.label !== "" && token.count > 0);
      if (tokens.length > 0) {
        const total = tokens.reduce((sum, token) => sum + token.count, 0);
        items.push({
          id: `tokens-${column}`,
          label: `${meta.name}: ${total.toLocaleString()} placeholder cells`,
          detail: `values like ${tokens
            .slice(0, 3)
            .map((token) => `“${token.label}”`)
            .join(", ")} are counted as missing but stored as text`,
          impact: total,
          action: "fix",
          fixLabel: "Convert to nulls",
          resolves: true,
          run: () => callbacks.onConvertToken(column, tokens.map((token) => token.label)),
        });
      }
      if (meta.stats.distinct === 1) {
        items.push({
          id: `constant-${column}`,
          label: `${meta.name}: single value`,
          detail: "every non-empty row carries the same value — the column may be droppable",
          impact: 1,
          action: "filter",
          fixLabel: "Review.",
          resolves: false,
          run: () => callbacks.onOpenClean(column, "values"),
        });
      }
      if (meta.stats.nulls > 0 && tokens.length === 0) {
        items.push({
          id: `nulls-${column}`,
          label: `${meta.name}: ${meta.stats.nulls.toLocaleString()} empty cells`,
          detail: "review the missing values, fill or drop them — applying a null policy cannot create data",
          impact: meta.stats.nulls,
          action: "filter",
          fixLabel: "Review.",
          resolves: false,
          run: () => callbacks.onOpenClean(column, "nulls"),
        });
      }
    });
    if (currentStats.duplicateRows > 0) {
      items.push({
        id: "duplicates",
        label: `${currentStats.duplicateRows.toLocaleString()} duplicate rows`,
        detail: `${currentStats.duplicateGroups.toLocaleString()} identical row group${
          currentStats.duplicateGroups === 1 ? "" : "s"
        } — keep one copy or remove all`,
        impact: currentStats.duplicateRows,
        action: "fix",
        fixLabel: "Remove.",
        resolves: true,
        run: (anchor) => callbacks.onDedupe(anchor),
      });
    }
    return items.sort((a, b) => b.impact - a.impact);
  };

  const render = (): void => {
    if (closed) return;
    const now = Date.now();
    // Expire old confirmations.
    for (let i = fixedLog.length - 1; i >= 0; i--) {
      if (now - (fixedLog[i]?.at ?? 0) > FIXED_VISIBLE_MS) fixedLog.splice(i, 1);
    }
    fixesHost.replaceChildren();
    for (const entry of fixedLog.slice(-3)) {
      fixesHost.append(el("div", { class: "triage-fixed-entry" }, [`✓ Fixed: ${entry.label}`]));
    }

    list.replaceChildren();
    const items = buildItems();
    if (items.length === 0) {
      list.append(el("div", { class: "triage-empty" }, ["✓ Nothing left to review."]));
      return;
    }
    for (const item of items) {
      const pendingAt = applied.get(item.id);
      const pending = item.resolves && pendingAt !== undefined && now - pendingAt < 8000;
      const row = el("div", { class: `triage-item${pending ? " fixed" : ""}` });
      const info = el("div", { class: "triage-info" });
      info.append(
        el("span", { class: "triage-label" }, [item.label]),
        el("span", { class: "triage-detail" }, [item.detail]),
      );
      row.append(info);
      if (pending) {
        row.append(el("span", { class: "triage-done" }, ["✓ Applied"]));
      } else {
        const fix = el(
          "button",
          { class: "primary small", type: "button", title: item.detail },
          [chipText(item.action, item.fixLabel)],
        ) as HTMLButtonElement;
        fix.addEventListener("click", () => {
          if (item.resolves) {
            applied.set(item.id, Date.now());
            appliedLabels.set(item.id, item.label);
            render();
          }
          item.run(fix);
        });
        row.append(fix);
      }
      list.append(row);
    }
  };

  const update = (nextMetas: readonly ColumnMeta[], nextStats: DatasetStats): void => {
    if (closed) return;
    currentMetas = nextMetas;
    currentStats = nextStats;
    const ids = new Set(buildItems().map((item) => item.id));
    // Confirmations: an applied item that is gone was fixed; an applied item
    // that still exists did not resolve, so drop the pending mark.
    for (const [id, at] of [...applied]) {
      if (!ids.has(id)) {
        fixedLog.push({ label: appliedLabels.get(id) ?? "Issue", at: Number(at) });
        applied.delete(id);
        appliedLabels.delete(id);
      } else {
        applied.delete(id);
        appliedLabels.delete(id);
      }
    }
    render();
    if (fixedLog.length > 0) {
      window.setTimeout(render, FIXED_VISIBLE_MS + 50);
    }
  };

  overlay.append(modal);
  document.body.append(overlay);
  setupDialog(overlay, "Review issues");
  render();

  return { update, close };
}
