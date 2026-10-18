import { rampAt } from "../data/palettes.js";

export interface ColorDomainInput {
  autoMin: number;
  autoMax: number;
  min?: number | null;
  max?: number | null;
  center?: number | null;
}

export interface ColorDomain {
  min: number;
  max: number;
  autoMin: number;
  autoMax: number;
  fixed: boolean;
  centered: boolean;
}

/** One auto/manual/diverging domain shared by every numeric colour path. */
export function resolveColorDomain(input: ColorDomainInput): ColorDomain {
  const fixedMin = input.min !== null && input.min !== undefined && Number.isFinite(input.min);
  const fixedMax = input.max !== null && input.max !== undefined && Number.isFinite(input.max);
  let min = fixedMin ? (input.min as number) : input.autoMin;
  let max = fixedMax ? (input.max as number) : input.autoMax;
  if (!(max > min)) max = min + 1;
  let centered = false;
  const center =
    input.center !== null && input.center !== undefined && Number.isFinite(input.center)
      ? input.center
      : null;
  if (center !== null && min < center && center < max) {
    const span = Math.max(center - min, max - center);
    min = center - span;
    max = center + span;
    centered = true;
  }
  return {
    min,
    max,
    autoMin: input.autoMin,
    autoMax: input.autoMax,
    fixed: fixedMin || fixedMax,
    centered,
  };
}

/** 0..1 position inside a resolved domain; values outside clamp. */
export function colorFraction(value: number, domain: ColorDomain): number {
  if (!Number.isFinite(value)) return 0.5;
  const span = domain.max - domain.min;
  return span > 0 ? Math.min(1, Math.max(0, (value - domain.min) / span)) : 0.5;
}

/** A sampled ramp for bucketed rendering, with a deterministic fallback. */
export function colorRamp(
  stops: readonly string[] | null,
  count: number,
  fallback: (t: number) => string,
): string[] {
  const safeCount = Math.max(2, Math.floor(count));
  return Array.from({ length: safeCount }, (_, index) => {
    const t = safeCount === 1 ? 0.5 : index / (safeCount - 1);
    return stops === null ? fallback(t) : rampAt(stops, t);
  });
}

/** One value in a ramp, for charts that colour cells individually. */
export function colorForFraction(
  t: number,
  stops: readonly string[] | null,
  fallback: (t: number) => string,
): string {
  const safe = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0.5));
  return stops === null ? fallback(safe) : rampAt(stops, safe);
}

/** Stable domain note used by chart captions and legends. */
export function describeColorDomain(
  domain: ColorDomain,
  format: (value: number) => string,
): string {
  const centered = domain.centered ? " centered" : "";
  const fixed = domain.fixed ? " fixed" : "";
  return `${format(domain.min)} - ${format(domain.max)}${fixed}${centered}`;
}