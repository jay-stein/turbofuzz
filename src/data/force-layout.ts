/**
 * Tiny force-directed layout for the column network. Repulsion between every
 * pair, springs along links (stronger links pull closer), a weak pull to the
 * centre and velocity damping. `alpha` cools toward `floor`, so the graph
 * settles into a gentle wobble instead of freezing; dragging reheats it.
 */
export interface ForceNode {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned while the pointer holds the node. */
  fixed: boolean;
}

export interface ForceLink {
  a: number;
  b: number;
  /** 0..1, how strongly the pair is associated. */
  strength: number;
}

export interface ForceOptions {
  width: number;
  height: number;
  /** Keep this far from the canvas edge. */
  margin: number;
  /** Lowest alpha; above 0 keeps a faint jiggle going. */
  floor: number;
}

export interface ForceLayout {
  nodes: ForceNode[];
  links: ForceLink[];
  alpha: number;
}

/** Nodes start on a circle (deterministic) so the first frames are stable. */
export function createForceLayout(
  ids: readonly number[],
  links: readonly ForceLink[],
  options: Pick<ForceOptions, "width" | "height">,
  previous?: ReadonlyMap<number, { x: number; y: number }>,
): ForceLayout {
  const cx = options.width / 2;
  const cy = options.height / 2;
  const radius = Math.min(cx, cy) * 0.7;
  const nodes = ids.map((id, index) => {
    const known = previous?.get(id);
    const angle = (index / Math.max(1, ids.length)) * Math.PI * 2 - Math.PI / 2;
    return {
      id,
      x: known?.x ?? cx + Math.cos(angle) * radius,
      y: known?.y ?? cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      fixed: false,
    };
  });
  return { nodes, links: [...links], alpha: previous === undefined ? 1 : 0.5 };
}

export function reheat(layout: ForceLayout, alpha = 0.4): void {
  layout.alpha = Math.max(layout.alpha, alpha);
}

/** Advances one tick; returns the total kinetic energy (useful for tests). */
export function stepForceLayout(
  layout: ForceLayout,
  options: ForceOptions,
  random: () => number = Math.random,
): number {
  const { nodes, links } = layout;
  const n = nodes.length;
  if (n === 0) return 0;
  const cx = options.width / 2;
  const cy = options.height / 2;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const alpha = layout.alpha;
  // Rest length shrinks as the association grows, within the canvas scale.
  const base = Math.min(options.width, options.height) * 0.42;

  for (let i = 0; i < n; i++) {
    const a = nodes[i] as ForceNode;
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j] as ForceNode;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 1) {
        dx = random() - 0.5;
        dy = random() - 0.5;
        distSq = dx * dx + dy * dy + 0.01;
      }
      const dist = Math.sqrt(distSq);
      const push = (90 * alpha + 70) / Math.sqrt(distSq);
      const fx = (dx / dist) * push;
      const fy = (dy / dist) * push;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  for (const link of links) {
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const strength = Math.max(0, Math.min(1, link.strength));
    const rest = base * (1 - 0.8 * strength);
    const pull = (dist - rest) * (0.03 + 0.08 * strength);
    const fx = (dx / dist) * pull;
    const fy = (dy / dist) * pull;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  let energy = 0;
  for (const node of nodes) {
    node.vx += (cx - node.x) * 0.012;
    node.vy += (cy - node.y) * 0.012;
    if (!node.fixed && layout.alpha <= options.floor * 2) {
      // The faint wobble that keeps the graph feeling alive once settled.
      node.vx += (random() - 0.5) * 0.35;
      node.vy += (random() - 0.5) * 0.35;
    }
    node.vx *= 0.82;
    node.vy *= 0.82;
    if (node.fixed) {
      node.vx = 0;
      node.vy = 0;
    } else {
      node.x += node.vx;
      node.y += node.vy;
    }
    node.x = Math.max(options.margin, Math.min(options.width - options.margin, node.x));
    node.y = Math.max(options.margin, Math.min(options.height - options.margin, node.y));
    energy += node.vx * node.vx + node.vy * node.vy;
  }

  layout.alpha = Math.max(options.floor, layout.alpha * 0.985);
  return energy;
}
