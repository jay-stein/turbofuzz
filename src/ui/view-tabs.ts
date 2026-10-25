import { el } from "./dom.js";

export type ViewId =
  | "overview"
  | "quality"
  | "table"
  | "views"
  | "outliers"
  | "relationships"
  | "chart";

export const VIEW_ORDER: readonly ViewId[] = [
  "overview",
  "quality",
  "table",
  "views",
  "outliers",
  "relationships",
  "chart",
];

/** Hint text derived from the tabs actually available, not a hardcoded range. */
export function viewSwitchHint(): string {
  return `switch anytime with 1–${VIEW_ORDER.length}`;
}

const LABELS: Record<ViewId, { label: string; title: string }> = {
  overview: {
    label: "Overview",
    title: "What this file is and what to do next",
  },
  quality: {
    label: "Data Quality",
    title: "The data-quality dashboard — score, checks, columns and fixes",
  },
  table: { label: "Table", title: "Show the row table" },
  views: {
    label: "Pivot View",
    title: "Build pivot tables - index, columns, values and aggregations",
  },
  chart: { label: "Chart", title: "Show a chart of the current result set" },
  outliers: {
    label: "Outliers",
    title: "Anomaly landscape, method agreement and the rows that stand out",
  },
  relationships: {
    label: "Relationships",
    title: "How columns — including text — move together: correlations, associations and dependencies",
  },
};

export interface ViewTabsCallbacks {
  /** Called when the user picks a tab (click or keyboard). */
  onChange: (view: ViewId) => void;
}

/**
 * `Overview | Data Quality | Table | Pivot View | Outliers | Relationships |
 * Chart` lens switcher with the ARIA tabs pattern: role=tablist, aria-selected
 * and roving tabindex. Lenses never alter data; they only change what is on
 * screen.
 */
export class ViewTabs {
  private readonly buttons = new Map<ViewId, HTMLButtonElement>();
  private view: ViewId = "overview";

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: ViewTabsCallbacks,
  ) {
    this.root.classList.add("view-tabs");
    this.root.setAttribute("role", "tablist");
    this.root.setAttribute("aria-label", "Views");

    for (const id of VIEW_ORDER) {
      const button = el(
        "button",
        {
          class: "view-tab",
          type: "button",
          role: "tab",
          id: `view-tab-${id}`,
          title: LABELS[id].title,
        },
        [LABELS[id].label],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => this.select(id));
      this.buttons.set(id, button);
      this.root.append(button);
    }
    this.root.addEventListener("keydown", (event) => this.onKeydown(event));
    this.sync();
  }

  /** The currently selected lens. */
  get selected(): ViewId {
    return this.view;
  }

  /** User-initiated selection: updates state, then notifies the app. */
  select(view: ViewId): void {
    this.setSelected(view);
    this.callbacks.onChange(view);
  }

  /** Programmatic selection (no callback); used by the app after it decides. */
  setSelected(view: ViewId): void {
    this.view = view;
    this.sync();
  }

  /** Small count badge (e.g. "3 ideas") or null to clear it. */
  setBadge(view: ViewId, label: string | null): void {
    const button = this.buttons.get(view);
    if (button === undefined) return;
    const existing = button.querySelector<HTMLElement>(".view-tab-badge");
    if (label === null) {
      existing?.remove();
      return;
    }
    const badge = existing ?? el("span", { class: "view-tab-badge" });
    badge.textContent = label;
    if (existing === null) button.append(badge);
  }

  /** Arrow-key navigation with roving tabindex, per the ARIA tabs pattern. */
  private onKeydown(event: KeyboardEvent): void {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const current = VIEW_ORDER.indexOf(this.view);
    if (current < 0) return;
    event.preventDefault();
    let next = current;
    if (event.key === "ArrowLeft") next = (current + VIEW_ORDER.length - 1) % VIEW_ORDER.length;
    else if (event.key === "ArrowRight") next = (current + 1) % VIEW_ORDER.length;
    else if (event.key === "Home") next = 0;
    else next = VIEW_ORDER.length - 1;
    this.select(VIEW_ORDER[next]);
    this.buttons.get(VIEW_ORDER[next])?.focus();
  }

  private sync(): void {
    for (const id of VIEW_ORDER) {
      const button = this.buttons.get(id);
      if (button === undefined) continue;
      const selected = id === this.view;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    }
  }
}
