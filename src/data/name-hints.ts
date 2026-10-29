/**
 * Column-name hints, matched on WHOLE WORDS. One reviewed table replaces the
 * substring regexes that used to live in findings, charts and identifier checks,
 * where "age" matched percentage/image/package, "rate" matched generate, and
 * "count" matched discount.
 *
 * A name is split on non-alphanumerics and camelCase ("BloodPressure_2" ->
 * blood, pressure, 2). A hint matches a token exactly, or the token minus a
 * plural "s" ("units" -> unit, "amounts" -> amount). Compound lowercase names
 * ("unitprice") are deliberately not split: guessing inside a word is how the
 * old regexes went wrong.
 */

/** Whole-word tokens of a column name: split on non-alphanumerics and camelCase. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "");
}

export type HintGroup =
  /** Values cannot be negative (a negative quantity or price is a data error). */
  | "nonNegative"
  /** Physical or business measurements that should be checked for plausible size. */
  | "measurement"
  /** Words that make a numeric column a good chart value axis. */
  | "chartMeasure"
  /** Words that mark a numeric column as a measure, never an identifier. */
  | "identifierMeasure"
  /** A zero in these usually means "not measured". */
  | "zeroImplausible"
  | "phone"
  | "email"
  | "link"
  | "coordinate"
  | "address"
  /** Postcode-like words: corroboration only, never a sensitive flag on their own. */
  | "postcode"
  /** Network addresses: an "ip_address" column is an IP, not a postal address. */
  | "network"
  | "code"
  | "freeText"
  /** Words that qualify the token "name" as a person's name. */
  | "personQualifier"
  | "dateOfBirth"
  | "government"
  | "financial"
  | "health"
  | "demographic"
  /** Columns that are blank by design: free notes, middle names, lot numbers. */
  | "optional"
  /** Version strings (1.2.3.4) that look like IPv4 addresses but are not. */
  | "version"
  /** Whole-word names whose values have a hard plausible range (see plausibility.ts). */
  | "plausibleAge"
  | "percent"
  | "year";

export const HINT_TOKENS: Readonly<Record<HintGroup, readonly string[]>> = {
  plausibleAge: ["age"],
  percent: ["pct", "percent", "percentage"],
  year: ["year"],
  version: ["version", "ver", "build", "release", "semver", "revision"],
  optional: [
    "note", "notes", "comment", "comments", "remark", "remarks", "memo", "description",
    "middle", "lot", "card", "secondary", "alt", "alternate", "optional", "additional", "context", "clarify", "specify",
  ],
  nonNegative: [
    "qty", "quantity", "count", "stock", "unit", "amount", "price", "cost", "age",
    "duration", "distance", "weight",
  ],
  measurement: [
    "length", "weight", "height", "width", "distance", "duration", "size", "amount",
    "price", "rate", "ratio", "share", "percent", "percentage", "pct",
  ],
  chartMeasure: [
    "amount", "revenue", "sales", "total", "price", "cost", "profit", "spend", "income",
    "value", "qty", "quantity", "count", "score", "usage", "balance", "weight", "size",
    "duration", "rate", "percent", "percentage", "pct", "margin", "discount", "unit",
  ],
  identifierMeasure: [
    "amount", "revenue", "sales", "total", "price", "cost", "profit", "spend", "income",
    "value", "qty", "quantity", "count", "score", "usage", "balance", "weight", "size",
    "duration", "distance", "fare", "age", "year", "time", "date", "epoch", "timestamp",
    "rate", "percent", "percentage", "pct", "margin", "discount", "unit", "population",
    "area", "temperature", "temp", "speed", "elevation", "latitude", "longitude", "lat",
    "lon", "humidity", "pressure", "volume", "capacity", "height", "width", "length", "depth",
  ],
  zeroImplausible: [
    "age", "price", "cost", "weight", "height", "glucose", "insulin", "bmi", "moisture",
    "pressure", "thickness", "salary", "wage",
  ],
  phone: ["phone", "mobile", "tel", "telephone", "fax", "cell", "msisdn"],
  email: ["email", "mail", "emailaddress"],
  link: ["url", "uri", "link", "website", "href", "picture", "image", "photo", "avatar"],
  coordinate: ["lat", "lon", "lng", "latitude", "longitude"],
  address: ["address", "street", "suburb"],
  postcode: ["postcode", "postal", "zip"],
  network: ["ip", "ipv4", "ipv6"],
  code: ["ticket", "code", "sku", "serial", "barcode", "isbn", "vin", "imei", "ref", "reference"],
  freeText: ["notes", "note", "comment", "comments", "description", "summary", "remarks", "text", "body"],
  personQualifier: [
    "first", "last", "given", "sur", "full", "middle", "customer", "patient", "employee",
    "contact", "client", "member", "victim", "person",
  ],
  dateOfBirth: ["dob", "birth", "birthdate", "born"],
  government: ["ssn", "tfn", "abn", "acn", "medicare", "passport", "licence", "license", "nino"],
  financial: ["salary", "income", "wage", "iban", "bsb", "account", "card", "balance"],
  health: ["patient", "diagnosis", "medication", "condition", "icd"],
  demographic: ["gender", "sex", "ethnicity", "race", "religion"],
};

const SETS: Record<HintGroup, ReadonlySet<string>> = Object.fromEntries(
  (Object.keys(HINT_TOKENS) as HintGroup[]).map((group) => [group, new Set(HINT_TOKENS[group])]),
) as unknown as Record<HintGroup, ReadonlySet<string>>;

/** The token, plus its singular form when it ends in a plain plural "s". */
function forms(token: string): string[] {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss")
    ? [token, token.slice(0, -1)]
    : [token];
}

/** Does any whole word of the column name belong to the hint group? */
export function nameHas(name: string, group: HintGroup): boolean {
  return firstHint(name, group) !== null;
}

/** The first word of the name that belongs to the group (singular form), or null. */
export function firstHint(name: string, group: HintGroup): string | null {
  const set = SETS[group];
  for (const token of nameTokens(name)) {
    for (const form of forms(token)) if (set.has(form)) return form;
  }
  return null;
}
