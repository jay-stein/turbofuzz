import { n, plural } from "../data/dq-copy.js";
import {
  approvedCount,
  cellsChanged,
  groupCells,
  initGroups,
  pairsFor,
  resetToMostCommon,
  type ReviewGroup,
} from "../data/standardise-review.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface StandardiseReviewInput {
  columnName: string;
  groups: readonly { spellings: readonly { value: string; count: number }[] }[];
  /** Cells holding a placeholder (N/A, -) that the fix would also treat as empty; 0 when none. */
  placeholderCells: number;
}

export interface StandardiseReviewResult {
  pairs: [string, string][];
  treatPlaceholders: boolean;
}

const PAGE = 25;

/**
 * Review spelling groups one by one. The most common spelling is the proposed
 * standard, but any spelling can be made the standard (click it, or use Swap on a
 * pair), the user can type their own, and any group can be left alone. Nothing is
 * applied until Apply; resolves with the from -> to pairs, or null when cancelled.
 */
export function openStandardiseReview(input: StandardiseReviewInput): Promise<StandardiseReviewResult | null> {
  return new Promise((resolve) => {
    const groups: ReviewGroup[] = initGroups(input.groups);
    let shown = PAGE;
    let filter = "";

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal std-review-modal", role: "dialog", "aria-label": "Choose spellings" });
    const head = el("div", { class: "modal-head" }, [el("h2", {}, [`Choose the standard for “${input.columnName}”`])]);
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body" });
    body.append(
      el("p", { class: "confirm-body" }, [
        "Each group is one value written several ways. Every option shows what would change and what it would become. The numbers beside each spelling are how many cells use it. The most frequent spelling is suggested and ticked because keeping it means the fewest cells change. Tick a different option to use that one instead, or untick them all to leave the group as it is. Nothing changes until you press Apply.",
      ]),
    );

    const toolbar = el("div", { class: "std-toolbar" });
    const search = el("input", { type: "search", placeholder: "Find a spelling…", "aria-label": "Find a spelling" }) as HTMLInputElement;
    const allOn = el("button", { class: "ghost small", type: "button" }, ["Approve all"]);
    const allOff = el("button", { class: "ghost small", type: "button" }, ["Skip all"]);
    const reset = el("button", { class: "ghost small", type: "button" }, ["Use most common everywhere"]);
    toolbar.append(search, allOn, allOff, reset);
    body.append(toolbar);

    const list = el("div", { class: "std-groups" });
    body.append(list);
    const more = el("button", { class: "ghost outlined std-more", type: "button" }, ["Show more"]);
    body.append(more);

    let placeholderBox: HTMLInputElement | null = null;
    if (input.placeholderCells > 0) {
      placeholderBox = el("input", { type: "checkbox" }) as HTMLInputElement;
      placeholderBox.checked = true;
      body.append(
        el("label", { class: "std-placeholders" }, [
          placeholderBox,
          ` Also treat ${n(input.placeholderCells)} placeholder ${plural(input.placeholderCells, "cell", "cells")} (N/A, -) as empty`,
        ]),
      );
    }
    const summary = el("div", { class: "cast-summary", role: "status" });
    body.append(summary);
    modal.append(body);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const apply = el("button", { class: "primary", type: "button" }, ["Apply"]);
    footer.append(cancel, el("span", { class: "grow" }), apply);
    modal.append(footer);

    const matches = (group: ReviewGroup): boolean =>
      filter === "" || group.spellings.some((s) => s.value.toLowerCase().includes(filter));

    const refreshSummary = (): void => {
      const count = approvedCount(groups);
      const cells = cellsChanged(groups);
      const extra = placeholderBox?.checked === true ? input.placeholderCells : 0;
      summary.textContent =
        count === 0 && extra === 0
          ? "Nothing selected."
          : `${n(count)} of ${n(groups.length)} ${plural(groups.length, "group", "groups")} will change · ${n(cells)} ${plural(cells, "cell", "cells")}${extra > 0 ? ` · ${n(extra)} placeholder ${plural(extra, "cell", "cells")} emptied` : ""}`;
      apply.disabled = count === 0 && extra === 0;
      apply.textContent = count === 1 ? "Apply 1 group" : `Apply ${count} groups`;
    };

    const buildGroup = (group: ReviewGroup, index: number): HTMLElement => {
      const status = el("span", { class: "std-cells" }, []);
      const options = el("div", { class: "std-options", role: "group", "aria-label": `Options for group ${index + 1}` });
      const custom = el("input", { type: "text", class: "std-custom", placeholder: "type the standard…", "aria-label": "Type your own standard" }) as HTMLInputElement;
      const fieldset = el("fieldset", { class: "std-group" }, [
        el("div", { class: "std-group-head" }, [
          el("span", { class: "std-group-title" }, [`“${group.spellings[0]!.value.toLowerCase()}” written ${group.spellings.length} ways`]),
          status,
        ]),
        options,
      ]);
      const isCustom = (): boolean => !group.spellings.some((spelling) => spelling.value === group.standard);
      const update = (): void => {
        const changed = group.approved ? groupCells(group) : 0;
        status.textContent = group.approved ? `${n(changed)} ${plural(changed, "cell", "cells")} will change` : "left as it is";
        fieldset.classList.toggle("is-skipped", !group.approved);
        for (const row of options.querySelectorAll<HTMLElement>(".std-option")) {
          const on = group.approved && (row.dataset.custom === "1" ? isCustom() : !isCustom() && row.dataset.value === group.standard);
          row.classList.toggle("is-chosen", on);
          (row.querySelector("input[type=checkbox]") as HTMLInputElement).checked = on;
        }
      };
      const choose = (value: string): void => {
        group.standard = value;
        group.approved = true;
        update();
        refreshSummary();
      };
      const skip = (): void => {
        group.approved = false;
        update();
        refreshSummary();
      };

      group.spellings.forEach((target, optionIndex) => {
        const others = group.spellings.filter((spelling) => spelling !== target);
        const box = el("input", { type: "checkbox", "aria-label": `Option ${optionIndex + 1}: change to ${target.value}` }) as HTMLInputElement;
        const cellsIf = others.reduce((sum, spelling) => sum + spelling.count, 0);
        const row = el(
          "label",
          { class: `std-option${optionIndex === 0 ? " is-suggested" : ""}`, "data-value": target.value },
          [
            box,
            el("span", { class: "std-opt-n" }, [`Option ${optionIndex + 1}`]),
            el("span", { class: "std-from" }, others.flatMap((spelling, i) => [
              i > 0 ? el("span", { class: "std-sep" }, [","]) : "",
              el("code", {}, [spelling.value]),
              el("span", { class: "std-count" }, [n(spelling.count)]),
            ])),
            el("span", { class: "std-to-arrow", "aria-hidden": "true" }, ["→"]),
            el("code", { class: "std-to" }, [target.value]),
            el("span", { class: "std-cost" }, [`changes ${n(cellsIf)} ${plural(cellsIf, "cell", "cells")}`]),
            optionIndex === 0 ? el("span", { class: "std-badge" }, ["Suggested · most frequent, so the fewest cells change"]) : "",
          ],
        );
        box.addEventListener("change", () => (box.checked ? choose(target.value) : skip()));
        options.append(row);
      });

      const customBox = el("input", { type: "checkbox", "aria-label": "Use your own standard" }) as HTMLInputElement;
      const customRow = el("label", { class: "std-option", "data-custom": "1", "data-value": "" }, [
        customBox,
        el("span", { class: "std-opt-n" }, [`Option ${group.spellings.length + 1}`]),
        el("span", { class: "std-from" }, [el("em", {}, ["all of them"])]),
        el("span", { class: "std-to-arrow", "aria-hidden": "true" }, ["→"]),
        custom,
      ]);
      customBox.addEventListener("change", () => {
        if (!customBox.checked) return skip();
        if (custom.value.trim() === "") {
          custom.focus();
          customBox.checked = false;
          return;
        }
        choose(custom.value.trim());
      });
      custom.addEventListener("input", () => {
        const text = custom.value.trim();
        if (text === "") return skip();
        customRow.dataset.value = text;
        choose(text);
      });
      options.append(customRow);
      update();
      return fieldset;
    };

    const renderList = (): void => {
      list.replaceChildren();
      const visible = groups.map((group, index) => ({ group, index })).filter(({ group }) => matches(group));
      for (const { group, index } of visible.slice(0, shown)) list.append(buildGroup(group, index));
      if (visible.length === 0) list.append(el("div", { class: "qp-empty-state" }, ["No spelling matches that search."]));
      const left = visible.length - shown;
      more.classList.toggle("hidden", left <= 0);
      more.textContent = `Show ${Math.min(PAGE, left)} more (${n(left)} left)`;
      refreshSummary();
    };

    search.addEventListener("input", () => {
      filter = search.value.trim().toLowerCase();
      shown = PAGE;
      renderList();
    });
    more.addEventListener("click", () => {
      shown += PAGE;
      renderList();
    });
    allOn.addEventListener("click", () => {
      for (const group of groups) group.approved = true;
      renderList();
    });
    allOff.addEventListener("click", () => {
      for (const group of groups) group.approved = false;
      renderList();
    });
    reset.addEventListener("click", () => {
      resetToMostCommon(groups);
      renderList();
    });
    placeholderBox?.addEventListener("change", refreshSummary);

    let settled = false;
    const finish = (value: StandardiseReviewResult | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    apply.addEventListener("click", () => {
      if (apply.disabled) return;
      finish({ pairs: pairsFor(groups), treatPlaceholders: placeholderBox?.checked === true });
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Choose spellings");
    renderList();
  });
}
