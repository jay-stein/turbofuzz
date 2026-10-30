import { el, svgIcon } from "./dom.js";

export type ViewId =
  | "overview"
  | "quality"
  | "table"
  | "views"
  | "outliers"
  | "relationships"
  | "chart"
  | "timeseries"
  | "map";

export const VIEW_ORDER: readonly ViewId[] = [
  "overview",
  "quality",
  "table",
  "views",
  "outliers",
  "relationships",
  "chart",
  "timeseries",
  "map",
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
  timeseries: {
    label: "Time Series",
    title: "Trend, season, forecast and typical patterns of one column over a date column",
  },
  map: {
    label: "Map",
    title: "Points and areas on a world map, over your own offline map picture if you load one",
  },
  outliers: {
    label: "Outliers",
    title: "Anomaly landscape, method agreement and the rows that stand out",
  },
  relationships: {
    label: "Relationships",
    title: "How columns — including text — move together: correlations, associations and dependencies",
  },
};

/** Stroke icons (24x24 box) so nine tabs fit; the name shows on the active tab and on hover or focus. */
const ICONS: Record<ViewId, string> = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  quality: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  views: '<path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/>',
  outliers: '<circle cx="6" cy="16" r="1.4"/><circle cx="10" cy="13.5" r="1.4"/><circle cx="13" cy="17.5" r="1.4"/><circle cx="8.5" cy="18.5" r="1.4"/><circle cx="18" cy="6" r="2.2"/>',
  relationships: '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.3 8.6l2.5 7M15.7 8.6l-2.5 7M8.5 7h7"/>',
  chart: '<path d="M5 20v-7M12 20V5M19 20V10"/>',
  timeseries: '<path d="M3 16l5-6 4 3 5-8 4 4"/><path d="M3 21h18"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
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
        [svgIcon(ICONS[id], "view-tab-icon"), el("span", { class: "view-tab-label" }, [LABELS[id].label])],
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
      if (selected && typeof button.scrollIntoView === "function") {
        button.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  }
}
