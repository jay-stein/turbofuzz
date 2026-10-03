import { normalize } from "../../src/search/normalize.js";
import type { RowEngine } from "./types.js";

export class LinearSubstringEngine implements RowEngine {
  readonly name = "linear substring";
  private norms: string[] = [];

  build(values: readonly string[]): void {
    this.norms = values.map(normalize);
  }

  search(query: string): number {
    const q = normalize(query);
    let matches = 0;
    const norms = this.norms;
    for (let i = 0; i < norms.length; i++) {
      if (norms[i].includes(q)) matches++;
    }
    return matches;
  }
}
