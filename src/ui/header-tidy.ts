/**
 * Every column name in one style at once (snake_case, lower case, ...), from the column menu,
 * with Undo. The same tidy as the Clean panel's Column names tab, which previews each change.
 */
import { DEFAULT_HEADER_OPTIONS, normalizeHeaders, type HeaderCaseStyle } from "../data/headers.js";

export const TIDY_STYLES: readonly { style: Exclude<HeaderCaseStyle, "keep">; label: string; example: string }[] = [
  { style: "snake", label: "snake_case", example: "date_of_birth" },
  { style: "lower", label: "lower case", example: "date of birth" },
  { style: "title", label: "Title Case", example: "Date Of Birth" },
  { style: "camel", label: "camelCase", example: "dateOfBirth" },
  { style: "upper", label: "UPPER CASE", example: "DATE OF BIRTH" },
];

/** Renames every column to `style`; says so with Undo, or that nothing needed changing. */
export function tidyAllNames(
  names: readonly string[],
  style: HeaderCaseStyle,
  apply: (headers: string[]) => void,
  toast: (message: string, undo?: () => void) => void,
): void {
  const next = normalizeHeaders(names, { ...DEFAULT_HEADER_OPTIONS, caseStyle: style });
  const changed = next.filter((name, index) => name !== names[index]).length;
  const label = TIDY_STYLES.find((entry) => entry.style === style)?.label ?? style;
  if (changed === 0) {
    toast(`Every column name is already ${label}`);
    return;
  }
  const before = [...names];
  apply(next);
  toast(`Renamed ${changed.toLocaleString()} ${changed === 1 ? "column" : "columns"} to ${label}`, () => apply(before));
}
