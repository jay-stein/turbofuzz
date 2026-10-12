import type { DatasetStats } from "./stats.js";
import type { ColumnMeta } from "../worker/protocol.js";

export type ArchetypeId =
  | "timeSeries"
  | "orders"
  | "customer"
  | "financial"
  | "inventory"
  | "eventLog"
  | "survey"
  | "ml"
  | "messy"
  | "general";

export const ARCHETYPE_LABELS: Record<ArchetypeId, string> = {
  timeSeries: "Time series",
  orders: "Orders & transactions",
  customer: "Customer records",
  financial: "Financial / accounting",
  inventory: "Inventory / operational",
  eventLog: "Event / activity log",
  survey: "Survey",
  ml: "ML dataset",
  messy: "Messy / semi-structured",
  general: "General table",
};

export interface ArchetypeGuess {
  id: ArchetypeId;
  label: string;
  /** 0–1 heuristic confidence; below 0.5 the UI says "General table". */
  confidence: number;
  evidence: string[];
}

const TOKEN_GROUPS = {
  date: ["date", "time", "timestamp", "day", "month", "year", "period", "created", "updated", "start", "end"],
  money: ["amount", "price", "total", "cost", "fee", "paid", "payment", "revenue", "sales", "subtotal"],
  quantity: ["qty", "quantity", "count", "units", "volume"],
  entityId: ["id", "uuid", "guid", "key", "code", "sku", "email", "phone", "account", "number", "no"],
  event: ["event", "type", "action", "activity", "log", "session", "user", "station", "trip", "source"],
  finance: ["debit", "credit", "balance", "ledger", "account", "currency", "amount"],
  inventory: ["sku", "stock", "onhand", "on_hand", "reorder", "warehouse", "location", "bin", "inventory"],
  ml: ["feature", "target", "label", "class", "prediction", "score", "split"],
} as const;

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "");
}

function columnsMatching(
  columns: readonly ColumnMeta[],
  words: readonly string[],
): ColumnMeta[] {
  return columns.filter((column) => tokens(column.name).some((token) => words.includes(token)));
}

interface Candidate {
  id: ArchetypeId;
  score: number;
  evidence: string[];
}

const CAP = 0.95;
const DATE_WORDS: readonly string[] = TOKEN_GROUPS.date;
const eventWords = TOKEN_GROUPS.event;

/**
 * Heuristic table classification over the metadata the worker already sends.
 * Nothing is hidden if the guess is wrong: the result is only a ranking hint
 * with its evidence, and the user can override it.
 */
export function detectArchetypes(
  columns: readonly ColumnMeta[],
  stats: DatasetStats,
  rowCount: number,
): ArchetypeGuess[] {
  const candidates = new Map<ArchetypeId, Candidate>();
  const add = (id: ArchetypeId, points: number, evidence: string): void => {
    const existing = candidates.get(id) ?? { id, score: 0, evidence: [] };
    existing.score = Math.min(CAP, existing.score + points);
    existing.evidence.push(evidence);
    candidates.set(id, existing);
  };

  if (columns.length === 0 || rowCount === 0) {
    return [
      {
        id: "general",
        label: ARCHETYPE_LABELS.general,
        confidence: 0.5,
        evidence: ["No data loaded"],
      },
    ];
  }

  const dates = columns.filter((column) => column.type === "date");
  const numerics = columns.filter(
    (column) => column.type === "integer" || column.type === "number",
  );
  const categories = columns.filter(
    (column) => column.type === "category" || column.type === "boolean",
  );
  const idLike = columns.filter(
    (column) =>
      column.type === "identifier" ||
      (column.stats.distinct === rowCount && rowCount > 20 && column.type !== "date"),
  );
  const lowCardinality = columns.filter((column) => column.stats.distinct <= 10);
  const nullRatio = stats.totalCells > 0 ? stats.totalNullCells / stats.totalCells : 0;
  const suggestionKinds = new Set<string>();
  let suggestionCount = 0;
  for (const column of columns) {
    for (const suggestion of column.suggestions) {
      suggestionKinds.add(suggestion.kind);
      suggestionCount++;
    }
  }
  const numericShare = numerics.length / columns.length;
  const lowCardShare = lowCardinality.length / columns.length;
  const dateNameColumns = columnsMatching(columns, DATE_WORDS);
  const moneyLike = columnsMatching(columns, TOKEN_GROUPS.money);
  const quantityLike = columnsMatching(columns, TOKEN_GROUPS.quantity);
  const eventLike = columnsMatching(columns, eventWords);
  const financeLike = columnsMatching(columns, TOKEN_GROUPS.finance);
  const inventoryLike = columnsMatching(columns, TOKEN_GROUPS.inventory);
  const mlLike = columnsMatching(columns, TOKEN_GROUPS.ml);

  // Time series: a date spine with measures.
  if (dates.length >= 1) {
    add("timeSeries", 0.35, `${dates.length} date column${dates.length === 1 ? "" : "s"}`);
    if (numerics.length >= 1) add("timeSeries", 0.25, `${numerics.length} numeric measure${numerics.length === 1 ? "" : "s"}`);
    if (categories.length === 0) add("timeSeries", 0.1, "no categorical columns");
    if (dateNameColumns.length > 0) add("timeSeries", 0.05, "date-like column names");
  }

  // Event log: dense irregular timestamps, ids, categories.
  if (dates.length >= 1) {
    const densest = Math.max(...dates.map((column) => column.stats.distinct / rowCount));
    if (densest > 0.3 && rowCount > 1000) {
      add("eventLog", 0.35, `${Math.round(densest * 100)}% distinct timestamps across ${rowCount.toLocaleString()} rows`);
    }
  }
  if (idLike.length > 0 && dates.length >= 1) add("eventLog", 0.15, `${idLike.length} id column${idLike.length === 1 ? "" : "s"}`);
  if (eventLike.length > 0) add("eventLog", 0.2, "event/user-style names");
  if (columnsMatching(columns, TOKEN_GROUPS.entityId).length > 0) {
    add("eventLog", 0.1, "repeating keys (station/user/product)");
  }
  if (categories.length > 0) add("eventLog", 0.1, `${categories.length} repeated categor${categories.length === 1 ? "y" : "ies"}`);
  if (rowCount >= 1_000) add("eventLog", 0.1, `${rowCount.toLocaleString()} rows`);

  // Orders & transactions.
  if (idLike.length > 0) add("orders", 0.25, "unique key column");
  if (dates.length >= 1) add("orders", 0.2, "transaction date");
  if (moneyLike.length > 0) add("orders", 0.3, "amount/price-style columns");
  else if (numerics.length >= 1) add("orders", 0.1, "numeric measures");
  if (moneyLike.length > 0 && quantityLike.length > 0) add("orders", 0.1, "quantity and amount together");
  if (categories.length >= 1) add("orders", 0.1, "repeating customer/product keys");

  // Customer / entity records: one row per entity, mostly attributes.
  if (idLike.length > 0 && idLike.length === columns.length - (numerics.length + categories.length)) {
    add("customer", 0.2, "row-per-entity key");
  }
  if (idLike.length > 0 && numericShare <= 0.34) add("customer", 0.3, "unique key with mostly text attributes");
  const contactLike = columnsMatching(columns, ["email", "phone", "name", "customer", "address", "postcode", "zip"]);
  if (contactLike.length > 0) add("customer", 0.25, "contact-style columns");

  // Financial / accounting.
  if (financeLike.length >= 1) add("financial", 0.35, "debit/credit/balance/account columns");
  if (financeLike.length >= 2) add("financial", 0.15, "multiple ledger fields");
  if (dates.length >= 1) add("financial", 0.1, "period column");
  if (columnsMatching(columns, ["currency"]).length > 0) add("financial", 0.15, "currency column");

  // Inventory / operational.
  if (inventoryLike.length > 0) add("inventory", 0.35, "sku/stock/reorder-style columns");
  if (quantityLike.length > 0) add("inventory", 0.15, "on-hand quantities");
  const locationLike = columnsMatching(columns, ["location", "warehouse", "store", "site", "bin"]);
  if (locationLike.length > 0) add("inventory", 0.15, "location keys");

  // Survey: many low-cardinality questions.
  if (lowCardShare >= 0.5) add("survey", 0.3, `${Math.round(lowCardShare * 100)}% low-cardinality columns`);
  if (lowCardShare >= 0.7) add("survey", 0.1, "mostly Likert/Yes-No shaped columns");
  if (idLike.length > 0) add("survey", 0.1, "respondent id");
  if (nullRatio > 0.05) add("survey", 0.1, `${(nullRatio * 100).toFixed(1)}% missing (skip patterns)`);
  if (columnsMatching(columns, ["question", "q1", "answer", "response"]).length > 0) {
    add("survey", 0.15, "question-style columns");
  }

  // ML dataset: many numeric features around a target.
  if (numericShare >= 0.6) add("ml", 0.4, `${Math.round(numericShare * 100)}% numeric columns`);
  if (numerics.length >= 5) add("ml", 0.15, `${numerics.length} numeric features`);
  if (mlLike.length > 0) add("ml", 0.2, "feature/target/label-style names");
  const targetLike = columns.filter(
    (column) =>
      (column.type === "category" || column.type === "boolean") && column.stats.distinct <= 5,
  );
  if (numericShare >= 0.4 && targetLike.length >= 1) add("ml", 0.2, "low-cardinality target-like column");

  // Messy / semi-structured.
  if (nullRatio > 0.05) add("messy", 0.2, `${(nullRatio * 100).toFixed(1)}% empty cells`);
  if (suggestionKinds.has("typeConflict")) add("messy", 0.5, "mixed types in one column");
  if (suggestionKinds.has("formula")) add("messy", 0.15, "formula-like cells");
  if (suggestionKinds.has("mixedNumber")) add("messy", 0.2, "mixed decimal conventions");
  if (suggestionKinds.has("sentinel")) add("messy", 0.1, "sentinel values");
  if (suggestionCount >= Math.max(3, columns.length * 0.3)) add("messy", 0.15, "many fixable issues");
  if (stats.duplicateRows > rowCount * 0.05) add("messy", 0.1, "many duplicate rows");

  const ranked = [...candidates.values()]
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((candidate) => ({
      id: candidate.id,
      label: ARCHETYPE_LABELS[candidate.id],
      confidence: candidate.score,
      evidence: candidate.evidence.slice(0, 4),
    }));

  if (ranked.length === 0 || ranked[0].confidence < 0.5) {
    return [
      {
        id: "general",
        label: ARCHETYPE_LABELS.general,
        confidence: ranked[0]?.confidence ?? 0.4,
        evidence: ranked[0]?.evidence ?? ["no strong structural signals"],
      },
      ...(ranked.length > 1 && ranked[1].confidence >= 0.3 ? [ranked[1]] : []),
    ];
  }
  return ranked;
}
