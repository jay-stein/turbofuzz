import { symlog, symlogInverse } from "../data/symlog.js";
import { el } from "./dom.js";

export interface RangeSliderOptions {
  binCount: number;
  integer?: boolean;
  isDate?: boolean;
  /** Heavy-tailed columns: handles move on the signed-log axis of the bins. */
  symlog?: boolean;
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
    const span = this.tMax() - this.tMin();
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (this.toT(value) - this.tMin()) / span));
  }

  private toT(value: number): number {
    return this.options.symlog === true ? symlog(value) : value;
  }

  private fromT(t: number): number {
    return this.options.symlog === true ? symlogInverse(t) : t;
  }

  private tMin(): number {
    return this.toT(this.dataMin);
  }

  private tMax(): number {
    return this.toT(this.dataMax);
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
    const tMin = this.tMin();
    const tSpan = this.tMax() - tMin || 1;
    const binCount = this.bars.length;
    for (let i = 0; i < binCount; i++) {
      const binStart = this.fromT(tMin + (i / binCount) * tSpan);
      const binEnd = this.fromT(tMin + ((i + 1) / binCount) * tSpan);
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
    const tMin = this.tMin();
    return this.snap(this.fromT(tMin + fraction * (this.tMax() - tMin)));
  }

  private snap(value: number): number {
    if (this.options.integer === true) return Math.round(value);
    if (this.options.isDate === true) return Math.round(value / DAY_MS) * DAY_MS;
    const tMin = this.tMin();
    const tSpan = this.tMax() - tMin;
    if (tSpan <= 0) return this.dataMin;
    const step = tSpan / this.bars.length;
    const t = this.toT(value);
    return this.fromT(tMin + Math.round((t - tMin) / step) * step);
  }

  private outLo(): number | null {
    if (this.lo === null) return null;
    return this.toT(this.lo) - this.tMin() < (this.tMax() - this.tMin()) * 1e-9
      ? null
      : this.lo;
  }

  private outHi(): number | null {
    if (this.hi === null) return null;
    return this.tMax() - this.toT(this.hi) < (this.tMax() - this.tMin()) * 1e-9
      ? null
      : this.hi;
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
      const tMin = this.tMin();
      const tMax = this.tMax();
      const delta = ((event.clientX - drag.startX) / (rect.width || 1)) * (tMax - tMin);
      let loT = this.toT(drag.startLo) + delta;
      let hiT = this.toT(drag.startHi) + delta;
      if (loT < tMin) {
        hiT += tMin - loT;
        loT = tMin;
      }
      if (hiT > tMax) {
        loT -= hiT - tMax;
        hiT = tMax;
      }
      this.lo = this.snap(Math.max(this.dataMin, this.fromT(loT)));
      this.hi = this.snap(Math.min(this.dataMax, this.fromT(hiT)));
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
    const current = kind === "lo" ? this.lo ?? this.dataMin : this.hi ?? this.dataMax;
    let step: number;
    if (this.options.integer === true) {
      step = 1;
    } else if (this.options.isDate === true) {
      step = DAY_MS;
    } else if (this.options.symlog === true) {
      const tStep = (this.tMax() - this.tMin()) / this.bars.length;
      step = Math.abs(this.fromT(this.toT(current) + tStep) - current) || tStep;
    } else {
      step = (this.dataMax - this.dataMin) / this.bars.length;
    }
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
