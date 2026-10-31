/**
 * Nelder-Mead simplex minimiser (Nelder and Mead, 1965), the optimiser R's ets() uses for
 * the smoothing parameters and starting states. Standard coefficients: reflection 1,
 * expansion 2, contraction 0.5, shrink 0.5. Constraints are handled as R does it: the
 * objective returns a very large value outside the allowed region.
 *
 * Nelder, J. A. and Mead, R. (1965). A simplex method for function minimization.
 * The Computer Journal, 7(4), 308-313.
 */

export interface NelderMeadResult { x: number[]; f: number; evals: number }

/**
 * Minimises fn from x0, with an initial simplex that steps each coordinate by step[i].
 * Stops when the simplex's best and worst values agree to relTol, or after maxEvals.
 */
export function nelderMead(fn: (x: number[]) => number, x0: number[], step: number[], maxEvals = 1000, relTol = 1e-9): NelderMeadResult {
  const n = x0.length;
  let evals = 0;
  const f = (x: number[]): number => { evals++; const v = fn(x); return Number.isFinite(v) ? v : 1e30; };
  const pts: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] = p[i]! + step[i]!; pts.push(p); }
  const vals = pts.map(f);
  const order = new Array<number>(n + 1);
  const centroid = new Array<number>(n).fill(0);
  const along = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v + t * (b[i]! - v));
  while (evals < maxEvals) {
    for (let i = 0; i <= n; i++) order[i] = i;
    order.sort((p, q) => vals[p]! - vals[q]!);
    const best = order[0]!, worst = order[n]!, second = order[n - 1]!;
    if (Math.abs(vals[worst]! - vals[best]!) <= relTol * (Math.abs(vals[best]!) + relTol)) break;
    centroid.fill(0);
    for (let k = 0; k < n; k++) { const p = pts[order[k]!]!; for (let i = 0; i < n; i++) centroid[i] = centroid[i]! + p[i]! / n; }
    const xr = along(centroid, pts[worst]!, -1), fr = f(xr);
    if (fr < vals[best]!) {
      const xe = along(centroid, pts[worst]!, -2), fe = f(xe);
      if (fe < fr) { pts[worst] = xe; vals[worst] = fe; } else { pts[worst] = xr; vals[worst] = fr; }
    } else if (fr < vals[second]!) {
      pts[worst] = xr; vals[worst] = fr;
    } else {
      const outside = fr < vals[worst]!;
      const xc = outside ? along(centroid, pts[worst]!, -0.5) : along(centroid, pts[worst]!, 0.5), fc = f(xc);
      if (fc < (outside ? fr : vals[worst]!)) { pts[worst] = xc; vals[worst] = fc; }
      else {
        for (let k = 1; k <= n; k++) { const j = order[k]!; pts[j] = along(pts[best]!, pts[j]!, 0.5); vals[j] = f(pts[j]!); }
      }
    }
  }
  let bi = 0;
  for (let i = 1; i <= n; i++) if (vals[i]! < vals[bi]!) bi = i;
  return { x: pts[bi]!, f: vals[bi]!, evals };
}
