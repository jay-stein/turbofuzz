/**
 * Column-name hints shared by the registry and the recommender. Whole-word
 * token sets, never substring regexes. No imports, so it can sit under both.
 */

/** Whole-word token sets: "duration" must not match "ratio", "discount" must not match "count". */
export const nameWords = (name: string): string[] =>
  name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const wordSet = (words: string): ReadonlySet<string> => new Set(words.split(" "));
const RATE_WORDS = wordSet(
  "pct percent percentage rate ratio share score age price temp temperature avg average mean index margin",
);
const ADDITIVE_WORDS = wordSet(
  "revenue sales amount total cost spend units unit qty quantity count fare tip balance volume income profit distance duration",
);

const MONEY_WORDS = wordSet("revenue sales amount total cost spend fare income profit balance");
const GOOD_CAT_WORDS = wordSet(
  "status type segment region category city state country channel product group class zone batch tier gender department",
);
const BAD_CAT_WORDS = wordSet("name email phone address");

export const hasWord = (words: ReadonlySet<string>, name: string): boolean =>
  nameWords(name).some((word) => words.has(word));
export const isMoneyName = (name: string): boolean => hasWord(MONEY_WORDS, name);
export const isGoodCategoryName = (name: string): boolean => hasWord(GOOD_CAT_WORDS, name);
/** Names, emails, phones and addresses make poor categories; judged on the last word. */
export const isBadCategoryName = (name: string): boolean => {
  const last = nameWords(name).at(-1);
  return last !== undefined && BAD_CAT_WORDS.has(last);
};

export const isRateName = (name: string): boolean => hasWord(RATE_WORDS, name);
export const isAdditiveName = (name: string): boolean => hasWord(ADDITIVE_WORDS, name);

/** Default aggregation for a measure: average for rates, total for additive quantities. */
export const aggFor = (name: string): "mean" | "sum" =>
  isRateName(name) ? "mean" : isAdditiveName(name) ? "sum" : "mean";

