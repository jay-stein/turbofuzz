import { normalize } from "../search/normalize.js";
import { skipsSimilarity } from "./semantic-type.js";
import { MIN_RECOGNISED, candidateKinds } from "./reference.js";
import { stateForms } from "./reference/small-lists.js";
import type { ColumnData } from "./column.js";

/** Forms that are probably, not certainly, one value (N.S.W. / NSW, New South Wales / NSW). Never scored. */
export interface LooseVariants {
  /** Rows in a less used form. */
  rows: number;
  /** True when a long state name was matched to its code through a bundled list. */
  longForm: boolean;
  /** True when company names were matched by their legal ending (Pty Ltd, Proprietary Limited). */
  companyForm?: boolean;
  mappings: { from: string; to: string; count: number }[];
  groups: { spellings: { value: string; count: number }[] }[];
}

/**
 * Deterministic spelling variants: values that differ only by case, spacing or
 * accents (FINANCE / finance / Finance). Unlike fuzzy matches (Melb. vs
 * Melbourne) these are certain, so they count toward the score.
 */
export interface VariantSummary {
  /** Groups holding more than one distinct spelling. */
  groups: number;
  /** Rows written in a minority spelling of their group. */
  minorityRows: number;
  /** Up to three groups, most affected first; spellings by count descending. */
  examples: { spellings: { value: string; count: number }[] }[];
  /**
   * Every minority spelling and the most common spelling of its group, so a fix
   * can standardise exactly what the preview showed. Capped at MAX_MAPPINGS pairs.
   */
  mappings: { from: string; to: string; count: number }[];
  /**
   * Every group (most affected first) with all its spellings, so the user can pick
   * a different standard than the most common one. Capped; absent in older data.
   */
  detail?: { spellings: { value: string; count: number }[] }[];
  /** Punctuation and long-form variants, for review only (see LooseVariants). */
  loose?: LooseVariants;
}

const MAX_DETAIL_GROUPS = 300;
const MAX_DETAIL_SPELLINGS = 20;

const MAX_MAPPINGS = 2000;

type Spelling = { value: string; count: number };

// Most common first; on a tie prefer Title Case or lower case over SHOUTING, then no stray spaces.
const shout = (value: string): number => (value.length > 1 && value === value.toUpperCase() && value !== value.toLowerCase() ? 1 : 0);
const padded = (value: string): number => (value === value.trim() ? 0 : 1);
const byCommon = (a: Spelling, b: Spelling): number => b.count - a.count || shout(a.value) - shout(b.value) || padded(a.value) - padded(b.value);

/** Yes/no words: a column holding only these says two things, however many ways it spells them. */
const TRUTHY = new Set(["y", "yes", "t", "true"]);
const FALSY = new Set(["n", "no", "f", "false"]);

/**
 * The key two spellings must share to be the same value for certain: case, spaces
 * and accents aside, and in a column of nothing but yes/no words, Y, TRUE and Yes alike.
 */
function strictKeys(labels: readonly string[]): string[] {
  const keys = labels.map((label) => normalize(label));
  const present = keys.filter((key) => key !== "");
  const yesNo = present.length > 0 && present.every((key) => TRUTHY.has(key) || FALSY.has(key));
  return yesNo ? keys.map((key) => (key === "" ? key : TRUTHY.has(key) ? "yes" : "no")) : keys;
}

/** Why two spellings share a loose key: only dots, a state's long name, or a company ending. */
type LooseHow = "dots" | "state" | "company";

/**
 * The looser key for forms that are probably, not certainly, one value: dots
 * dropped (N.S.W. and NSW), a state's long name read as its code when the column
 * is named like a state and mostly holds names from that bundled list, and a company's
 * legal ending written one way (Pty Ltd, Proprietary Limited, P/L) when the column holds
 * company names. Values with digits keep their dots (1.0 is not 10).
 */
function looseKeyer(strict: readonly string[], columnName: string): (key: string) => { loose: string; how: LooseHow } {
  const undotted = (key: string): string => (/\d/.test(key) ? key : key.replace(/\.(?!\s)/g, "").replace(/\.\s+/g, " ").trim());
  const plain = strict.map(undotted).filter((key) => key !== "");
  const forms = stateFormsFor(plain, columnName);
  const companies = looksLikeCompanies(plain, columnName);
  return (key) => {
    const value = undotted(key);
    const state = forms?.get(value);
    if (state !== undefined) return { loose: state, how: "state" };
    if (companies) {
      const company = companyKey(value);
      if (company !== value) return { loose: company, how: "company" };
    }
    return { loose: value, how: "dots" };
  };
}

/**
 * A company's legal ending, one way: "Proprietary Limited", "Pty Limited" and "P/L" read as
 * "pty ltd", "Limited" as "ltd", "Incorporated" as "inc", "Corporation" as "corp", "Company"
 * as "co", "&" as "and", and commas dropped. Only the ending is rewritten, never dropped:
 * "Acme" and "Acme Pty Ltd" may be different legal entities, so they stay apart.
 * Takes a key already lower-cased with its dots removed.
 */
export function companyKey(key: string): string {
  let out = key.replace(/,/g, " ").replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
  for (const [pattern, to] of COMPANY_ENDINGS) out = out.replace(pattern, to);
  return out;
}

const COMPANY_ENDINGS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:proprietary|pty) (?:limited|ltd)$/, "pty ltd"],
  [/ p\/l$/, " pty ltd"],
  [/\bprivate limited$/, "pte ltd"],
  [/\blimited$/, "ltd"],
  [/\bincorporated$/, "inc"],
  [/\bcorporation$/, "corp"],
  [/\bcompany$/, "co"],
];

/** A legal ending once written one way. */
const COMPANY_ENDING = /\s(?:pty ltd|pte ltd|ltd|inc|corp|co|llc|llp|lp|plc|gmbh|ag|bv|nv)$/;

/** Named like a column of organisations. */
const COMPANY_COLUMN = /compan|business|employer|vendor|supplier|merchant|firm|organi[sz]ation|entity|payee|insurer|manufacturer|contractor|lender|bank|brand/i;

/**
 * True when a column holds company names: at least three values and a fifth of them end in a
 * legal ending, or it is named like one (supplier, employer…) and at least two do. Anything
 * else (people, places) is left alone, where "Co" or "Inc" may mean something else.
 */
function looksLikeCompanies(keys: readonly string[], columnName: string): boolean {
  const distinct = new Set(keys);
  let ending = 0;
  for (const key of distinct) if (COMPANY_ENDING.test(companyKey(key))) ending++;
  if (COMPANY_COLUMN.test(columnName)) return ending >= 2;
  return ending >= 3 && ending / Math.max(1, distinct.size) >= 0.2;
}

/** Long state name -> its code (both as keys), from the list that recognises most of the column. */
function stateFormsFor(keys: readonly string[], columnName: string): Map<string, string> | null {
  const kinds = candidateKinds(columnName).filter((kind): kind is "auState" | "usState" => kind === "auState" || kind === "usState");
  const distinct = new Set(keys);
  let best: { map: Map<string, string>; recognised: number } | null = null;
  for (const kind of kinds) {
    const map = new Map<string, string>();
    const known = new Set<string>();
    for (const [code, name] of stateForms[kind]) {
      map.set(normalize(name), normalize(code));
      known.add(normalize(name)).add(normalize(code));
    }
    let recognised = 0;
    for (const key of distinct) if (known.has(key)) recognised++;
    if (recognised / Math.max(1, distinct.size) >= MIN_RECOGNISED && (best === null || recognised > best.recognised)) best = { map, recognised };
  }
  return best?.map ?? null;
}

export function spellingVariants(
  labels: readonly string[],
  counts: readonly number[],
  columnName = "",
): VariantSummary | null {
  const keys = strictKeys(labels);
  const byKey = new Map<string, Spelling[]>();
  for (let i = 0; i < labels.length; i++) {
    const key = keys[i]!;
    if (key === "") continue;
    const list = byKey.get(key);
    const entry = { value: labels[i]!, count: counts[i] ?? 0 };
    if (list === undefined) byKey.set(key, [entry]);
    else list.push(entry);
  }
  for (const list of byKey.values()) list.sort(byCommon);
  const loose = looseVariants(byKey, looseKeyer([...byKey.keys()], columnName));
  let groups = 0;
  let minorityRows = 0;
  const mappings: { from: string; to: string; count: number }[] = [];
  const examples: { minority: number; spellings: { value: string; count: number }[] }[] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    groups++;
    const minority = list.slice(1).reduce((sum, entry) => sum + entry.count, 0);
    minorityRows += minority;
    // The standard never keeps a leading or trailing space, even when the padded spelling is the most common.
    const standard = list[0].value.trim();
    for (const entry of list.slice(1)) {
      if (mappings.length < MAX_MAPPINGS) {
        mappings.push({ from: entry.value, to: standard, count: entry.count });
      }
    }
    examples.push({ minority, spellings: list });
  }
  if (groups === 0 && loose === null) return null;
  examples.sort((a, b) => b.minority - a.minority);
  return {
    groups,
    minorityRows,
    examples: examples.slice(0, 3).map(({ spellings }) => ({ spellings: spellings.slice(0, 8) })),
    mappings,
    detail: examples.slice(0, MAX_DETAIL_GROUPS).map(({ spellings }) => ({ spellings: spellings.slice(0, MAX_DETAIL_SPELLINGS) })),
    ...(loose === null ? {} : { loose }),
  };
}

/**
 * Groups of certain spellings that share a loose key (N.S.W. and NSW, New South Wales
 * and NSW, Acme Pty Ltd and Acme Proprietary Limited). Each maps to the most used group's
 * standard spelling. Null when none.
 */
function looseVariants(byKey: ReadonlyMap<string, Spelling[]>, looseKey: (key: string) => { loose: string; how: LooseHow }): LooseVariants | null {
  const byLoose = new Map<string, { key: string; how: LooseHow; total: number; spellings: Spelling[] }[]>();
  for (const [key, spellings] of byKey) {
    const { loose, how } = looseKey(key);
    if (loose === "") continue;
    const entry = { key, how, total: spellings.reduce((sum, s) => sum + s.count, 0), spellings };
    const list = byLoose.get(loose);
    if (list === undefined) byLoose.set(loose, [entry]);
    else list.push(entry);
  }
  let rows = 0;
  let longForm = false;
  let companyForm = false;
  const mappings: { from: string; to: string; count: number }[] = [];
  const examples: { minority: number; spellings: Spelling[] }[] = [];
  for (const [loose, list] of byLoose) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.total - a.total || byCommon(a.spellings[0]!, b.spellings[0]!));
    const standard = list[0]!.spellings[0]!.value.trim();
    if (list.some((group) => group.how === "company")) companyForm = true;
    let minority = 0;
    for (const group of list.slice(1)) {
      if (group.how !== "company" && list[0]!.how !== "company" && group.key.replace(/[.\s]/g, "") !== loose.replace(/\s/g, "")) longForm = true;
      for (const spelling of group.spellings) {
        minority += spelling.count;
        if (mappings.length < MAX_MAPPINGS) mappings.push({ from: spelling.value, to: standard, count: spelling.count });
      }
    }
    rows += minority;
    examples.push({ minority, spellings: list.flatMap((group) => group.spellings).sort(byCommon) });
  }
  if (mappings.length === 0) return null;
  examples.sort((a, b) => b.minority - a.minority);
  return {
    rows,
    longForm,
    ...(companyForm ? { companyForm } : {}),
    mappings,
    groups: examples.slice(0, MAX_DETAIL_GROUPS).map(({ spellings }) => ({ spellings: spellings.slice(0, MAX_DETAIL_SPELLINGS) })),
  };
}

/**
 * Variants for a high-cardinality text column (job titles, countries, cities),
 * counted straight from the raw values in one pass. Returns null when the column
 * has more than `maxDistinct` different values, which keeps the pass bounded.
 */
export function spellingVariantsFromRaw(
  raw: readonly string[],
  isNull: (value: string) => boolean,
  maxDistinct: number,
  columnName = "",
): VariantSummary | null {
  const counts = new Map<string, number>();
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (isNull(value)) continue;
    // Untrimmed: "NSW " is its own spelling of NSW, and a pivot groups it apart.
    counts.set(value, (counts.get(value) ?? 0) + 1);
    if (counts.size > maxDistinct) return null;
  }
  return spellingVariants([...counts.keys()], [...counts.values()], columnName);
}

/**
 * Recode pairs for a set of from -> to spellings. The recode step trims a cell before
 * looking it up, so pairs are keyed on the trimmed spelling, and a padded copy of the
 * standard ("NSW " -> "NSW") becomes a self-pair that trims it.
 */
export function recodePairs(pairs: Iterable<readonly [string, string]>): [string, string][] {
  const out = new Map<string, string>();
  for (const [from, to] of pairs) {
    const key = from.trim();
    if (!out.has(key)) out.set(key, to.trim());
  }
  return [...out];
}

/** A value with its leading and trailing spaces made visible ("NSW␣"), for previews. */
export function showSpaces(value: string): string {
  const trimmed = value.trim();
  if (trimmed === value) return value;
  const start = value.length - value.trimStart().length;
  const end = value.length - value.trimEnd().length;
  return `${"␣".repeat(start)}${trimmed}${"␣".repeat(end)}`;
}

/**
 * The spelling variants the Quality page shows for a column, or null when the column
 * is not checked (free text, identifiers, numbers). Counts come from the untrimmed
 * values for text and category columns alike, so space-padded copies are found.
 */
export function columnVariants(column: ColumnData): VariantSummary | null {
  if (skipsSimilarity(column.semantic)) return null;
  if (column.type === "category" || column.type === "boolean") return column.spellingVariants();
  if (column.type === "string" && column.semantic?.type !== "free_text") return column.spellingVariants();
  return null;
}
