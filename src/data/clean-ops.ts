export type CleanCaseStyle = "upper" | "lower" | "title";

export type CleanOp =
  | { kind: "trim" }
  | { kind: "case"; style: CleanCaseStyle }
  | { kind: "replace"; find: string; replacement: string; ignoreCase: boolean };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyCase(value: string, style: CleanCaseStyle): string {
  switch (style) {
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    case "title":
      return value.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  }
}

/** Compiles an op to a single-value transform so regexes are built once, not per cell. */
function compileOp(op: CleanOp): (value: string) => string {
  switch (op.kind) {
    case "trim":
      return (value) => value.trim().replace(/\s+/g, " ");
    case "case":
      return (value) => applyCase(value, op.style);
    case "replace": {
      if (op.find === "") return (value) => value;
      if (op.ignoreCase) {
        const pattern = new RegExp(escapeRegExp(op.find), "gi");
        return (value) => value.replace(pattern, op.replacement);
      }
      const find = op.find;
      return (value) => value.split(find).join(op.replacement);
    }
  }
}

/**
 * Non-destructive value clean: returns a new array with each op applied in
 * order. The input array is never mutated.
 */
export function applyCleanOps(values: readonly string[], ops: readonly CleanOp[]): string[] {
  const out = values.slice();
  for (const op of ops) {
    const transform = compileOp(op);
    for (let i = 0; i < out.length; i++) out[i] = transform(out[i]);
  }
  return out;
}

export function describeCleanOp(op: CleanOp): string {
  switch (op.kind) {
    case "trim":
      return "Trim whitespace";
    case "case":
      return op.style === "upper" ? "UPPERCASE" : op.style === "lower" ? "lowercase" : "Title Case";
    case "replace":
      return `Replace “${op.find}” with “${op.replacement}”${op.ignoreCase ? " (ignore case)" : ""}`;
  }
}
