// Headless data-quality check for CI and scheduled runs.
//
//   npx tsx scripts/turbofuzz-check.ts data.csv [--rules=rules.json] [--min-score=80]
//                                       [--exceptions=exceptions.csv] [--json] [--no-header]
//
// Prints the score and the rule results, optionally writes exceptions.csv (flagged
// columns masked), and exits 1 when a rule fails beyond its allowance or the score is
// under --min-score. It runs the same modules as the page; nothing leaves the machine.
import { readFileSync, writeFileSync } from "node:fs";
import { runCheck } from "./lib/check.js";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const option = (name: string): string | undefined => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (file === undefined) {
  console.error("Usage: npx tsx scripts/turbofuzz-check.ts <file> [--rules=rules.json] [--min-score=N] [--exceptions=out.csv] [--json] [--no-header]");
  process.exit(2);
}
const rulesPath = option("rules");
const minScore = option("min-score");
const exceptionsPath = option("exceptions");

try {
  const result = await runCheck(file, {
    ...(rulesPath === undefined ? {} : { rulesText: readFileSync(rulesPath, "utf8") }),
    ...(minScore === undefined ? {} : { minScore: Number(minScore) }),
    hasHeaders: !args.includes("--no-header"),
  });
  if (exceptionsPath !== undefined) writeFileSync(exceptionsPath, result.exceptionsCsv);
  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          file: result.file,
          rows: result.rows,
          columns: result.columns,
          overall: result.overall,
          band: result.band,
          bandReason: result.bandReason,
          rules: result.ruleResults.map(({ rule, result: r, failed }) => ({ id: rule.id, type: rule.type, column: rule.column, fail: r.fail, compared: r.compared, failed, error: r.error })),
          exceptions: result.exceptionCount,
          failed: result.failed,
          failures: result.failures,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`${result.file}: ${result.rows.toLocaleString()} rows, ${result.columns} columns`);
    console.log(`Score ${result.overall === null ? "n/a" : result.overall.toFixed(1)} (${result.band ?? "n/a"})${result.bandReason === null ? "" : ` - ${result.bandReason}`}`);
    for (const { rule, result: r, failed } of result.ruleResults) {
      console.log(`${failed ? "FAIL" : "ok  "} ${rule.type} ${rule.column}${r.error === null ? ` (${r.fail} of ${r.compared})` : ` - ${r.error}`}`);
    }
    if (result.droppedRules > 0) console.log(`Skipped ${result.droppedRules} invalid rule(s) in the rules file.`);
    console.log(`${result.exceptionCount.toLocaleString()} exception cells${exceptionsPath === undefined ? "" : ` written to ${exceptionsPath}`}`);
    for (const failure of result.failures) console.error(`Failed: ${failure}`);
  }
  process.exitCode = result.failed ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
