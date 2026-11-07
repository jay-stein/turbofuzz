/**
 * Public holidays by region, worked out from their rules (a fixed date, the nth weekday of a month, Easter), so there is no table to
 * keep up to date and no network. A region is "AU-WA", "US", "UK", "NZ": a country, with a state where the states differ.
 * Fixed-date holidays that fall on a weekend are observed on the next Monday, the common rule; where a region keeps its own
 * substitution days the list is a close guide, not a legal calendar.
 */

export interface HolidayRegion { code: string; label: string }
export interface Holiday { ms: number; name: string }

export const HOLIDAY_REGIONS: readonly HolidayRegion[] = [
  { code: "AU-WA", label: "Australia · Western Australia" },
  { code: "AU-NSW", label: "Australia · New South Wales" },
  { code: "AU-VIC", label: "Australia · Victoria" },
  { code: "AU-QLD", label: "Australia · Queensland" },
  { code: "AU-SA", label: "Australia · South Australia" },
  { code: "AU-TAS", label: "Australia · Tasmania" },
  { code: "AU-ACT", label: "Australia · Australian Capital Territory" },
  { code: "AU-NT", label: "Australia · Northern Territory" },
  { code: "NZ", label: "New Zealand" },
  { code: "UK", label: "United Kingdom · England and Wales" },
  { code: "US", label: "United States · federal" },
];

const DAY = 86_400_000;
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);
const dow = (ms: number): number => new Date(ms).getUTCDay(); // 0 = Sunday

/** Easter Sunday (Meeus/Jones/Butcher). */
export function easterSunday(year: number): number {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** The nth (1-based) given weekday (0 = Sunday) of a month. */
function nth(year: number, month: number, weekday: number, n: number): number {
  const first = utc(year, month, 1);
  return first + ((weekday - dow(first) + 7) % 7) * DAY + (n - 1) * 7 * DAY;
}
function lastWeekday(year: number, month: number, weekday: number): number {
  const end = utc(year, month + 1, 0 + 1) - DAY; // the last day of the month
  return end - ((dow(end) - weekday + 7) % 7) * DAY;
}
/** A fixed date that moves to the next Monday when it falls on a weekend. */
function observed(ms: number): number {
  const d = dow(ms);
  return d === 6 ? ms + 2 * DAY : d === 0 ? ms + DAY : ms;
}

/** Every holiday of one year in a region, in date order (a holiday that coincides with another keeps both names). */
export function holidaysOfYear(region: string, year: number): Holiday[] {
  const out: Holiday[] = [];
  const add = (ms: number, name: string): void => { out.push({ ms, name }); };
  const easter = easterSunday(year);
  const au = region.startsWith("AU");
  const state = au ? region.slice(3) : "";
  if (au) {
    add(observed(utc(year, 1, 1)), "New Year's Day");
    add(observed(utc(year, 1, 26)), "Australia Day");
    add(easter - 2 * DAY, "Good Friday");
    if (state !== "WA") add(easter - DAY, "Easter Saturday");
    add(easter + DAY, "Easter Monday");
    add(state === "WA" && dow(utc(year, 4, 25)) === 0 ? utc(year, 4, 26) : utc(year, 4, 25), "Anzac Day");
    // Christmas and Boxing Day: when they land on a weekend the substitute days follow.
    const xmas = utc(year, 12, 25), box = utc(year, 12, 26);
    const xmasObs = dow(xmas) === 6 || dow(xmas) === 0 ? (dow(xmas) === 6 ? xmas + 2 * DAY : xmas + DAY) : xmas;
    let boxObs = dow(box) === 6 ? box + 2 * DAY : dow(box) === 0 ? box + DAY : box;
    if (boxObs === xmasObs) boxObs += DAY;
    add(xmasObs, "Christmas Day");
    add(boxObs, "Boxing Day");
    const kings = (n: number | "last"): number => (n === "last" ? lastWeekday(year, 9, 1) : nth(year, 6, 1, n));
    switch (state) {
      case "WA": add(nth(year, 3, 1, 1), "Labour Day"); add(nth(year, 6, 1, 1), "Western Australia Day"); add(kings("last"), "King's Birthday"); break;
      case "NSW": add(kings(2), "King's Birthday"); add(nth(year, 10, 1, 1), "Labour Day"); break;
      case "VIC": add(nth(year, 3, 1, 2), "Labour Day"); add(kings(2), "King's Birthday"); add(nth(year, 11, 2, 1), "Melbourne Cup Day"); break;
      case "QLD": add(nth(year, 5, 1, 1), "Labour Day"); add(nth(year, 10, 1, 1), "King's Birthday"); break;
      case "SA": add(nth(year, 3, 1, 2), "Adelaide Cup Day"); add(kings(2), "King's Birthday"); add(nth(year, 10, 1, 1), "Labour Day"); break;
      case "TAS": add(nth(year, 3, 1, 2), "Eight Hours Day"); add(kings(2), "King's Birthday"); break;
      case "ACT": add(nth(year, 3, 1, 2), "Canberra Day"); add(kings(2), "King's Birthday"); add(nth(year, 10, 1, 1), "Labour Day"); break;
      case "NT": add(nth(year, 5, 1, 1), "May Day"); add(nth(year, 8, 1, 1), "Picnic Day"); add(kings(2), "King's Birthday"); break;
    }
  } else if (region === "NZ") {
    add(observed(utc(year, 1, 1)), "New Year's Day");
    add(observed(utc(year, 1, 2)) + (dow(utc(year, 1, 2)) === 0 || dow(utc(year, 1, 2)) === 6 ? DAY : 0), "Day after New Year's Day");
    add(observed(utc(year, 2, 6)), "Waitangi Day");
    add(easter - 2 * DAY, "Good Friday");
    add(easter + DAY, "Easter Monday");
    add(observed(utc(year, 4, 25)), "Anzac Day");
    add(nth(year, 6, 1, 1), "King's Birthday");
    add(nth(year, 10, 1, 4), "Labour Day");
    add(observed(utc(year, 12, 25)), "Christmas Day");
    add(observed(utc(year, 12, 26)) + (dow(utc(year, 12, 26)) === 6 || dow(utc(year, 12, 26)) === 0 ? DAY : 0), "Boxing Day");
  } else if (region === "UK") {
    add(observed(utc(year, 1, 1)), "New Year's Day");
    add(easter - 2 * DAY, "Good Friday");
    add(easter + DAY, "Easter Monday");
    add(nth(year, 5, 1, 1), "Early May bank holiday");
    add(lastWeekday(year, 5, 1), "Spring bank holiday");
    add(lastWeekday(year, 8, 1), "Summer bank holiday");
    const xmas = utc(year, 12, 25), xmasObs = dow(xmas) === 6 ? xmas + 2 * DAY : dow(xmas) === 0 ? xmas + DAY : xmas;
    let boxObs = dow(utc(year, 12, 26)) === 6 ? utc(year, 12, 28) : dow(utc(year, 12, 26)) === 0 ? utc(year, 12, 27) : utc(year, 12, 26);
    if (boxObs === xmasObs) boxObs += DAY;
    add(xmasObs, "Christmas Day");
    add(boxObs, "Boxing Day");
  } else if (region === "US") {
    // US federal holidays move to the nearest weekday (Saturday back, Sunday on).
    const near = (ms: number): number => (dow(ms) === 6 ? ms - DAY : dow(ms) === 0 ? ms + DAY : ms);
    add(near(utc(year, 1, 1)), "New Year's Day");
    add(nth(year, 1, 1, 3), "Martin Luther King Jr. Day");
    add(nth(year, 2, 1, 3), "Presidents' Day");
    add(lastWeekday(year, 5, 1), "Memorial Day");
    if (year >= 2021) add(near(utc(year, 6, 19)), "Juneteenth");
    add(near(utc(year, 7, 4)), "Independence Day");
    add(nth(year, 9, 1, 1), "Labor Day");
    add(nth(year, 10, 1, 2), "Columbus Day");
    add(near(utc(year, 11, 11)), "Veterans Day");
    add(nth(year, 11, 4, 4), "Thanksgiving");
    add(near(utc(year, 12, 25)), "Christmas Day");
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/** The holidays whose date lies in [from, to) (UTC ms), across the years that range touches. */
export function holidaysBetween(region: string, from: number, to: number): Holiday[] {
  if (!region || !(to > from)) return [];
  const out: Holiday[] = [];
  for (let y = new Date(from).getUTCFullYear(); y <= new Date(to - 1).getUTCFullYear(); y++) {
    for (const h of holidaysOfYear(region, y)) if (h.ms >= from && h.ms < to) out.push(h);
  }
  return out;
}

/** A region guessed from the browser's language and time zone (offered, never applied without a click); "" when unsure. */
export function suggestRegion(language: string, timeZone: string): string {
  const lang = language.toLowerCase();
  if (/^en-au/.test(lang) || /^australia\//i.test(timeZone)) {
    if (/perth/i.test(timeZone)) return "AU-WA";
    if (/sydney|melbourne|hobart|brisbane|adelaide|darwin|canberra/i.test(timeZone)) {
      return /melbourne/i.test(timeZone) ? "AU-VIC" : /brisbane/i.test(timeZone) ? "AU-QLD" : /adelaide/i.test(timeZone) ? "AU-SA" : /hobart/i.test(timeZone) ? "AU-TAS" : /darwin/i.test(timeZone) ? "AU-NT" : "AU-NSW";
    }
    return "AU-NSW";
  }
  if (/^en-nz/.test(lang) || /pacific\/auckland/i.test(timeZone)) return "NZ";
  if (/^en-gb/.test(lang) || /europe\/london/i.test(timeZone)) return "UK";
  if (/^en-us/.test(lang) || /^america\//i.test(timeZone)) return "US";
  return "";
}
