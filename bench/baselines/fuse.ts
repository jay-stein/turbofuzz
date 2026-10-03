import Fuse from "fuse.js";
import type { RowEngine } from "./types.js";

export class FuseEngine implements RowEngine {
  readonly name = "fuse.js";
  private fuse: Fuse<string> | null = null;

  build(values: readonly string[]): void {
    this.fuse = new Fuse(values as string[], {
      includeScore: true,
      threshold: 0.4,
      ignoreLocation: true,
      shouldSort: true,
      minMatchCharLength: 2,
    });
  }

  search(query: string): number {
    if (this.fuse === null) throw new Error("build() not called");
    return this.fuse.search(query, { limit: 1000 }).length;
  }
}
