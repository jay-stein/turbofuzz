/**
 * Lets a progress report through at most every `intervalMs`, and always when
 * the phase changes or a phase finishes, so the screen never sticks on an
 * old phase. The clock is a parameter so tests do not wait.
 */
export function createProgressThrottle(
  intervalMs: number,
  now: () => number = () => performance.now(),
): (phase: string, done?: boolean) => boolean {
  let lastPhase: string | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  return (phase, done = false) => {
    const at = now();
    if (phase === lastPhase && !done && at - lastAt < intervalMs) return false;
    lastPhase = phase;
    lastAt = at;
    return true;
  };
}
