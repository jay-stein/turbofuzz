export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap layout (Bruls/Huizing/van Wijk): places the largest
 * values first and keeps tiles close to squares. Areas are proportional to
 * the values; the returned rects tile the given rectangle.
 */
export function squarifyLayout(
  values: readonly number[],
  x: number,
  y: number,
  width: number,
  height: number,
): TreemapRect[] {
  const count = values.length;
  if (count === 0 || !(width > 0) || !(height > 0)) return [];
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!(total > 0)) return [];
  const scale = (width * height) / total;
  const areas = values.map((value) => Math.max(0, value) * scale);
  const order = areas
    .map((_, index) => index)
    .sort((a, b) => (areas[b] ?? 0) - (areas[a] ?? 0));

  const rects = new Array<TreemapRect>(count);
  let rx = x;
  let ry = y;
  let rw = width;
  let rh = height;
  let index = 0;

  while (index < order.length) {
    const shortSide = Math.min(rw, rh);
    const row: number[] = [];
    let rowSum = 0;
    let worst = Number.POSITIVE_INFINITY;
    let cursor = index;
    while (cursor < order.length) {
      const area = areas[order[cursor] ?? 0] ?? 0;
      const nextSum = rowSum + area;
      const thickness = nextSum / shortSide;
      let candidateWorst = 0;
      for (const member of row) {
        const length = member / thickness;
        candidateWorst = Math.max(candidateWorst, thickness / length, length / thickness);
      }
      const lastLength = area / thickness;
      candidateWorst = Math.max(candidateWorst, thickness / lastLength, lastLength / thickness);
      if (row.length > 0 && candidateWorst > worst) break;
      worst = candidateWorst;
      row.push(area);
      rowSum = nextSum;
      cursor++;
    }

    const thickness = rowSum / shortSide;
    if (rw >= rh) {
      let oy = ry;
      row.forEach((area, member) => {
        const tileHeight = area / thickness;
        rects[order[index + member] ?? 0] = { x: rx, y: oy, w: thickness, h: tileHeight };
        oy += tileHeight;
      });
      rx += thickness;
      rw -= thickness;
    } else {
      let ox = rx;
      row.forEach((area, member) => {
        const tileWidth = area / thickness;
        rects[order[index + member] ?? 0] = { x: ox, y: ry, w: tileWidth, h: thickness };
        ox += tileWidth;
      });
      ry += thickness;
      rh -= thickness;
    }
    index = cursor;
  }

  return rects;
}
