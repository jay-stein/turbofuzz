import { firstHint, nameHas, nameTokens, type HintGroup } from "./name-hints.js";
import type { Semantic } from "./semantic-type.js";
import type { EmbeddedShapeCounts, TextShapeCounts } from "./text-profile.js";
import type { ColumnType } from "../types.js";

/**
 * "Possibly sensitive" column detection. Pure and worker-safe: it reads column
 * names, a semantic type and precomputed value-shape counts, and returns advisory
 * findings. A finding never changes a score or a check, and never carries values.
 */
export type SensitiveClass =
  | "contact"
  | "government_id"
  | "financial"
  | "personal_name"
  | "demographic"
  | "health"
  | "location"
  | "free_text";

export type SensitiveConfidence = "high" | "medium" | "low";
export type SensitiveLabel = "public" | "internal" | "confidential" | "restricted";

export interface SensitiveReason {
  kind: "value" | "name" | "dictionary";
  /** Plain sentence fragment, e.g. “94% of sampled values look like email addresses”. */
  label: string;
  /** Share of sampled values (value reasons). */
  share?: number;
  count?: number;
}

export interface SensitiveFinding {
  column: number;
  name: string;
  class: SensitiveClass;
  confidence: SensitiveConfidence;
  reasons: SensitiveReason[];
  /** Values the shapes were counted on. */
  sampled: number;
  /** Non-empty values in the column; sampled < scanned means “offer a full scan”. */
  scanned: number;
  /** Suggested handling label; the user can change it. */
  label: SensitiveLabel;
  dismissed?: boolean;
  confirmed?: boolean;
}

export interface ColumnSensitivityInput {
  column: number;
  name: string;
  type: ColumnType;
  semantic?: Semantic | null;
  /** Whole-value shape counts over the sample; null for columns not profiled (numeric, dates). */
  shapes: TextShapeCounts | null;
  /** Rows the shapes were counted on (the `rows` of the text profile). */
  sampled: number;
  /** Non-empty values in the whole column. */
  scanned: number;
  /** Shapes found inside longer text; null when not scanned. */
  embedded?: EmbeddedShapeCounts | null;
}

/** Share of sampled values a validated shape needs for High on its own. */
const HIGH_SHARE = 0.6;
/** Checksum-prone shapes (a random 11-digit number passes ABN about 1 time in 89) need more. */
const COLLISION_PRONE_SHARE = 0.9;
/** Share with a matching name hint that is enough for High. */
const HINTED_HIGH_SHARE = 0.3;
const MEDIUM_MIN_SHARE = 0.05;
const EMBEDDED_MIN_ROWS = 3;
const EMBEDDED_MIN_SHARE = 0.01;

/** Strongest first: when a column fits several classes, the most serious wins. */
const CLASS_RANK: readonly SensitiveClass[] = [
  "government_id",
  "financial",
  "health",
  "contact",
  "personal_name",
  "demographic",
  "location",
  "free_text",
];

const CONFIDENCE_RANK: Record<SensitiveConfidence, number> = { high: 3, medium: 2, low: 1 };

interface Signal {
  class: SensitiveClass;
  confidence: SensitiveConfidence;
  reason: SensitiveReason;
}

/** Shapes grouped by class, with whether a lone validated shape can collide with ordinary data. */
const SHAPE_RULES: readonly {
  key: keyof TextShapeCounts;
  class: SensitiveClass;
  noun: string;
  collisionProne: boolean;
  hint: HintGroup | null;
}[] = [
  { key: "email", class: "contact", noun: "email addresses", collisionProne: false, hint: "email" },
  { key: "phone", class: "contact", noun: "phone numbers", collisionProne: true, hint: "phone" },
  { key: "creditCard", class: "financial", noun: "card numbers", collisionProne: true, hint: "financial" },
  { key: "iban", class: "financial", noun: "IBANs", collisionProne: true, hint: "financial" },
  { key: "taxFileNumber", class: "government_id", noun: "tax file numbers", collisionProne: true, hint: "government" },
  { key: "abn", class: "government_id", noun: "business numbers (ABN)", collisionProne: true, hint: "government" },
  { key: "acn", class: "government_id", noun: "company numbers (ACN)", collisionProne: true, hint: "government" },
  { key: "governmentId", class: "government_id", noun: "national id numbers", collisionProne: true, hint: "government" },
  { key: "medicare", class: "government_id", noun: "Medicare numbers", collisionProne: true, hint: "government" },
  { key: "ip", class: "location", noun: "IP addresses", collisionProne: false, hint: "network" },
  { key: "latLon", class: "location", noun: "coordinate pairs", collisionProne: false, hint: "coordinate" },
];

/**
 * Whether the sensitive scan should read this column's values. Text columns always;
 * a numeric column only when its name says phone, card or government id, since
 * those are the personal numbers that infer as numbers (0412345678, 4111111111111111).
 */
export function scansForSensitivity(type: string, name: string): boolean {
  if (type === "string" || type === "category" || type === "identifier") return true;
  return (type === "number" || type === "integer") && (nameHas(name, "phone") || nameHas(name, "financial") || nameHas(name, "government"));
}

/** Columns whose digits are codes by nature: weak validated shapes there are coincidence. */
const CODE_LIKE: ReadonlySet<string> = new Set(["identifier", "code", "date", "duration"]);

const percent = (share: number): string => `${Math.round(share * 100)}%`;

function valueSignals(input: ColumnSensitivityInput): Signal[] {
  const { shapes, sampled } = input;
  if (shapes === null || sampled <= 0) return [];
  const codeLike = input.semantic !== null && input.semantic !== undefined && CODE_LIKE.has(input.semantic.type);
  const signals: Signal[] = [];
  for (const rule of SHAPE_RULES) {
    const count = shapes[rule.key];
    if (count <= 0) continue;
    // 1.2.3.4 in a version column is not an address.
    if (rule.key === "ip" && nameHas(input.name, "version")) continue;
    const share = count / sampled;
    const hinted = rule.hint !== null && nameHas(input.name, rule.hint);
    // A ticket, subject or census id that happens to pass a checksum is not sensitive
    // unless its name says what it is (tfn, medicare, abn).
    if (codeLike && rule.collisionProne && !hinted) continue;
    let confidence: SensitiveConfidence | null = null;
    if (rule.collisionProne) {
      if (share >= COLLISION_PRONE_SHARE || (share >= HIGH_SHARE && hinted)) confidence = "high";
      else if (hinted && share >= HINTED_HIGH_SHARE) confidence = "high";
      else if (hinted && share >= MEDIUM_MIN_SHARE) confidence = "medium";
    } else if (share >= HIGH_SHARE || (hinted && share >= HINTED_HIGH_SHARE)) {
      confidence = "high";
    } else if (hinted && share >= MEDIUM_MIN_SHARE) {
      confidence = "medium";
    }
    if (confidence === null) continue;
    signals.push({
      class: rule.class,
      confidence,
      reason: {
        kind: "value",
        label: `${percent(share)} of sampled values look like ${rule.noun}`,
        share,
        count,
      },
    });
  }
  return signals;
}

function embeddedSignals(input: ColumnSensitivityInput): Signal[] {
  const embedded = input.embedded;
  if (embedded === null || embedded === undefined || embedded.scanned <= 0) return [];
  const found: string[] = [];
  let rows = 0;
  for (const [count, noun] of [
    [embedded.email, "an email address"],
    [embedded.phone, "a phone number"],
    [embedded.card, "a card number"],
  ] as const) {
    if (count >= EMBEDDED_MIN_ROWS && count / embedded.scanned >= EMBEDDED_MIN_SHARE) {
      found.push(noun);
      rows += count;
    }
  }
  if (found.length === 0) return [];
  const share = Math.min(1, rows / embedded.scanned);
  return [
    {
      class: "free_text",
      // Free text with a card number in it is worth a look whatever the column is called.
      confidence: embedded.card >= EMBEDDED_MIN_ROWS ? "high" : "medium",
      reason: {
        kind: "value",
        label: `some rows contain ${found.join(", ")} inside the text (${rows.toLocaleString()} of ${embedded.scanned.toLocaleString()} rows scanned)`,
        share,
        count: rows,
      },
    },
  ];
}

/** Name-only evidence. Strong hints are Medium on their own; weak hints are Low. */
function nameSignals(input: ColumnSensitivityInput): Signal[] {
  const name = input.name;
  const signals: Signal[] = [];
  const add = (cls: SensitiveClass, confidence: SensitiveConfidence, word: string): void => {
    signals.push({
      class: cls,
      confidence,
      reason: { kind: "name", label: `the column name contains “${word}”` },
    });
  };
  const hit = (group: HintGroup): string | null => firstHint(name, group);

  const dob = hit("dateOfBirth");
  if (dob !== null) add("demographic", "medium", dob);

  const gov = hit("government");
  if (gov !== null) {
    // Business numbers (abn, acn) identify companies as often as people: weak.
    add("government_id", gov === "abn" || gov === "acn" ? "low" : "medium", gov);
  }

  const financial = hit("financial");
  if (financial !== null) {
    // "card" alone is often a tier (Card_Category); it needs a number word to be strong.
    const cardNumber =
      financial === "card" && nameTokens(name).some((t) => ["number", "no", "num", "digits", "pan"].includes(t));
    add("financial", financial === "iban" || financial === "bsb" || cardNumber ? "medium" : "low", financial);
  }

  const health = hit("health");
  if (health !== null && health !== "patient") {
    add("health", health === "diagnosis" || health === "icd" ? "medium" : "low", health);
  }

  const phone = hit("phone");
  if (phone !== null) add("contact", "medium", phone);
  const email = hit("email");
  if (email !== null) add("contact", "medium", email);

  const address = hit("address");
  if (address !== null) add("location", "low", address);
  if (nameHas(name, "network") && !nameTokens(name).includes("mac")) add("location", "low", "ip");
  const coordinate = hit("coordinate");
  if (coordinate !== null) add("location", "low", coordinate);

  const demographic = hit("demographic");
  if (demographic !== null) add("demographic", "low", demographic);

  // A bare "name" is a product, city or file; it needs a person word in front.
  const tokens = nameTokens(name);
  const compound = tokens.find((token) =>
    ["firstname", "lastname", "surname", "fullname", "givenname", "middlename"].includes(token),
  );
  if (compound !== undefined) add("personal_name", "medium", compound);
  else if (tokens.includes("name") && nameHas(name, "personQualifier")) {
    add("personal_name", "medium", firstHint(name, "personQualifier") ?? "name");
  } else if (input.semantic?.type === "person_name") {
    add("personal_name", "medium", "name");
  }
  return signals;
}

function strongest(signals: readonly Signal[]): { cls: SensitiveClass; confidence: SensitiveConfidence } | null {
  let best: Signal | null = null;
  for (const signal of signals) {
    if (
      best === null ||
      CONFIDENCE_RANK[signal.confidence] > CONFIDENCE_RANK[best.confidence] ||
      (CONFIDENCE_RANK[signal.confidence] === CONFIDENCE_RANK[best.confidence] &&
        CLASS_RANK.indexOf(signal.class) < CLASS_RANK.indexOf(best.class))
    ) {
      best = signal;
    }
  }
  return best === null ? null : { cls: best.class, confidence: best.confidence };
}

/** Default handling label from class and confidence. Advisory; the user can change it. */
export function suggestedLabel(cls: SensitiveClass, confidence: SensitiveConfidence): SensitiveLabel {
  if (cls === "government_id" || cls === "health") return confidence === "low" ? "confidential" : "restricted";
  if (confidence === "low") return "internal";
  return "confidential";
}

/**
 * One finding per column, strongest evidence first. Identifier and code columns
 * are not flagged unless a name hint or a non-ambiguous shape says so.
 */
export function scoreSensitivity(inputs: readonly ColumnSensitivityInput[]): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  const bare: ColumnSensitivityInput[] = [];

  for (const input of inputs) {
    const signals = [...valueSignals(input), ...embeddedSignals(input), ...nameSignals(input)];
    const best = strongest(signals);
    if (best === null) {
      if (input.semantic?.type !== "identifier" && nameTokens(input.name).includes("name")) bare.push(input);
      continue;
    }
    const used = signals.filter((signal) => signal.class === best.cls);
    findings.push({
      column: input.column,
      name: input.name,
      class: best.cls,
      confidence: best.confidence,
      reasons: used.map((signal) => signal.reason),
      sampled: input.sampled,
      scanned: input.scanned,
      label: suggestedLabel(best.cls, best.confidence),
    });
  }

  // A bare "name" column counts as a person's name when an email or phone column
  // alongside it is flagged High: that is a contact list, not a product list.
  const hasContact = findings.some((f) => f.class === "contact" && f.confidence === "high");
  if (hasContact) {
    for (const input of bare) {
      findings.push({
        column: input.column,
        name: input.name,
        class: "personal_name",
        confidence: "medium",
        reasons: [
          { kind: "name", label: "the column name contains “name”" },
          { kind: "name", label: "an email or phone column in the same table is flagged" },
        ],
        sampled: input.sampled,
        scanned: input.scanned,
        label: suggestedLabel("personal_name", "medium"),
      });
    }
  }

  return findings.sort(
    (a, b) =>
      CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
      CLASS_RANK.indexOf(a.class) - CLASS_RANK.indexOf(b.class) ||
      a.column - b.column,
  );
}

/** Plain-language names for the UI; no internal ids ever reach the page. */
export const CLASS_NAMES: Record<SensitiveClass, string> = {
  contact: "Contact details",
  government_id: "Government ID",
  financial: "Financial",
  personal_name: "Person's name",
  demographic: "Personal characteristics",
  health: "Health",
  location: "Location",
  free_text: "Personal data inside free text",
};

export const LABEL_NAMES: Record<SensitiveLabel, string> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  restricted: "Restricted",
};
