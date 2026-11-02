const FORMULA_LIKE = /^[=+\-@\t\r]/;

/** A text cell a spreadsheet would run as a formula gets a leading quote; numbers, negative ones included, stay numbers. */
export function formatFormulaSafe(value: string): string {
  return FORMULA_LIKE.test(value) && !Number.isFinite(Number(value)) ? `'${value}` : value;
}
