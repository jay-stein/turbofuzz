import { el, svgIcon } from "./dom.js";

/**
 * General keeps the everyday lenses; Research adds Outliers, Relationships,
 * Time Series and Map. The mode only changes what is on screen, never the data.
 */
export type AppMode = "general" | "research";

const STORAGE_KEY = "turbofuzz-mode";

function isMode(value: string | null): value is AppMode {
  return value === "general" || value === "research";
}

export function readMode(): AppMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isMode(stored)) return stored;
  } catch {
    // Storage can be blocked; General is the safe default.
  }
  return "general";
}

export function writeMode(mode: AppMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Non-fatal: the mode still applies for this session.
  }
}

export function modeLabel(mode: AppMode): string {
  return mode === "research" ? "Research" : "General";
}

/** Stroke icons (24x24 box, like the tab icons): a compass and a flask. */
const OPTIONS: readonly { mode: AppMode; title: string; icon: string }[] = [
  {
    mode: "general",
    title: "Overview, Data Quality, Table, Pivot View and Chart",
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.8l-1.9 4.5-4.5 1.9 1.9-4.5z"/>',
  },
  {
    mode: "research",
    title: "Adds Outliers, Relationships, Time Series and Map to the tabs",
    icon: '<path d="M9.5 3h5M10.5 3v6.2L5 18.4A1.8 1.8 0 0 0 6.6 21h10.8a1.8 1.8 0 0 0 1.6-2.6L13.5 9.2V3"/><path d="M7.8 15h8.4"/>',
  },
];

export interface ModeSwitchCallbacks {
  /** Called when the user picks the other mode (click or keyboard). */
  onChange: (mode: AppMode) => void;
}

/**
 * Two-segment `General | Research` switch with a sliding thumb. Uses the ARIA
 * radio-group pattern: arrow keys move the choice, only the checked option is
 * in the tab order.
 */
export class ModeSwitch {
  readonly element: HTMLElement;
  private readonly buttons = new Map<AppMode, HTMLButtonElement>();

  constructor(
    private mode: AppMode,
    private readonly callbacks: ModeSwitchCallbacks,
  ) {
    this.element = el("div", { class: "mode-switch", role: "radiogroup", "aria-label": "Mode" }, [
      el("span", { class: "mode-switch-thumb", "aria-hidden": "true" }),
    ]);
    for (const option of OPTIONS) {
      const button = el(
        "button",
        { class: "mode-switch-option", type: "button", role: "radio", "data-mode": option.mode, title: option.title },
        [svgIcon(option.icon, "mode-switch-icon"), el("span", { class: "mode-switch-text" }, [modeLabel(option.mode)])],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => this.select(option.mode));
      this.buttons.set(option.mode, button);
      this.element.append(button);
    }
    this.element.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const next: AppMode = this.mode === "general" ? "research" : "general";
      this.select(next);
      this.buttons.get(next)?.focus();
    });
    this.sync();
  }

  get selected(): AppMode {
    return this.mode;
  }

  /** Programmatic selection (no callback). */
  setSelected(mode: AppMode): void {
    this.mode = mode;
    this.sync();
  }

  private select(mode: AppMode): void {
    if (mode === this.mode) return;
    this.setSelected(mode);
    this.callbacks.onChange(mode);
  }

  private sync(): void {
    this.element.dataset.mode = this.mode;
    for (const [mode, button] of this.buttons) {
      const checked = mode === this.mode;
      button.setAttribute("aria-checked", checked ? "true" : "false");
      button.tabIndex = checked ? 0 : -1;
    }
  }
}
