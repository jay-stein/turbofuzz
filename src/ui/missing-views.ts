/**
 * "Show rows" entries for missing cells. Truly empty cells and junk text read as missing
 * (“NA”, “TBD”) get separate entries, so the junk text can be looked at on its own.
 */

import type { ColumnMeta, SpecialKind } from "../worker/protocol.js";

export interface MissingView {
  kind: SpecialKind;
  label: string;
  title: string;
}

/** Junk-text cells in one column: missing values that held text such as “NA”. */
export function junkTextCount(meta: Pick<ColumnMeta, "nullTokens">): number {
  return meta.nullTokens.reduce((sum, token) => (token.label.trim() !== "" ? sum + token.count : sum), 0);
}

export function missingViews(metas: readonly Pick<ColumnMeta, "nullTokens" | "stats">[]): MissingView[] {
  let blank = 0;
  let junk = 0;
  let columns = 0;
  for (const meta of metas) {
    if (meta.stats.nulls <= 0) continue;
    columns++;
    const text = junkTextCount(meta);
    junk += text;
    blank += Math.max(0, meta.stats.nulls - text);
  }
  if (columns === 0) return [];
  const nf = (n: number): string => n.toLocaleString();
  if (junk === 0) {
    return [{ kind: "nulls", label: `View empty cells · ${nf(columns)} ${columns === 1 ? "col" : "cols"}`, title: "Show rows with at least one empty cell" }];
  }
  const views: MissingView[] = [];
  if (blank > 0) views.push({ kind: "blanks", label: `View empty cells · ${nf(blank)}`, title: "Show rows with at least one truly empty cell" });
  views.push({ kind: "junkText", label: `View junk text · ${nf(junk)}`, title: "Show rows where a cell holds junk text read as missing, such as “NA” or “TBD”" });
  return views;
}
