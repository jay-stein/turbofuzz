import { looksLikeIdName } from "./identifier.js";
import { nameHas, nameTokens } from "./name-hints.js";
import type { ColumnType } from "../types.js";

/**
 * What a column MEANS, decided once and shared by every detector so Convert
 * offers, format masks, similarity clustering and PII checks agree.
 */
export type SemanticType =
  | "identifier"
  | "phone"
  | "email"
  | "person_name"
  | "address"
  | "geo"
  | "url"
  | "free_text"
  | "code"
  | "date"
  | "duration"
  | "category"
  | "measure"
  | "unknown";

export interface Semantic {
  type: SemanticType;
  /** 0..1, how sure the decision is. */
  confidence: number;
  /** Short plain-language reason, e.g. “name says phone”. */
  reason: string;
}

export { nameTokens };

const URL_VALUE = /^(https?:\/\/|www\.)\S+$/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_VALUE = /^\+?[\d\s().-]{7,}$/;
const NUMBER_RANGE = /^\d{3,4}\s*-\s*\d{3,4}$/;

/** Semantic types that must never be offered a type conversion or judged as numbers. */
const NO_CONVERT: ReadonlySet<SemanticType> = new Set(["identifier", "phone", "code"]);

/** True when converting this column to a number or date would destroy information. */
export function blocksConversion(semantic: Semantic | null | undefined): boolean {
  return semantic !== null && semantic !== undefined && NO_CONVERT.has(semantic.type);
}

/** Types whose values vary by shape on purpose, so a dominant-format check is noise. */
const NO_FORMAT_CHECK: ReadonlySet<SemanticType> = new Set([
  "url",
  "free_text",
  "person_name",
  "address",
]);

export function skipsFormatCheck(semantic: Semantic | null | undefined): boolean {
  return semantic !== null && semantic !== undefined && NO_FORMAT_CHECK.has(semantic.type);
}

/** Types where near-duplicate spelling clusters are meaningless. */
const NO_SIMILARITY: ReadonlySet<SemanticType> = new Set([
  "identifier",
  "code",
  "phone",
  "date",
  "duration",
  "measure",
  "geo",
]);

export function skipsSimilarity(semantic: Semantic | null | undefined): boolean {
  return semantic !== null && semantic !== undefined && NO_SIMILARITY.has(semantic.type);
}

function share(values: readonly string[], test: (value: string) => boolean): number {
  if (values.length === 0) return 0;
  let hits = 0;
  for (const value of values) if (test(value)) hits++;
  return hits / values.length;
}

/**
 * Decides the semantic type from the column name (whole words only), the
 * storage type and a sample of non-null values. Pure: no ColumnData needed.
 */
export function inferSemanticType(
  name: string,
  type: ColumnType,
  sample: readonly string[],
  stats: { distinct: number; nulls: number; avgLength: number | null },
  rowCount: number,
): Semantic {
  const tokens = nameTokens(name);
  const values = sample.map((value) => value.trim()).filter((value) => value !== "");
  const present = Math.max(1, rowCount - stats.nulls);

  if (type === "date" || type === "datetime") return { type: "date", confidence: 1, reason: "typed as a date" };
  if (type === "duration" || type === "time") return { type: "duration", confidence: 1, reason: "typed as a duration" };

  // Shapes first: a column of URLs is a URL column whatever it is called.
  if (values.length >= 5) {
    if (share(values, (v) => URL_VALUE.test(v)) >= 0.6) return { type: "url", confidence: 0.9, reason: "values are web addresses" };
    if (share(values, (v) => EMAIL_VALUE.test(v)) >= 0.6) return { type: "email", confidence: 0.9, reason: "values are email addresses" };
  }

  if (nameHas(name, "phone")) return { type: "phone", confidence: 0.9, reason: "name says phone" };
  if (nameHas(name, "email")) return { type: "email", confidence: 0.7, reason: "name says email" };
  if (nameHas(name, "link") && (type === "string" || type === "category")) return { type: "url", confidence: 0.6, reason: "name says link" };
  if (nameHas(name, "coordinate")) return { type: "geo", confidence: 0.8, reason: "name says coordinate" };
  if (nameHas(name, "address") && !tokens.includes("ip") && !tokens.includes("email")) {
    return { type: "address", confidence: 0.7, reason: "name says address" };
  }
  if (tokens.includes("name") && nameHas(name, "personQualifier")) {
    return { type: "person_name", confidence: 0.7, reason: "name says a person's name" };
  }
  if (tokens.some((token) => token === "firstname" || token === "lastname" || token === "surname" || token === "fullname")) {
    return { type: "person_name", confidence: 0.7, reason: "name says a person's name" };
  }

  if (type === "identifier") return { type: "identifier", confidence: 0.9, reason: "digits with codes or leading zeros" };
  if (looksLikeIdName(name)) return { type: "identifier", confidence: 0.8, reason: "name says identifier" };
  if (nameHas(name, "code") && (type === "string" || type === "category")) {
    return { type: "code", confidence: 0.7, reason: "name says code" };
  }

  if (type === "string" || type === "category") {
    const avg = stats.avgLength ?? 0;
    if (nameHas(name, "freeText") || (avg > 60 && stats.distinct / present > 0.5)) {
      return { type: "free_text", confidence: 0.6, reason: "long, mostly unique text" };
    }
    // Letter+digit tokens that are mostly distinct read as codes, not words.
    if (values.length >= 20 && stats.distinct / present > 0.5) {
      const codeLike = share(values, (v) => /\d/.test(v) && /[A-Za-z]/.test(v) && !/\s{2,}/.test(v) && v.length <= 20);
      if (codeLike >= 0.6) return { type: "code", confidence: 0.6, reason: "mixed letters and digits, mostly distinct" };
    }
    if (values.length >= 20 && share(values, (v) => PHONE_VALUE.test(v) && !NUMBER_RANGE.test(v)) >= 0.8 && stats.distinct / present > 0.5) {
      return { type: "phone", confidence: 0.5, reason: "values look like phone numbers" };
    }
    return type === "category"
      ? { type: "category", confidence: 0.6, reason: "few repeated values" }
      : { type: "unknown", confidence: 0.3, reason: "text" };
  }
  if (type === "integer" || type === "number") return { type: "measure", confidence: 0.5, reason: "numeric" };
  return { type: "unknown", confidence: 0.3, reason: "" };
}
