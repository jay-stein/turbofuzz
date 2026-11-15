import { charDiff, type DiffSegment } from "../../data/compare/char-diff.js";
import { el } from "../dom.js";

/** The text with its differing letters wrapped in a mark; plain strings for the shared runs. */
function nodes(segments: DiffSegment[]): (Node | string)[] {
  return segments.map((segment) => (segment.differs ? el("mark", { class: "cmp-ch" }, [segment.text]) : segment.text));
}

/** Both strings as DOM children, the letters that are not in the other one marked. */
export function diffNodes(a: string, b: string): { a: (Node | string)[]; b: (Node | string)[] } {
  const diff = charDiff(a, b);
  return { a: nodes(diff.a), b: nodes(diff.b) };
}
