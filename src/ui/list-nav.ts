/** What a key press does in a search box over a list of choices (the command palette's behaviour). */
export type ListKeyResult =
  | { kind: "move"; active: number }
  | { kind: "pick"; index: number }
  | { kind: "close" }
  | { kind: "none" };

/**
 * Arrow keys move the highlight (clamped, not wrapped), Enter picks the highlighted
 * item, Escape closes. With nothing listed, Enter and the arrows do nothing.
 */
export function listKey(key: string, active: number, count: number): ListKeyResult {
  if (key === "Escape") return { kind: "close" };
  if (count === 0) return { kind: "none" };
  if (key === "ArrowDown") return { kind: "move", active: Math.min(active + 1, count - 1) };
  if (key === "ArrowUp") return { kind: "move", active: Math.max(active - 1, 0) };
  if (key === "Enter") return { kind: "pick", index: Math.min(Math.max(active, 0), count - 1) };
  return { kind: "none" };
}
