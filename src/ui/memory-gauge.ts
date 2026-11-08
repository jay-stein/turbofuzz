import { formatMemory, memoryLimit, memoryTone, type MemoryLimit, type MemoryTone } from "../data/memory.js";
import { el } from "./dom.js";
import type { SearchWorkerClient } from "./worker-client.js";

const SVG_NS = "http://www.w3.org/2000/svg";
/** How often the gauge refreshes while the tab is visible, and how often the browser may be asked to measure. */
const REFRESH_MS = 30_000;
const MEASURE_MS = 20_000;

export interface MemoryState {
  /** The app's own estimates: the loaded data (A), undo copies, indexes and caches, and B while comparing. */
  data: number;
  undo: number;
  caches: number;
  compare: number;
  /** The whole tab as the browser measured it (page and workers), when it allows that. */
  measured: number | null;
  limit: MemoryLimit;
  /** navigator.deviceMemory in GB, when the browser shares it (rounded, capped at 8). */
  deviceGb: number | null;
}

interface ChromiumMemory {
  memory?: { jsHeapSizeLimit?: number };
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
}

/** What the gauge shows as in use: the measured tab when there is one, else the data estimate. */
export function usedBytes(state: MemoryState): number {
  return state.measured ?? estimatedBytes(state);
}

/** Everything the app's own estimate counts. */
export function estimatedBytes(state: MemoryState): number {
  return state.data + state.undo + state.caches + state.compare;
}

/**
 * Keeps the memory figures fresh for the gauges: the worker's estimate of
 * the data after each load and every 30 seconds while the tab is visible,
 * and, where the browser allows (cross-origin isolated Chromium), its own
 * measurement of the whole tab.
 */
export class MemoryMonitor {
  state: MemoryState;
  private readonly listeners = new Set<(state: MemoryState) => void>();
  private lastMeasure = 0;
  private timer = 0;
  private soonTimer = 0;
  private busy = false;
  /** Set when the browser refuses to measure (some builds expose the call but do not allow it): stop asking. */
  private measureRefused = false;

  constructor(private readonly client: SearchWorkerClient) {
    const perf = performance as unknown as ChromiumMemory;
    const deviceGb = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null;
    this.state = {
      data: 0,
      undo: 0,
      caches: 0,
      compare: 0,
      measured: null,
      limit: memoryLimit({ heapLimit: perf.memory?.jsHeapSizeLimit ?? null, deviceMemoryGb: deviceGb }),
      deviceGb,
    };
    this.timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void this.refresh();
    }, REFRESH_MS);
  }

  /** True when the browser can measure the whole tab (Chromium, cross-origin isolated). */
  get canMeasure(): boolean {
    return !this.measureRefused && typeof (performance as unknown as ChromiumMemory).measureUserAgentSpecificMemory === "function" && globalThis.crossOriginIsolated === true;
  }

  subscribe(listener: (state: MemoryState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** Asks the worker (and, at most every 20 s, the browser) for fresh figures. */
  async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const message = await this.client.memory().catch(() => null);
      if (message !== null) {
        this.state = { ...this.state, data: message.dataBytes, undo: message.undoBytes, caches: message.cacheBytes, compare: message.compareBytes };
      }
      this.emit();
      const now = Date.now();
      if (this.canMeasure && now - this.lastMeasure >= MEASURE_MS) {
        this.lastMeasure = now;
        const perf = performance as unknown as ChromiumMemory;
        // The browser measures after its next garbage collection, which can take a few seconds.
        const result = await perf.measureUserAgentSpecificMemory!().catch(() => null);
        if (result !== null) this.state = { ...this.state, measured: result.bytes };
        else this.measureRefused = true;
        this.emit();
      }
    } finally {
      this.busy = false;
    }
  }

  /** A refresh a moment after the data changed, however many changes come in a burst. */
  soon(): void {
    window.clearTimeout(this.soonTimer);
    this.soonTimer = window.setTimeout(() => void this.refresh(), 800);
  }

  dispose(): void {
    window.clearInterval(this.timer);
    window.clearTimeout(this.soonTimer);
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

/** A ring that fills with the share of the limit in use. */
function ring(size: number, stroke: number): { svg: SVGSVGElement; set(share: number): void } {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "mem-ring");
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const track = document.createElementNS(SVG_NS, "circle");
  const arc = document.createElementNS(SVG_NS, "circle");
  for (const circle of [track, arc]) {
    circle.setAttribute("cx", String(size / 2));
    circle.setAttribute("cy", String(size / 2));
    circle.setAttribute("r", String(r));
    circle.setAttribute("stroke-width", String(stroke));
    circle.setAttribute("fill", "none");
  }
  track.setAttribute("class", "mem-ring-track");
  arc.setAttribute("class", "mem-ring-arc");
  arc.setAttribute("stroke-linecap", "round");
  arc.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
  arc.setAttribute("stroke-dasharray", String(circumference));
  svg.append(track, arc);
  return {
    svg,
    set(share: number) {
      // A sliver always shows, so the ring never reads as broken when little is in use.
      const shown = Math.max(0.03, Math.min(1, share));
      arc.setAttribute("stroke-dashoffset", String(circumference * (1 - shown)));
    },
  };
}

const TONE_TEXT: Record<MemoryTone, string> = {
  ok: "Plenty of room",
  warn: "Getting full",
  high: "Close to the limit",
};

/**
 * The memory gauge: a small ring and the figure in use, coloured by how close
 * it is to what the browser allows one tab; click for the details.
 */
export function memoryGauge(monitor: MemoryMonitor): HTMLButtonElement {
  const small = ring(18, 3);
  const label = el("span", { class: "mem-label" });
  const button = el("button", { class: "mem-gauge ghost small", type: "button", "aria-haspopup": "dialog" }, [small.svg, label]) as HTMLButtonElement;
  monitor.subscribe((state) => {
    const used = usedBytes(state);
    const tone = memoryTone(used, state.limit.bytes);
    const share = used / state.limit.bytes;
    small.set(share);
    label.textContent = formatMemory(used);
    button.dataset.tone = tone;
    button.classList.toggle("hidden", state.data + state.compare === 0);
    const text = `Memory: ${formatMemory(used)} of about ${formatMemory(state.limit.bytes)} (${Math.round(share * 100)}%). ${TONE_TEXT[tone]}.`;
    button.title = text;
    button.setAttribute("aria-label", text);
  });
  button.addEventListener("click", () => openMemoryPanel(button, monitor));
  return button;
}

function openMemoryPanel(anchor: HTMLElement, monitor: MemoryMonitor): void {
  for (const stale of document.querySelectorAll(".mem-panel")) stale.remove();
  const big = ring(64, 7);
  const percent = el("span", { class: "mem-panel-percent" });
  const headline = el("div", { class: "mem-panel-headline" });
  const rows = el("dl", { class: "mem-panel-rows" });
  const note = el("p", { class: "mem-panel-note" });
  const panel = el("div", { class: "mem-panel", role: "dialog", "aria-label": "Memory" }, [
    el("div", { class: "mem-panel-top" }, [el("div", { class: "mem-panel-ring" }, [big.svg, percent]), headline]),
    rows,
    note,
  ]);
  const row = (term: string, value: string, hint?: string): void => {
    rows.append(el("dt", {}, [term]), el("dd", {}, [value, hint === undefined ? "" : el("span", { class: "mem-hint" }, [hint])]));
  };
  const draw = (state: MemoryState): void => {
    const used = usedBytes(state);
    const share = used / state.limit.bytes;
    const tone = memoryTone(used, state.limit.bytes);
    panel.dataset.tone = tone;
    big.set(share);
    percent.textContent = `${Math.round(share * 100)}%`;
    headline.replaceChildren(
      el("span", { class: "mem-panel-title" }, [TONE_TEXT[tone]]),
      el("span", { class: "mem-panel-sub" }, [`${formatMemory(used)} of about ${formatMemory(state.limit.bytes)}`]),
    );
    rows.replaceChildren();
    row(state.compare > 0 ? "Data (A)" : "Data", `≈ ${formatMemory(state.data)}`, "the table as it is now");
    if (state.undo > 0) row("Undo history", `≈ ${formatMemory(state.undo)}`, "kept so steps can be undone");
    if (state.caches > 0) row("Search and sort indexes", `≈ ${formatMemory(state.caches)}`, "built as you search, sort and filter");
    if (state.compare > 0) row("Compare (B)", `≈ ${formatMemory(state.compare)}`, "B and the match");
    row("This tab", state.measured === null ? "not measured" : formatMemory(state.measured), state.measured === null ? (monitor.canMeasure ? "measuring…" : "this browser does not say") : "measured by the browser");
    // Browsers round the device memory and stop at 8 GB (more would help sites track people), so 64 GB also reads "8 or more".
    if (state.deviceGb === null) row("This device", "not shared by this browser");
    else if (state.deviceGb >= 8) row("This device", "8 GB or more", "browsers never report more than 8 GB");
    else row("This device", `about ${state.deviceGb} GB`, "as the browser rounds it");
    row(
      "Limit for one tab",
      `≈ ${formatMemory(state.limit.bytes)}`,
      state.limit.source === "browser" ? "as the browser reports it" : state.limit.source === "device" ? "from the device memory" : "a safe assumption",
    );
    note.textContent =
      "Browsers stop a tab long before a computer's memory is full, so the gauge compares with what one tab may use. The data figures are the app's own estimate of what it holds; the tab figure, where shown, is the browser's measurement and includes the app itself.";
  };
  const unsubscribe = monitor.subscribe(draw);
  void monitor.refresh();

  const close = (): void => {
    unsubscribe();
    panel.remove();
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("keydown", onKey, true);
    anchor.setAttribute("aria-expanded", "false");
  };
  const onPointer = (event: PointerEvent): void => {
    if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      anchor.focus();
    }
  };
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("keydown", onKey, true);
  anchor.setAttribute("aria-expanded", "true");
  document.body.append(panel);
  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 6}px`;
  panel.style.left = `${Math.max(8, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8))}px`;
}
