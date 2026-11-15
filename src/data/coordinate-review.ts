/**
 * Pair checks on a latitude/longitude column pair: points exactly at (0,0) (a GPS "no fix" written as zeros) and likely swapped
 * pairs (latitude outside +-90 but inside the longitude range, longitude inside +-90). Counts only; nothing is changed. Out-of-range
 * values on a single axis are the plausible-range check of each column.
 */
export interface CoordinateReview {
  /** The paired longitude column. */
  lonColumn: number;
  /** Rows with both values present. */
  checked: number;
  /** Rows at exactly (0,0). */
  zeroPair: number;
  /** Rows that read as longitude, latitude. */
  swapped: number;
}

export function reviewCoordinates(lat: Float64Array, lon: Float64Array, lonColumn: number): CoordinateReview | null {
  let checked = 0;
  let zeroPair = 0;
  let swapped = 0;
  const n = Math.min(lat.length, lon.length);
  for (let i = 0; i < n; i++) {
    const a = lat[i];
    const b = lon[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    checked++;
    if (a === 0 && b === 0) zeroPair++;
    else if ((a > 90 || a < -90) && b >= -90 && b <= 90) swapped++;
  }
  if (zeroPair === 0 && swapped === 0) return null;
  return { lonColumn, checked, zeroPair, swapped };
}
