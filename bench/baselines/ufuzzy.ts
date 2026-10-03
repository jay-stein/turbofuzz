import uFuzzy from "@leeoniya/ufuzzy";
import type { RowEngine } from "./types.js";

interface UFuzzyInstance {
  search(haystack: readonly string[], needle: string): [number[] | null, unknown, unknown];
}

export class UFuzzyEngine implements RowEngine {
  readonly name = "ufuzzy";
  private uf: UFuzzyInstance | null = null;
  private values: readonly string[] = [];

  build(values: readonly string[]): void {
    this.uf = new uFuzzy() as unknown as UFuzzyInstance;
    this.values = values;
  }

  search(query: string): number {
    if (this.uf === null) throw new Error("build() not called");
    const [idxs] = this.uf.search(this.values, query);
    return idxs === null ? 0 : idxs.length;
  }
}
