import FlexSearch from "flexsearch";
import type { RowEngine } from "./types.js";

interface FlexIndex {
  add(id: number, text: string): void;
  search(query: string, options: Record<string, unknown>): unknown[];
}

export class FlexSearchEngine implements RowEngine {
  readonly name = "flexsearch";
  private index: FlexIndex | null = null;

  build(values: readonly string[]): void {
    const namespace = FlexSearch as unknown as { Index: new (options: Record<string, unknown>) => FlexIndex };
    const index = new namespace.Index({
      tokenize: "forward",
      resolution: 9,
      cache: true,
    });
    for (let i = 0; i < values.length; i++) index.add(i, values[i]);
    this.index = index;
  }

  search(query: string): number {
    if (this.index === null) throw new Error("build() not called");
    const results = this.index.search(query, { limit: 1000, suggest: true });
    return results.length;
  }
}
