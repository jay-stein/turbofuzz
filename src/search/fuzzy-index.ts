import { doubleMetaphone } from "double-metaphone";
import { BitSet, popcount32 } from "./bitset.js";
import { jaroWinkler } from "./jaro-winkler.js";
import { tokenize } from "./normalize.js";

export interface FuzzyQueryOptions {
  maxDistance?: number;
  threshold?: number;
  limit?: number;
  profile?: boolean;
}

export interface FuzzyStageTimings {
  candidatesMs: number;
  scoreMs: number;
  expandMs: number;
}

export interface FuzzyQueryResult {
  tokenIds: number[];
  tokenScores: number[];
  rowBits: BitSet;
  candidateCount: number;
  scoredCount: number;
  stages: FuzzyStageTimings;
}

export interface FuzzyIndexStats {
  rows: number;
  distinctTokens: number;
  totalPostings: number;
  totalGrams: number;
  dictMs: number;
  indexMs: number;
  totalMs: number;
}

const NGRAM_SIZE = 2;

/**
 * Token-level fuzzy index.
 *
 * Values are tokenized (so a search term can match any word in a cell), each
 * distinct token is indexed with a bigram posting list, a letter bitmask and a
 * length. Candidates come from bigram votes + cheap filters; expensive
 * Jaro-Winkler scoring runs only on survivors. Matched tokens are expanded to
 * row IDs through posting lists.
 */
export class FuzzyIndex {
  private dict = new Map<string, number>();
  private tokens: string[] = [];
  private postings: number[][] = [];
  private grams = new Map<string, number[]>();
  private phonetic = new Map<string, number[]>();
  private masks = new Uint32Array(0);
  private sortedIds = new Uint32Array(0);
  private voteStamp = new Uint32Array(0);
  private votes = new Uint32Array(0);
  private stampId = 0;
  private rowCount = 0;

  build(values: readonly string[]): FuzzyIndexStats {
    const t0 = performance.now();
    this.rowCount = values.length;
    let totalPostings = 0;

    for (let row = 0; row < values.length; row++) {
      const toks = tokenize(values[row]);
      for (let t = 0; t < toks.length; t++) {
        const tok = toks[t];
        let id = this.dict.get(tok);
        if (id === undefined) {
          id = this.tokens.length;
          this.dict.set(tok, id);
          this.tokens.push(tok);
          this.postings.push([]);
        }
        this.postings[id].push(row);
        totalPostings++;
      }
    }
    const tDict = performance.now();

    const n = this.tokens.length;
    this.masks = new Uint32Array(n);
    this.voteStamp = new Uint32Array(n);
    this.votes = new Uint32Array(n);
    let totalGrams = 0;
    for (let id = 0; id < n; id++) {
      const tok = this.tokens[id];
      this.masks[id] = letterMask(tok);
      totalGrams += addGrams(tok, id, this.grams);
      addPhonetic(tok, id, this.phonetic);
    }
    const tIndex = performance.now();

    const order = new Array<number>(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => compare(this.tokens[a], this.tokens[b]));
    this.sortedIds = Uint32Array.from(order);
    const tSort = performance.now();

    return {
      rows: this.rowCount,
      distinctTokens: n,
      totalPostings,
      totalGrams,
      dictMs: tDict - t0,
      indexMs: tIndex - tDict,
      totalMs: tSort - t0,
    };
  }

  get distinctTokens(): number {
    return this.tokens.length;
  }

  get rows(): number {
    return this.rowCount;
  }

  getTokens(): readonly string[] {
    return this.tokens;
  }

  search(query: string, options: FuzzyQueryOptions = {}): FuzzyQueryResult {
    const k = options.maxDistance ?? 2;
    const threshold = options.threshold ?? 0.72;
    const limit = options.limit ?? 100;
    const profile = options.profile ?? false;
    const stages: FuzzyStageTimings = { candidatesMs: 0, scoreMs: 0, expandMs: 0 };

    const queryTokens = tokenize(query);
    const tokenIds: number[] = [];
    const tokenScores: number[] = [];
    let candidateCount = 0;
    let scoredCount = 0;
    let combined: BitSet | null = null;

    for (const qt of queryTokens) {
      let ids: number[];
      let scores: number[];

      if (qt.length < 3) {
        const start = profile ? performance.now() : 0;
        const matched = this.matchPrefix(qt);
        ids = matched.ids;
        scores = matched.scores;
        candidateCount += ids.length;
        scoredCount += ids.length;
        if (profile) stages.candidatesMs += performance.now() - start;
      } else {
        const cStart = profile ? performance.now() : 0;
        const candidates = this.candidates(qt, k);
        if (profile) stages.candidatesMs += performance.now() - cStart;
        candidateCount += candidates.length;

        const sStart = profile ? performance.now() : 0;
        ids = [];
        scores = [];
        for (let i = 0; i < candidates.length; i++) {
          const id = candidates[i];
          const score = jaroWinkler(qt, this.tokens[id]);
          if (score >= threshold) {
            ids.push(id);
            scores.push(score);
            scoredCount++;
          }
        }
        if (profile) stages.scoreMs += performance.now() - sStart;

        if (ids.length > limit) {
          const order = new Array<number>(ids.length);
          for (let i = 0; i < ids.length; i++) order[i] = i;
          order.sort((a, b) => scores[b] - scores[a]);
          const topIds = new Array<number>(limit);
          const topScores = new Array<number>(limit);
          for (let i = 0; i < limit; i++) {
            topIds[i] = ids[order[i]];
            topScores[i] = scores[order[i]];
          }
          ids = topIds;
          scores = topScores;
        }
      }

      for (let i = 0; i < ids.length; i++) {
        tokenIds.push(ids[i]);
        tokenScores.push(scores[i]);
      }

      const eStart = profile ? performance.now() : 0;
      const bits = new BitSet(this.rowCount);
      for (let i = 0; i < ids.length; i++) {
        const post = this.postings[ids[i]];
        for (let p = 0; p < post.length; p++) bits.set(post[p]);
      }
      if (profile) stages.expandMs += performance.now() - eStart;

      if (combined === null) combined = bits;
      else combined.and(bits);
    }

    return {
      tokenIds,
      tokenScores,
      rowBits: combined ?? new BitSet(this.rowCount),
      candidateCount,
      scoredCount,
      stages,
    };
  }

  /**
   * Exact lookup on precomputed Double Metaphone codes. One encode + hash
   * lookup per query token, then posting-list expansion; no row scanning.
   */
  phoneticSearch(query: string): { tokenIds: number[]; rowBits: BitSet } {
    const queryTokens = tokenize(query);
    const tokenIds: number[] = [];
    const rowBits = new BitSet(this.rowCount);
    if (queryTokens.length === 0) return { tokenIds, rowBits };

    let acc: BitSet | null = null;
    for (const qt of queryTokens) {
      const [primary, secondary] = doubleMetaphone(qt);
      const seen = new Set<number>();
      const bits = new BitSet(this.rowCount);
      const codes = primary === secondary ? [primary] : [primary, secondary];
      for (const code of codes) {
        if (code === "") continue;
        const list = this.phonetic.get(code);
        if (list === undefined) continue;
        for (let i = 0; i < list.length; i++) {
          const id = list[i];
          if (seen.has(id)) continue;
          seen.add(id);
          tokenIds.push(id);
          const post = this.postings[id];
          for (let p = 0; p < post.length; p++) bits.set(post[p]);
        }
      }
      if (acc === null) acc = bits;
      else acc.and(bits);
    }
    return { tokenIds, rowBits: acc ?? rowBits };
  }

  private candidates(q: string, k: number): number[] {
    const grams = uniqueGramsOf(q);
    const minVotes = Math.max(0, grams.length - NGRAM_SIZE * k);
    const qMask = letterMask(q);
    const qLen = q.length;
    const startStamp = this.stampId;
    const touched: number[] = [];

    for (let g = 0; g < grams.length; g++) {
      const list = this.grams.get(grams[g]);
      if (list === undefined) continue;
      const gramStamp = ++this.stampId;
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        if (this.voteStamp[id] <= startStamp) {
          this.voteStamp[id] = gramStamp;
          this.votes[id] = 1;
          touched.push(id);
        } else {
          this.voteStamp[id] = gramStamp;
          this.votes[id]++;
        }
      }
    }

    const out: number[] = [];
    for (let i = 0; i < touched.length; i++) {
      const id = touched[i];
      if (this.votes[id] < minVotes) continue;
      const tok = this.tokens[id];
      if (Math.abs(tok.length - qLen) > k) continue;
      if (popcount32(qMask & ~this.masks[id]) > k) continue;
      out.push(id);
    }
    return out;
  }

  private matchPrefix(q: string): { ids: number[]; scores: number[] } {
    const ids: number[] = [];
    const scores: number[] = [];
    const sorted = this.sortedIds;

    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.tokens[sorted[mid]] < q) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo; i < sorted.length; i++) {
      const id = sorted[i];
      const tok = this.tokens[id];
      if (!tok.startsWith(q)) break;
      ids.push(id);
      scores.push(tok === q ? 1 : 0.9);
    }
    return { ids, scores };
  }
}

function letterMask(s: string): number {
  let mask = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) mask |= 1 << (c - 97);
  }
  return mask;
}

function addGrams(token: string, id: number, grams: Map<string, number[]>): number {
  if (token.length < NGRAM_SIZE) return 0;
  let added = 0;
  for (let i = 0; i + NGRAM_SIZE <= token.length; i++) {
    const gram = token.slice(i, i + NGRAM_SIZE);
    let list = grams.get(gram);
    if (list === undefined) {
      list = [];
      grams.set(gram, list);
    }
    list.push(id);
    added++;
  }
  return added;
}

function addPhonetic(token: string, id: number, map: Map<string, number[]>): void {
  if (!/[a-z]/.test(token)) return;
  const [primary, secondary] = doubleMetaphone(token);
  addPhoneticCode(primary, id, map);
  if (secondary !== primary) addPhoneticCode(secondary, id, map);
}

function addPhoneticCode(code: string, id: number, map: Map<string, number[]>): void {
  if (code === "") return;
  let list = map.get(code);
  if (list === undefined) {
    list = [];
    map.set(code, list);
  }
  list.push(id);
}

function uniqueGramsOf(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i + NGRAM_SIZE <= s.length; i++) {
    const gram = s.slice(i, i + NGRAM_SIZE);
    if (!seen.has(gram)) {
      seen.add(gram);
      out.push(gram);
    }
  }
  return out;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
