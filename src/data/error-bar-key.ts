/** Matches a group's error bars to its mark on the chart, whatever order the chart puts the groups in. */
export function errorBarKey(labels: readonly string[]): string {
  return labels.join("\u001f");
}
