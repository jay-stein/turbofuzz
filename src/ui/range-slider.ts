import { el } from "./dom.js";

export interface RangeSliderOptions {
  binCount: number;
  integer?: boolean;
  isDate?: boolean;
  onInput: (min: number | null, max: number | null, preview: boolean) => void;
}

const DAY_MS = 86_400_000;

type DragKind = "lo" | "hi" | "band";

interface DragState {
  kind: DragKind;
  startX: number;
  startLo: number;
  startHi: number;
}

/**
 * Dual-handle range brush drawn over a histogram. Pointer moves emit
 * `preview` updates (cheap count-only queries); releasing commits the final
 * value. Snapping to bin edges keeps the values quantised without asking the
 * worker for anything.
 */
export class RangeSlider {
  readonly el: HTMLElement;

  private readonly sliderEl: HTMLElement;
  private readonly bars: HTMLElement[] = [];
  private readonly band: HTMLElement;
  private readonly loHandle: HTMLElement;
  private readonly hiHandle: HTMLElement;
  private readonly options: RangeSliderOptions;

  private dataMin = 0;
  private dataMax = 1;
  private lo: number | null = null;
  private hi: number | null = null;
  private drag: DragState | null = null;

  constructor(options: RangeSliderOptions) {
    this.options = options;

    const histogram = el("div", { class: "histogram" });
    for (let i = 0; i < options.binCount; i++) {
      const bar = el("div", { class: "hist-bar" });
      this.bars.push(bar);
      histogram.append(bar);
    }

    this.band = el("div", { class: "range-band" });
    this.loHandle = el("div", {
      class: "range-handle lo",
      role: "slider",
      tabindex: "0",
      "aria-label": "Minimum",
    });
    this.hiHandle = el("div", {
      class: "range-handle hi",
      role: "slider",
      tabindex: "0",
      "aria-label": "Maximum",
    });

    this.sliderEl = el("div", { class: "range-slider" });
    this.sliderEl.append(histogram, this.band, this.loHandle, this.hiHandle);
    this.el = el("div", { class: "range-slider-wrap" }, [this.sliderEl]);

    this.loHandle.addEventListener("pointerdown", (event) => this.beginDrag(event, "lo"));
    this.hiHandle.addEventListener("pointerdown", (event) => this.beginDrag(event, "hi"));
    this.band.addEventListener("pointerdown", (event) => this.beginDrag(event, "band"));
    this.sliderEl.addEventListener("pointerdown", (event) => this.jumpTo(event));
    this.loHandle.addEventListener("keydown", (event) => this.onKey(event, "lo"));
    this.hiHandle.addEventListener("keydown", (event) => this.onKey(event, "hi"));

    this.render();
  }

  setBins(bins: number[]): void {
    let max = 0;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] > max) max = bins[i];
    }
    for (let i = 0; i < this.bars.length; i++) {
      const count = bins[i] ?? 0;
      const percent = max > 0 && count > 0 ? Math.max(3, (count / max) * 100) : 0;
      this.bars[i].style.height = `${percent}%`;
      this.bars[i].title = count.toLocaleString();
    }
  }

  setBounds(min: number, max: number): void {
    this.dataMin = min;
    this.dataMax = max;
    this.render();
  }

  setRange(min: number | null, max: number | null): void {
    this.lo = min;
    this.hi = max;
    this.render();
  }

  private fractionOf(value: number | null, fallback: number): number {
    if (value === null) return fallback;
    const span = this.dataMax - this.dataMin;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (value - this.dataMin) / span));
  }

  private render(): void {
    const loFraction = this.fractionOf(this.lo, 0);
    const hiFraction = this.fractionOf(this.hi, 1);

    this.loHandle.style.left = `${loFraction * 100}%`;
    this.hiHandle.style.left = `${hiFraction * 100}%`;
    this.loHandle.setAttribute("aria-valuenow", String(this.outLo() ?? this.dataMin));
    this.hiHandle.setAttribute("aria-valuenow", String(this.outHi() ?? this.dataMax));
    this.band.style.left = `${loFraction * 100}%`;
    this.band.style.width = `${Math.max(0, hiFraction - loFraction) * 100}%`;

    const noSelection = this.lo === null && this.hi === null;
    const span = this.dataMax - this.dataMin || 1;
    const binCount = this.bars.length;
    for (let i = 0; i < binCount; i++) {
      const binStart = this.dataMin + (i / binCount) * span;
      const binEnd = this.dataMin + ((i + 1) / binCount) * span;
      const selected =
        !noSelection &&
        (this.lo === null || binEnd > this.lo) &&
        (this.hi === null || binStart < this.hi);
      this.bars[i].classList.toggle("selected", selected);
      this.bars[i].classList.toggle("dimmed", !noSelection && !selected);
    }
  }

  private valueAt(clientX: number): number {
    const rect = this.sliderEl.getBoundingClientRect();
    const width = rect.width || 1;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / width));
    return this.snap(this.dataMin + fraction * (this.dataMax - this.dataMin));
  }

  private snap(value: number): number {
    if (this.options.integer === true) return Math.round(value);
    if (this.options.isDate === true) return Math.round(value / DAY_MS) * DAY_MS;
    const span = this.dataMax - this.dataMin;
    if (span <= 0) return this.dataMin;
    const step = span / this.bars.length;
    return this.dataMin + Math.round((value - this.dataMin) / step) * step;
  }

  private outLo(): number | null {
    return this.lo === null || this.lo <= this.dataMin ? null : this.lo;
  }

  private outHi(): number | null {
    return this.hi === null || this.hi >= this.dataMax ? null : this.hi;
  }

  private emit(preview: boolean): void {
    this.render();
    this.options.onInput(this.outLo(), this.outHi(), preview);
  }

  private beginDrag(event: PointerEvent, kind: DragKind): void {
    event.preventDefault();
    event.stopPropagation();
    this.drag = {
      kind,
      startX: event.clientX,
      startLo: this.lo ?? this.dataMin,
      startHi: this.hi ?? this.dataMax,
    };
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp, { once: true });
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.drag === null) return;
    const drag = this.drag;

    if (drag.kind === "lo") {
      const value = Math.min(this.valueAt(event.clientX), this.hi ?? this.dataMax);
      this.lo = value;
    } else if (drag.kind === "hi") {
      const value = Math.max(this.valueAt(event.clientX), this.lo ?? this.dataMin);
      this.hi = value;
    } else {
      const rect = this.sliderEl.getBoundingClientRect();
      const span = this.dataMax - this.dataMin;
      const delta = ((event.clientX - drag.startX) / (rect.width || 1)) * span;
      let lo = drag.startLo + delta;
      let hi = drag.startHi + delta;
      if (lo < this.dataMin) {
        hi += this.dataMin - lo;
        lo = this.dataMin;
      }
      if (hi > this.dataMax) {
        lo -= hi - this.dataMax;
        hi = this.dataMax;
      }
      this.lo = this.snap(Math.max(this.dataMin, lo));
      this.hi = this.snap(Math.min(this.dataMax, hi));
    }

    this.emit(true);
  };

  private readonly onPointerUp = (): void => {
    if (this.drag === null) return;
    this.drag = null;
    window.removeEventListener("pointermove", this.onPointerMove);
    this.emit(false);
  };

  private jumpTo(event: PointerEvent): void {
    if (event.target === this.loHandle || event.target === this.hiHandle || event.target === this.band) {
      return;
    }
    const value = this.valueAt(event.clientX);
    const loDistance = Math.abs(value - (this.lo ?? this.dataMin));
    const hiDistance = Math.abs(value - (this.hi ?? this.dataMax));
    const kind: DragKind = loDistance <= hiDistance ? "lo" : "hi";
    if (kind === "lo") this.lo = Math.min(value, this.hi ?? this.dataMax);
    else this.hi = Math.max(value, this.lo ?? this.dataMin);
    this.emit(false);
    this.beginDrag(event, kind);
  }

  private onKey(event: KeyboardEvent, kind: "lo" | "hi"): void {
    const step =
      this.options.integer === true
        ? 1
        : this.options.isDate === true
          ? DAY_MS
          : (this.dataMax - this.dataMin) / this.bars.length;
    let delta = 0;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") delta = -step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") delta = step;
    else if (event.key === "Home") delta = this.dataMin - (kind === "lo" ? this.lo ?? this.dataMin : this.hi ?? this.dataMax);
    else if (event.key === "End") delta = this.dataMax - (kind === "lo" ? this.lo ?? this.dataMin : this.hi ?? this.dataMax);
    if (delta === 0) return;

    event.preventDefault();
    if (kind === "lo") {
      this.lo = Math.min(
        Math.max(this.dataMin, (this.lo ?? this.dataMin) + delta),
        this.hi ?? this.dataMax,
      );
    } else {
      this.hi = Math.max(
        Math.min(this.dataMax, (this.hi ?? this.dataMax) + delta),
        this.lo ?? this.dataMin,
      );
    }
    this.emit(false);
  }
}
