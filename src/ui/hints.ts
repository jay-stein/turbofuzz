import { el } from "./dom.js";

export interface HintSpec {
  id: string;
  text: string;
  /** The element to anchor to, or null when it is not on screen yet. */
  target: () => HTMLElement | null;
}

const KEY = "turbofuzz.hints.seen";

export function readSeenHints(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function markHintSeen(id: string): void {
  try {
    const seen = readSeenHints();
    seen.add(id);
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    // Storage can be unavailable — hints simply reappear next session.
  }
}

function isVisible(target: HTMLElement): boolean {
  if (!target.isConnected) return false;
  if (target.closest(".hidden") !== null) return false;
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * One-time, non-modal hints anchored to a control. They show one at a time,
 * dismiss with × or Escape, never block input (the callout ignores pointer
 * events except its close button) and are remembered under
 * `turbofuzz.hints.seen`.
 */
export class Hints {
  private current: HTMLElement | null = null;
  private currentId: string | null = null;
  private timer: number | null = null;
  private readonly seen: Set<string>;

  constructor(private readonly specs: readonly HintSpec[]) {
    this.seen = readSeenHints();
    document.addEventListener("keydown", this.onKey);
  }

  dispose(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    document.removeEventListener("keydown", this.onKey);
    this.current?.remove();
    this.current = null;
    this.currentId = null;
  }

  /** Shows the first unseen hint whose anchor is visible, one at a time. */
  refresh(): void {
    if (this.current !== null) return;
    for (const spec of this.specs) {
      if (this.seen.has(spec.id)) continue;
      const target = spec.target();
      if (target === null || !isVisible(target)) continue;
      this.show(spec);
      return;
    }
  }

  private show(spec: HintSpec): void {
    const callout = el("div", { class: "hint-callout", role: "note" });
    callout.append(el("span", { class: "hint-callout-text" }, [spec.text]));
    const close = el(
      "button",
      { class: "hint-callout-close", type: "button", "aria-label": "Dismiss hint" },
      ["×"],
    );
    close.addEventListener("click", () => this.dismiss());
    callout.append(close);
    document.body.append(callout);
    this.current = callout;
    this.currentId = spec.id;
    // Auto-dismiss after 6s so a hint never lingers over the data.
    const id = spec.id;
    this.timer = window.setTimeout(() => {
      if (this.currentId === id) this.dismiss();
    }, 6000);
  }

  private dismiss(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.currentId !== null) {
      this.seen.add(this.currentId);
      markHintSeen(this.currentId);
    }
    this.current?.remove();
    this.current = null;
    this.currentId = null;
    this.refresh();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.current !== null) this.dismiss();
  };
}
