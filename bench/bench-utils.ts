export interface Timing {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  iterations: number;
}

export interface MeasureOptions {
  iterations: number;
  warmup?: number;
}

export function measure(fn: () => void, options: MeasureOptions): Timing {
  const warmup = Math.max(0, options.warmup ?? 1);
  for (let i = 0; i < warmup; i++) fn();

  let iterations = Math.max(1, options.iterations);
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    times.push(elapsed);
    if (i === 0) {
      if (elapsed > 200) iterations = Math.min(iterations, 2);
      else if (elapsed > 50) iterations = Math.min(iterations, 3);
    }
  }

  times.sort((a, b) => a - b);
  const sum = times.reduce((acc, t) => acc + t, 0);
  return {
    mean: sum / times.length,
    p50: percentile(times, 0.5),
    p95: percentile(times, 0.95),
    p99: percentile(times, 0.99),
    min: times[0],
    max: times[times.length - 1],
    iterations: times.length,
  };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export interface MemorySnapshot {
  heapMB: number;
  arrayBuffersMB: number;
  rssMB: number;
}

export function memMB(): MemorySnapshot {
  const m = process.memoryUsage();
  return {
    heapMB: m.heapUsed / 1048576,
    arrayBuffersMB: m.arrayBuffers / 1048576,
    rssMB: m.rss / 1048576,
  };
}

export function ms(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

export function count(n: number): string {
  return n.toLocaleString("en-US");
}
