import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { scoreSensitivity, suggestedLabel, type ColumnSensitivityInput } from "../src/data/sensitivity.js";
import { embeddedShapes, textProfile } from "../src/data/text-profile.js";

const rows = (n: number, make: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => make(i));

/** What the worker pass will do: profile every column and hand the shapes over. */
function inputs(table: Record<string, string[]>): ColumnSensitivityInput[] {
  return Object.entries(table).map(([name, raw], column) => {
    const data = ColumnData.create(name, raw);
    const textual = data.type === "string" || data.type === "category" || data.type === "identifier";
    const profile = textual ? textProfile(raw, data.nullMask, 1, false) : null;
    return {
      column,
      name,
      type: data.type,
      semantic: data.semantic,
      shapes: profile?.shapes ?? null,
      sampled: profile?.rows ?? 0,
      scanned: raw.length - data.stats.nulls,
      embedded: profile !== null && profile.avgLength > 40 ? embeddedShapes(raw, data.nullMask) : null,
    };
  });
}

const byName = (findings: ReturnType<typeof scoreSensitivity>, name: string) =>
  findings.find((f) => f.name === name);

function medicare(seed: number): string {
  const first = String(2 + (seed % 5)) + String(10000000 + ((seed * 7919) % 9000000)).slice(1);
  const digits = first.slice(0, 8).split("").map(Number);
  const check = [1, 3, 7, 9, 1, 3, 7, 9].reduce((sum, w, i) => sum + w * digits[i], 0) % 10;
  return `${first.slice(0, 8)}${check}1`;
}

test("messy customers: email and phone High, name Medium, balance Low, ids and plain columns quiet", () => {
  const n = 1240;
  const findings = scoreSensitivity(
    inputs({
      customer_id: rows(n, (i) => `C${100000 + i}`),
      full_name: rows(n, (i) => `Ann Person${i % 400}`),
      email: rows(n, (i) => (i % 14 === 0 ? "" : i % 20 === 0 ? `bad@@host${i}.com` : `user${i}@example.com`)),
      phone: rows(n, (i) => `04${String(10000000 + i * 13).slice(0, 8)}`),
      balance: rows(n, (i) => String(100 + (i % 977) * 1.5)),
      status: rows(n, (i) => ["active", "inactive", "pending"][i % 3]),
      city: rows(n, (i) => ["Sydney", "Melbourne", "Perth"][i % 3]),
      signup_date: rows(n, (i) => `2023-0${(i % 9) + 1}-${10 + (i % 18)}`),
    }),
  );
  assert.equal(byName(findings, "email")?.class, "contact");
  assert.equal(byName(findings, "email")?.confidence, "high");
  assert.equal(byName(findings, "phone")?.confidence, "high");
  assert.equal(byName(findings, "full_name")?.class, "personal_name");
  assert.equal(byName(findings, "full_name")?.confidence, "medium");
  assert.equal(byName(findings, "balance")?.confidence, "low");
  for (const quiet of ["customer_id", "status", "city", "signup_date"]) {
    assert.equal(byName(findings, quiet), undefined, quiet);
  }
});

test("sales, trips and assay style tables raise nothing", () => {
  const n = 600;
  const findings = scoreSensitivity(
    inputs({
      product_name: rows(n, (i) => `Widget ${i % 50}`),
      region: rows(n, (i) => ["North", "South", "East"][i % 3]),
      zone: rows(n, (i) => `Z${i % 12}`),
      type: rows(n, (i) => ["a", "b"][i % 2]),
      batch: rows(n, (i) => `B-${i % 30}`),
      flag_1: rows(n, (i) => (i % 2 ? "1" : "0")),
      units: rows(n, (i) => String(i % 40)),
      percentage: rows(n, (i) => String(i % 100)),
      image: rows(n, (i) => `img${i}.png`),
    }),
  );
  assert.deepEqual(findings, []);
});

test("random 11 and 16 digit columns are never High", () => {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const eleven = rows(500, () => String(10000000000 + (next() % 89999999999)));
  const sixteen = rows(500, () => String(1000000000000000 + (next() % 8999999999999999)));
  const findings = scoreSensitivity(inputs({ reference: eleven, serial_value: sixteen }));
  assert.ok(findings.every((f) => f.confidence !== "high"), JSON.stringify(findings));
});

test("a collision-prone shape needs a name hint or near-total share", () => {
  const abn = (n: number): string => {
    for (let x = 10000000000 + n * 7919; ; x++) {
      const d = String(x).split("").map(Number);
      d[0] -= 1;
      const sum = d.reduce((t, v, i) => t + v * [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19][i], 0);
      if (sum % 89 === 0) return String(x);
    }
  };
  const valid = rows(120, (i) => abn(i));
  const mixed = rows(120, (i) => (i % 3 === 0 ? abn(i) : String(10000000000 + i * 977)));
  const findings = scoreSensitivity(inputs({ abn_column: valid, other: mixed }));
  assert.equal(byName(findings, "abn_column")?.confidence, "high");
  assert.equal(byName(findings, "other"), undefined, "a third valid by coincidence is not enough");
});

test("identifier, ticket and date columns are not read as phones or tax numbers", () => {
  const findings = scoreSensitivity(
    inputs({
      Ticket: rows(300, (i) => (i % 2 ? `PC ${17000 + i}` : String(300000 + i * 3))),
      USUBJID: rows(300, (i) => `STUDY1-${1000 + i}`),
      geo_id: rows(300, (i) => String(22079011700 + i * 100)),
      transaction_date: rows(300, (i) => `2023-0${(i % 9) + 1}-${10 + (i % 18)}`),
    }),
  );
  assert.deepEqual(findings, []);
});

test("shapes: medicare, ip address, coordinate pair, card", () => {
  const nulls = ColumnData.create("x", ["a"]).nullMask;
  const shapes = textProfile(
    [medicare(1), "192.168.1.20", "-33.865143, 151.209900", "4111 1111 1111 1111", "999.1.1.1"],
    nulls,
    1,
    false,
  ).shapes;
  assert.equal(shapes.medicare, 1);
  assert.equal(shapes.ip, 1);
  assert.equal(shapes.latLon, 1);
  assert.equal(shapes.creditCard, 1);
});

test("free text with embedded card numbers is flagged without any raw value", () => {
  const notes = rows(400, (i) =>
    i % 8 === 0
      ? `customer paid by card 4111 1111 1111 1111 on file, ref ${i}, please follow up on the order soon`
      : `routine follow up call number ${i} about the delivery window and the usual checks done`,
  );
  const findings = scoreSensitivity(inputs({ notes }));
  const finding = byName(findings, "notes");
  assert.equal(finding?.class, "free_text");
  assert.equal(finding?.confidence, "high");
  assert.ok(!JSON.stringify(finding).includes("4111"), "no raw values in findings");
});

test("a bare name column counts as a person only when an email column is flagged", () => {
  const people = inputs({
    name: rows(300, (i) => `Ann Smith${i % 80}`),
    email: rows(300, (i) => `u${i}@example.com`),
  });
  assert.equal(byName(scoreSensitivity(people), "name")?.class, "personal_name");
  const alone = scoreSensitivity(inputs({ name: rows(300, (i) => `Widget ${i % 80}`) }));
  assert.equal(byName(alone, "name"), undefined);
  const product = scoreSensitivity(inputs({ product_name: rows(300, (i) => `Widget ${i % 80}`) }));
  assert.equal(byName(product, "product_name"), undefined);
});

test("strong name hints are Medium without values; Card_Category is not a card number", () => {
  const findings = scoreSensitivity(
    inputs({
      date_of_birth: rows(200, (i) => `19${60 + (i % 40)}-0${(i % 9) + 1}-15`),
      tfn: rows(200, (i) => `T${i}`),
      Card_Category: rows(200, (i) => ["Blue", "Gold", "Silver"][i % 3]),
      card_number: rows(200, (i) => `X${i}`),
    }),
  );
  assert.equal(byName(findings, "date_of_birth")?.confidence, "medium");
  assert.equal(byName(findings, "tfn")?.confidence, "medium");
  assert.equal(byName(findings, "Card_Category")?.confidence, "low");
  assert.equal(byName(findings, "card_number")?.confidence, "medium");
});

test("labels default from class and confidence", () => {
  assert.equal(suggestedLabel("government_id", "high"), "restricted");
  assert.equal(suggestedLabel("health", "medium"), "restricted");
  assert.equal(suggestedLabel("contact", "high"), "confidential");
  assert.equal(suggestedLabel("financial", "low"), "internal");
});

test("scoring 71 columns takes a few milliseconds", () => {
  const table: Record<string, string[]> = {};
  for (let c = 0; c < 71; c++) table[`col_${c}`] = rows(50, (i) => `v${i % 7}`);
  const prepared = inputs(table);
  const started = performance.now();
  const findings = scoreSensitivity(prepared);
  const elapsed = performance.now() - started;
  assert.deepEqual(findings, []);
  assert.ok(elapsed < 5, `took ${elapsed.toFixed(2)} ms`);
});
