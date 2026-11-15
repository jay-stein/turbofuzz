import { test } from "node:test";
import assert from "node:assert/strict";
import { pandasRecipeScript, type RecipeInput } from "../src/data/recipe.js";
import { polarsRecipeScript } from "../src/data/recipe-polars.js";
import { recipeSourceOf, type RecipeSource } from "../src/data/recipe-support.js";
import { applyCleanOps } from "../src/data/clean-ops.js";

function input(source?: RecipeSource, extra: Partial<RecipeInput> = {}): RecipeInput {
  return {
    cleans: [],
    transforms: [],
    schema: [
      { name: "city", numeric: false, type: "string" },
      { name: "qty", numeric: true, type: "integer" },
    ],
    ...(source === undefined ? {} : { source }),
    ...extra,
  };
}

const messy: RecipeSource = {
  delimiter: ";",
  encoding: "windows-1252",
  skipRows: 2,
  headerRows: 1,
  skipAfter: 0,
  footerRows: 1,
  columns: ["city", "qty"],
  dropColumns: [],
};

test("without source info the script keeps the plain default reader and says the format is not recorded", () => {
  const pandas = pandasRecipeScript(input()).code;
  const polars = polarsRecipeScript(input()).code;
  assert.match(pandas, /^df = pd\.read_csv\("input\.csv", dtype=\{"city": str\}\)$/m);
  assert.match(polars, /^df = pl\.read_csv\("input\.csv", schema_overrides=\{"city": pl\.Utf8\}\)$/m);
  assert.match(pandas, /does not record the source file format/);
  assert.doesNotMatch(pandas, /_tf_skip|usecols/);
});

test("a source that was not delimited text (a worksheet, JSON) keeps the plain reader", () => {
  const code = pandasRecipeScript(input({ delimiter: null, encoding: null })).code;
  assert.match(code, /^df = pd\.read_csv\("input\.csv", dtype=/m);
});

test("pandas repeats the delimiter, encoding, skipped rows and footer of the file the app read", () => {
  const code = pandasRecipeScript(input(messy)).code;
  assert.match(code, /_tf_skip = _tf_skip_lines\("input\.csv", 2, ";", "cp1252"\)/);
  assert.match(
    code,
    /^df = pd\.read_csv\("input\.csv", sep=";", encoding="cp1252", encoding_errors="replace", skiprows=_tf_skip, header=0, names=\["city", "qty"\], usecols=range\(2\), dtype=\{"city": str\}\)$/m,
  );
  assert.match(code, /^df = df\.dropna\(how="all"\)/m);
  assert.match(code, /^df = df\.iloc\[:-1\]/m);
  assert.doesNotMatch(code, /does not record the source file format/);
});

test("Polars reads cp1252 by decoding it first, and cuts the footer with head(-n)", () => {
  const code = polarsRecipeScript(input(messy)).code;
  assert.match(code, /^import io$/m);
  assert.match(code, /_tf_raw = open\("input\.csv", "rb"\)\.read\(\)\.decode\("cp1252", errors="replace"\)/);
  assert.match(
    code,
    /^df = pl\.read_csv\(io\.BytesIO\(_tf_raw\.encode\("utf-8"\)\), separator=";", skip_rows=_tf_skip, new_columns=\["city", "qty"\], truncate_ragged_lines=True, infer_schema_length=None, schema_overrides=/m,
  );
  assert.match(code, /^df = df\.head\(-1\)/m);
});

test("Polars reads UTF-8 and lossy UTF-8 itself and does not transcode", () => {
  const plain = polarsRecipeScript(input({ delimiter: ",", encoding: "utf-8", skipRows: 0, headerRows: 1, footerRows: 0, columns: ["city", "qty"] })).code;
  assert.doesNotMatch(plain, /io\.BytesIO|encoding=/);
  assert.doesNotMatch(plain, /_tf_skip/);
  const lossy = polarsRecipeScript(input({ delimiter: ",", encoding: "utf-8-repaired", skipRows: 0, headerRows: 1, footerRows: 0, columns: ["city", "qty"] })).code;
  assert.match(lossy, /encoding="utf8-lossy"/);
  const pandasLossy = pandasRecipeScript(input({ delimiter: ",", encoding: "utf-8-repaired", columns: ["city", "qty"] })).code;
  assert.match(pandasLossy, /encoding="utf-8", encoding_errors="replace"/);
});

test("UTF-16 is read with or without a byte-order mark", () => {
  const source: RecipeSource = { delimiter: "\t", encoding: "utf-16le", skipRows: 0, headerRows: 1, footerRows: 0, columns: ["city", "qty"] };
  const pandas = pandasRecipeScript(input(source)).code;
  assert.match(pandas, /_tf_encoding = "utf-16" if open\("input\.csv", "rb"\)\.read\(2\) in \(b"\\xff\\xfe", b"\\xfe\\xff"\) else "utf-16-le"/);
  assert.match(pandas, /sep="\\t", encoding=_tf_encoding/);
  const polars = polarsRecipeScript(input({ ...source, encoding: "utf-16be" })).code;
  assert.match(polars, /else "utf-16-be"/);
  assert.match(polars, /\.decode\(_tf_encoding, errors="replace"\)/);
});

test("a file with no header row is read header-less and named as the app named it", () => {
  const source: RecipeSource = { delimiter: "|", encoding: "utf-8", skipRows: 0, headerRows: 0, skipAfter: 0, footerRows: 0, columns: ["Column 1", "Column 2"] };
  const pandas = pandasRecipeScript(input(source, { schema: [{ name: "Column 1", numeric: false, type: "string" }, { name: "Column 2", numeric: true, type: "integer" }] })).code;
  assert.match(pandas, /sep="\|", header=None, names=\["Column 1", "Column 2"\], usecols=range\(2\), dtype=\{"Column 1": str\}/);
  assert.doesNotMatch(pandas, /_tf_skip|iloc/);
  const polars = polarsRecipeScript(input(source)).code;
  assert.match(polars, /separator="\|", has_header=False, new_columns=\["Column 1", "Column 2"\]/);
});

test("a units row under the header is skipped with the title rows and the names come from the app", () => {
  const source: RecipeSource = { ...messy, delimiter: ",", encoding: "utf-8", skipRows: 1, skipAfter: 1, footerRows: 0 };
  const code = pandasRecipeScript(input(source)).code;
  // One title row + the header + the units row are all rows before the data.
  assert.match(code, /_tf_skip_lines\("input\.csv", 3, ",", "utf-8"\)/);
  assert.match(code, /header=None, names=\["city", "qty"\]/);
});

test("columns the user left out of the import are dropped after the read", () => {
  const source: RecipeSource = { ...messy, columns: ["city", "qty", "notes"], dropColumns: ["notes"] };
  assert.match(pandasRecipeScript(input(source)).code, /^df = df\.drop\(columns=\["notes"\]\)$/m);
  assert.match(polarsRecipeScript(input(source)).code, /^df = df\.drop\(\["notes"\]\)$/m);
});

test("an unchecked end of the file is said in a comment, not guessed", () => {
  const code = pandasRecipeScript(input({ ...messy, footerRows: null })).code;
  assert.match(code, /end of the file was not checked for totals or notes/);
  assert.doesNotMatch(code, /iloc\[:-/);
});

test("the importer's own header detection feeds the source: titles, header, units, footer, left-out columns", () => {
  const rows = [
    ["Orders report", "", ""],
    ["Generated today", "", ""],
    ["city", "qty", "note"],
    ["Perth", "5", "a"],
    ["Hobart", "9", "b"],
    ["Darwin", "11", "c"],
    ["Total", "25", ""],
  ];
  const auto = recipeSourceOf({ preview: rows, whole: true, layout: null, hasHeaders: true, delimiter: ";", encoding: "windows-1252" });
  assert.equal(auto.skipRows, 2);
  assert.equal(auto.headerRows, 1);
  assert.equal(auto.footerRows, 1);
  assert.deepEqual(auto.columns, ["city", "qty", "note"]);
  const chosen = recipeSourceOf({ preview: rows, whole: true, layout: { skipRows: 2, headerRows: 1, skipColumns: [2] }, hasHeaders: true, delimiter: ";", encoding: "utf-8" });
  assert.deepEqual(chosen.columns, ["city", "qty", "note"]);
  assert.deepEqual(chosen.dropColumns, ["note"]);
  const headerless = recipeSourceOf({ preview: rows, whole: true, layout: null, hasHeaders: false, delimiter: "|", encoding: "utf-8" });
  assert.equal(headerless.headerRows, 0);
  assert.equal(headerless.footerRows, 0);
  const partial = recipeSourceOf({ preview: rows, whole: false, layout: null, hasHeaders: true, delimiter: ",", encoding: "utf-8" });
  assert.equal(partial.footerRows, null);
  assert.equal(recipeSourceOf({ preview: rows, whole: true, layout: null, hasHeaders: true, delimiter: null, encoding: null }).delimiter, null);
});

test("title case: the script uses the app's rule, not pandas .str.title() or Polars to_titlecase()", () => {
  const cleans = [{ name: "country", ops: [{ kind: "case", style: "title" } as const] }];
  const pandas = pandasRecipeScript(input(undefined, { cleans })).code;
  const polars = polarsRecipeScript(input(undefined, { cleans })).code;
  assert.doesNotMatch(pandas, /\.str\.title\(\)/);
  assert.doesNotMatch(polars, /to_titlecase/);
  // Both capitalise the first character of each whitespace-separated word and lowercase the rest.
  assert.match(pandas, /re\.sub\(r"\\S\+", lambda m: m\.group\(0\)\[:1\]\.upper\(\) \+ m\.group\(0\)\[1:\]\.lower\(\), v\)/);
  assert.match(polars, /re\.sub\(r"\\S\+", lambda m: m\.group\(0\)\[:1\]\.upper\(\) \+ m\.group\(0\)\[1:\]\.lower\(\), v\)/);
  assert.match(polars, /map_elements\(_tf_title, return_dtype=pl\.Utf8\)/);
  // The rule being copied: what the app itself gives for the cases that differ.
  assert.deepEqual(applyCleanOps(["PEOPLE'S REPUBLIC OF CHINA", "timor-leste", "GUINEA-BISSAU"], [{ kind: "case", style: "title" }]), [
    "People's Republic Of China",
    "Timor-leste",
    "Guinea-bissau",
  ]);
});

test("trim in the script strips the ends and collapses inner runs, as the app's trim does", () => {
  const cleans = [{ name: "name", ops: [{ kind: "trim" } as const] }];
  assert.match(pandasRecipeScript(input(undefined, { cleans })).code, /\.str\.strip\(\)\.str\.replace\(r"\\s\+", " ", regex=True\)/);
  assert.match(polarsRecipeScript(input(undefined, { cleans })).code, /str\.strip_chars\(\)\.str\.replace_all\(r"\\s\+", " "\)/);
  assert.deepEqual(applyCleanOps(["  a   b\t c  "], [{ kind: "trim" }]), ["a b c"]);
});
