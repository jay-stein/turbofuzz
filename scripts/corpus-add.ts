// Adds a dataset to the real-world regression corpus.
//
//   npx tsx scripts/corpus-add.ts <file.csv|file.xls> [--name=slug] [--rows=300] [--no-header]
//
// Writes test/fixtures/real-world/<name>/{data.csv, expect.json, SOURCE.md}.
// data.csv is an evenly spaced sample of at most --rows records (so distributions
// survive and big files stay small). expect.json is a DRAFT listing what the app
// flags today; edit it so must_flag holds only the flags that are right, and move
// anything wrong into must_not_flag. SOURCE.md needs the origin and licence.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { listLegacySheets, readLegacySheet } from "../src/parse/xls.js";
import { decodeText } from "../src/parse/encoding.js";
import { parseDelimited } from "../src/parse/parse.js";
import { profileBuffer, raisedFlags } from "./lib/profile.js";

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith("--"));
const option = (name: string, fallback: string): string =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (path === undefined) {
  console.error("Usage: npx tsx scripts/corpus-add.ts <file> [--name=slug] [--rows=300] [--no-header]");
  process.exit(1);
}
const slug = option("name", basename(path).replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
const maxRows = Number.parseInt(option("rows", "300"), 10);
const hasHeaders = !args.includes("--no-header");

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const file = readFileSync(path);
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
let grid: string[][];
if (/\.xls$/i.test(path)) {
  const listing = await listLegacySheets(buffer);
  grid = await readLegacySheet(listing.workbook, listing.sheets[0].name);
} else {
  grid = parseDelimited(decodeText(buffer).text, {
    delimiter: "auto",
    hasHeaders: false,
    normalizeRows: false,
  }).rows;
}

// Keep the leading junk/header block as is, then sample the records evenly.
const lead = Math.min(grid.length, 30);
const body = grid.slice(lead);
const budget = Math.max(0, maxRows - lead);
const stride = Math.max(1, Math.ceil(body.length / Math.max(1, budget)));
const kept = [...grid.slice(0, lead), ...body.filter((_, index) => index % stride === 0).slice(0, budget)];
const csv = kept.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";

const dir = join("test", "fixtures", "real-world", slug);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "data.csv"), csv);

const trimmed = new TextEncoder().encode(csv);
const profile = await profileBuffer("data.csv", trimmed.buffer.slice(0) as ArrayBuffer, { hasHeaders });
const flags = raisedFlags(profile);
const expect = {
  note: "DRAFT written by corpus-add. Keep only the flags that are right in must_flag; move wrong ones to must_not_flag.",
  hasHeaders,
  rows: profile.dataset.rowCount,
  columns: profile.metas.length,
  band: {
    min: Math.floor(((profile.score.overall ?? 0) - 5) / 5) * 5,
    max: 100,
  },
  types: {},
  must_flag: flags,
  must_not_flag: [],
};
writeFileSync(join(dir, "expect.json"), JSON.stringify(expect, null, 2) + "\n");
writeFileSync(
  join(dir, "SOURCE.md"),
  `# ${slug}\n\nOrigin: TODO (URL or description)\nLicence: TODO\nContains personal data: TODO (yes/no; do not commit real personal data)\nTrimmed: ${kept.length} of ${grid.length} rows (evenly spaced sample)\nOriginal file: ${basename(path)}\n`,
);
console.log(`${dir}: ${kept.length} of ${grid.length} rows, ${flags.length} draft flags, score ${profile.score.overall?.toFixed(1)}`);
