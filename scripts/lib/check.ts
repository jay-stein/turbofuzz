import { readFileSync } from "node:fs";
import { collectExceptions } from "../../src/data/dq-exceptions.js";
import { evaluateRule, parseRulesFile, ruleToCheck, type Rule, type RuleResult } from "../../src/data/rules.js";
import { computeDQScore, type DQScore } from "../../src/data/score.js";
import { spellingVariants } from "../../src/data/variants.js";
import { skipsSimilarity } from "../../src/data/semantic-type.js";
import { profileBuffer, type Profile } from "./profile.js";

export interface CheckResult {
  file: string;
  rows: number;
  columns: number;
  overall: number | null;
  band: string | null;
  bandReason: string | null;
  ruleResults: { rule: Rule; result: RuleResult; failed: boolean }[];
  droppedRules: number;
  profile: Profile;
  exceptionsCsv: string;
  exceptionCount: number;
  /** True when a rule failed beyond its allowance or the score is under the minimum. */
  failed: boolean;
  failures: string[];
}

export interface CheckOptions {
  rulesText?: string;
  minScore?: number;
  hasHeaders?: boolean;
}

/**
 * The headless check: the same profiling, scoring, rules and exception code the page
 * uses, minus the browser. For CI and scheduled runs.
 */
export async function runCheck(path: string, options: CheckOptions = {}): Promise<CheckResult> {
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const name = path.split(/[\\/]/).pop() ?? path;
  const profile = await profileBuffer(name, buffer, { hasHeaders: options.hasHeaders ?? true });
  const { dataset, metas } = profile;

  let rules: Rule[] = [];
  let dropped = 0;
  if (options.rulesText !== undefined) {
    const parsed = parseRulesFile(options.rulesText);
    if ("error" in parsed) throw new Error(parsed.error);
    rules = parsed.file.rules;
    dropped = parsed.dropped;
  }
  const ruleResults = rules.map((rule) => {
    const result = evaluateRule(rule, dataset.columns, dataset.rowCount);
    const share = result.compared === 0 ? 0 : result.fail / result.compared;
    return { rule, result, failed: result.error !== null || share > rule.allowedFailure };
  });
  const checks = ruleResults.map(({ rule, result }) =>
    ruleToCheck(rule, result, metas.findIndex((meta) => meta.name === rule.column)),
  );
  const score: DQScore = computeDQScore(metas, dataset.stats, dataset.rowCount, {}, checks);

  const variantSources = dataset.columns.map((column) => {
    if (skipsSimilarity(column.semantic)) return null;
    let variants: ReturnType<typeof spellingVariants> = null;
    if (column.type === "category" || column.type === "boolean") {
      const built = column.categories();
      variants = spellingVariants(built.labels, built.counts);
    } else if (column.type === "string" && column.semantic?.type !== "free_text") {
      variants = column.spellingVariants();
    }
    return variants === null || variants.mappings.length === 0 ? null : new Set(variants.mappings.map((pair) => pair.from));
  });
  // Flagged columns are masked unless the caller overrides; headless has no sensitive scan
  // result to hide behind, so it masks every column the sensitivity engine raised.
  const masked = new Set(profile.sensitive.map((finding) => finding.column));
  const exceptions = collectExceptions(dataset.columns, dataset.rowCount, {
    maskColumns: masked,
    includeRaw: false,
    variantSources,
    checkId: null,
    optional: new Set(score.optionalColumns),
  });

  const failures: string[] = [];
  for (const entry of ruleResults) {
    if (entry.failed) failures.push(entry.result.error ?? `${entry.rule.type} on ${entry.rule.column}: ${entry.result.fail} of ${entry.result.compared} fail`);
  }
  if (options.minScore !== undefined && (score.overall === null || score.overall < options.minScore)) {
    failures.push(`score ${score.overall?.toFixed(1) ?? "n/a"} is below the minimum ${options.minScore}`);
  }
  return {
    file: name,
    rows: dataset.rowCount,
    columns: dataset.columns.length,
    overall: score.overall,
    band: score.band,
    bandReason: score.bandCap === null ? null : `${score.bandCap.band}: ${score.bandCap.reason}`,
    ruleResults,
    droppedRules: dropped,
    profile,
    exceptionsCsv: exceptions.csv,
    exceptionCount: exceptions.count,
    failed: failures.length > 0,
    failures,
  };
}
