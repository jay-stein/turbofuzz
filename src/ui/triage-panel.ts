import type { DatasetStats } from "../data/stats.js";
import {
  describeSuggestion,
  suggestionLabel,
  type ColumnSuggestion,
} from "../data/suggestions.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface TriageCallbacks {
  onSuggestion(column: number, suggestion: ColumnSuggestion): void;
  onConvertToken(column: number, tokens: string[]): void;
  onOpenClean(column?: number, tab?: "values" | "nulls"): void;
  onDedupe(anchor: HTMLElement): void;
}

interface TriageItem {
  id: string;
  label: string;
  detail: string;
  impact: number;
  fixLabel: string;
  run(anchor: HTMLElement): void;
}

/**
 * The triage queue: every suggested fix in one checklist, ranked by impact,
 * with the fix applied in place. It is the Overview health card's "Review all"
 * destination and shares the exact actions of the fix chips.
 */
export function openTriagePanel(
  metas: readonly ColumnMeta[],
  stats: DatasetStats,
  callbacks: TriageCallbacks,
): void {
  const overlay = el("div", { class: "modal-overlay drawer-overlay" });
  const modal = el("div", { class: "modal clean-modal drawer" });
  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, ["Review issues"]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const hint = el("div", { class: "clean-hint" }, [
    "Every fix applies immediately and lands in the Recipe, where it can be undone. The list refreshes as issues are resolved.",
  ]);
  const list = el("div", { class: "triage-list" });
  modal.append(hint, list);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
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
    metas.forEach((meta, column) => {
      for (const suggestion of meta.suggestions) {
        items.push({
          id: `suggestion-${column}-${suggestion.kind}`,
          label: `${meta.name}: ${suggestionLabel(suggestion)}`,
          detail: describeSuggestion(suggestion),
          impact: "count" in suggestion ? Number(suggestion.count) || 1 : 1,
          fixLabel: "Apply",
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
          fixLabel: "Convert to nulls",
          run: () => callbacks.onConvertToken(column, tokens.map((token) => token.label)),
        });
      }
      if (meta.stats.distinct === 1) {
        items.push({
          id: `constant-${column}`,
          label: `${meta.name}: single value`,
          detail: "every non-empty row carries the same value — the column may be droppable",
          impact: 1,
          fixLabel: "Review",
          run: () => callbacks.onOpenClean(column, "values"),
        });
      }
      if (meta.stats.nulls > 0 && tokens.length === 0) {
        items.push({
          id: `nulls-${column}`,
          label: `${meta.name}: ${meta.stats.nulls.toLocaleString()} empty cells`,
          detail: "review the missing values or fill them from the Transform panel",
          impact: meta.stats.nulls,
          fixLabel: "Review",
          run: () => callbacks.onOpenClean(column, "nulls"),
        });
      }
    });
    if (stats.duplicateRows > 0) {
      items.push({
        id: "duplicates",
        label: `${stats.duplicateRows.toLocaleString()} duplicate rows`,
        detail: `${stats.duplicateGroups.toLocaleString()} identical row group${
          stats.duplicateGroups === 1 ? "" : "s"
        } — keep one copy or remove all`,
        impact: stats.duplicateRows,
        fixLabel: "Remove…",
        run: (anchor) => callbacks.onDedupe(anchor),
      });
    }
    return items.sort((a, b) => b.impact - a.impact);
  };

  const render = (): void => {
    list.replaceChildren();
    const items = buildItems();
    if (items.length === 0) {
      list.append(el("div", { class: "triage-empty" }, ["✓ Nothing left to review."]));
      return;
    }
    for (const item of items) {
      const row = el("div", { class: "triage-item" });
      const info = el("div", { class: "triage-info" });
      info.append(
        el("span", { class: "triage-label" }, [item.label]),
        el("span", { class: "triage-detail" }, [item.detail]),
      );
      const fix = el(
        "button",
        { class: "primary small", type: "button", title: item.detail },
        [item.fixLabel],
      ) as HTMLButtonElement;
      fix.addEventListener("click", () => {
        item.run(fix);
        // Fixes are undoable from the Recipe; refresh the queue's own view once
        // the app has applied the change.
        window.setTimeout(render, 350);
      });
      row.append(info, fix);
      list.append(row);
    }
  };

  overlay.append(modal);
  document.body.append(overlay);
  setupDialog(overlay, "Review issues");
  render();
}
