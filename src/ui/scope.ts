export interface ScopeInput {
  total: number;
  visible?: number;
  viewName?: string | null;
}

/** Short, human-readable description of which rows a result covers. */
export function describeScope({ total, visible, viewName }: ScopeInput): string {
  if (viewName !== undefined && viewName !== null && viewName.trim() !== "") {
    return `View: ${viewName.trim()}`;
  }
  const shown = visible ?? total;
  if (shown < total) {
    return `Current rows: ${shown.toLocaleString()} of ${total.toLocaleString()}`;
  }
  return `Whole dataset (${total.toLocaleString()} rows)`;
}
