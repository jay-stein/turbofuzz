import { el, svgIcon } from "./dom.js";

/** One thing a page needs, checked against this table: met (✓) or missing (✗), and what was found. */
export interface EmptyNeed {
  ok: boolean;
  label: string;
  detail: string;
}

export interface EmptyAction {
  label: string;
  title?: string;
  primary?: boolean;
  run(): void;
}

export interface EmptyStateSpec {
  /** Inner SVG markup in a 24×24 box, drawn large and muted. */
  icon: string;
  title: string;
  lead: string;
  needs: readonly EmptyNeed[];
  actions?: readonly EmptyAction[];
  /** A quieter line under the actions. */
  foot?: string;
  /** "page" fills the page's middle; "banner" sits above content that still works (the Map). */
  layout?: "page" | "banner";
}

const TICK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const CROSS = '<path d="M7 7l10 10M17 7L7 17"/>';

/**
 * The card a page shows when this table has nothing for it: a big headline that says so in plain words, a
 * "What this page needs" checklist ticked or crossed against the table itself, and the buttons that fix it.
 * Never a blank page, never a paragraph to read before you can tell what is wrong.
 */
export function emptyState(spec: EmptyStateSpec): HTMLElement {
  const list = el("ul", { class: "page-empty-needs", "aria-label": "What this page needs" });
  for (const need of spec.needs) {
    list.append(
      el("li", { class: need.ok ? "ok" : "missing" }, [
        el("span", { class: "page-empty-mark", "aria-hidden": "true" }, [svgIcon(need.ok ? TICK : CROSS, "page-empty-mark-icon")]),
        el("span", { class: "page-empty-need" }, [
          el("span", { class: "sr-only" }, [need.ok ? "Found: " : "Missing: "]),
          el("strong", {}, [need.label]),
          el("span", { class: "page-empty-detail" }, [need.detail]),
        ]),
      ]),
    );
  }
  const card = el("section", { class: `page-empty page-empty-${spec.layout ?? "page"}`, role: "status" }, [
    el("div", { class: "page-empty-icon", "aria-hidden": "true" }, [svgIcon(spec.icon, "page-empty-icon-svg")]),
    el("div", { class: "page-empty-body" }, [
      el("h2", { class: "page-empty-title" }, [spec.title]),
      el("p", { class: "page-empty-lead" }, [spec.lead]),
      el("div", { class: "page-empty-needs-head" }, ["What this page needs"]),
      list,
    ]),
  ]);
  const body = card.querySelector(".page-empty-body")!;
  if (spec.actions !== undefined && spec.actions.length > 0) {
    const row = el("div", { class: "page-empty-actions" });
    for (const action of spec.actions) {
      const button = el(
        "button",
        { class: action.primary === true ? "primary" : "ghost", type: "button", ...(action.title === undefined ? {} : { title: action.title }) },
        [action.label],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => action.run());
      row.append(button);
    }
    body.append(row);
  }
  if (spec.foot !== undefined) body.append(el("p", { class: "page-empty-foot" }, [spec.foot]));
  return card;
}

/** Icons for the empty pages, matching the tab icons. */
export const EMPTY_ICONS = {
  timeseries: '<path d="M3 16l5-6 4 3 5-8 4 4"/><path d="M3 21h18"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  relationships: '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.3 8.6l2.5 7M15.7 8.6l-2.5 7M8.5 7h7"/>',
} as const;
