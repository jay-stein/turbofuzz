/**
 * Spreadsheet formula-injection guard. Excel/Sheets/LibreOffice evaluate a
 * cell that starts with =, @, tab or CR, and a signed expression whose sign is
 * followed by anything but a plain number (OWASP CSV-injection list). A bare
 * "-999" is left alone because it is a normal number, not a formula.
 */
export function looksLikeFormula(value: string): boolean {
  const first = value.charCodeAt(0);
  if (first === 61 /* = */ || first === 64 /* @ */) return true;
  if (first === 9 /* tab */ || first === 13 /* CR */) return true;
  if (first === 43 /* + */ || first === 45 /* - */) {
    const rest = value.slice(1);
    return rest !== "" && !/^[0-9.,\s]+$/.test(rest);
  }
  return false;
}

/** Prefixes a single quote so spreadsheet apps treat the cell as text. */
export function escapeFormula(value: string): string {
  return value !== "" && looksLikeFormula(value) ? `'${value}` : value;
}
