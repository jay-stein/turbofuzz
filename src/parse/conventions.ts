/**
 * Conventions the person has chosen in Settings that the parsers need: today, which way round to read a date whose day and month
 * could be either (01/02/2025). The data decides wherever it can (14/03/2025 is day-first); this is only what breaks a tie. It
 * is set once per load by the worker from what the page sends, and is null until the person has chosen, in which case the page
 * says a guess was made and asks.
 */

export type DateTieBreak = "dmy" | "mdy";

let tie: DateTieBreak | null = null;

export function setDateTieBreak(order: DateTieBreak | null): void {
  tie = order;
}

export function dateTieBreak(): DateTieBreak | null {
  return tie;
}
