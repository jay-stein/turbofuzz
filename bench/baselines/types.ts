export interface RowEngine {
  readonly name: string;
  build(values: readonly string[]): void;
  search(query: string): number;
}
