/**
 * A seeded, labelled corpus for the sensitive-data engine. Positives are columns that
 * really hold personal data; hard negatives look like it (long digit runs that pass a
 * checksum, ids, codes, dates) but are not. Deterministic: same seed, same columns.
 */
export interface LabelledColumn {
  name: string;
  values: string[];
  /** True when a human would call the column personal / sensitive. */
  sensitive: boolean;
  /** Personal, but only ever advisory (Medium or Low): names, birth dates, addresses, free text. */
  advisory?: boolean;
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const ROWS = 400;

const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)];
const digits = (random: () => number, n: number): string => Array.from({ length: n }, () => Math.floor(random() * 10)).join("");

export function luhn(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return body + String((10 - (sum % 10)) % 10);
}

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
export function abn(random: () => number): string {
  for (;;) {
    const d = digits(random, 11);
    const nums = d.split("").map(Number);
    nums[0] -= 1;
    if (nums[0] < 0) continue;
    if (nums.reduce((s, n, i) => s + n * ABN_WEIGHTS[i], 0) % 89 === 0) return d;
  }
}

const TFN_WEIGHTS = [1, 4, 3, 7, 5, 8, 6, 9, 10];
export function tfn(random: () => number): string {
  for (;;) {
    const d = digits(random, 9);
    if (d.split("").reduce((s, c, i) => s + Number(c) * TFN_WEIGHTS[i], 0) % 11 === 0) return d;
  }
}

export function iban(random: () => number): string {
  const bban = digits(random, 18);
  const numeric = (text: string): string => text.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const rearranged = numeric(`${bban}GB00`);
  let remainder = 0;
  for (const c of rearranged) remainder = (remainder * 10 + Number(c)) % 97;
  const check = String(98 - remainder).padStart(2, "0");
  return `GB${check}${bban}`;
}

const FIRST = ["Ann", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun", "Kai", "Lea"];
const LAST = ["Smith", "Nguyen", "Patel", "Jones", "Brown", "Wilson", "Taylor", "Evans", "Lee", "Khan"];
const STREETS = ["Smith St", "High Rd", "King Ave", "Park Lane", "Station Rd", "Queen St"];

export function buildCorpus(seed = 20261029): LabelledColumn[] {
  const random = rng(seed);
  const advisoryNames = new Set(["full_name", "date_of_birth", "home_address", "notes"]);
  const col = (name: string, sensitive: boolean, make: (i: number) => string): LabelledColumn => ({
    name,
    sensitive,
    ...(advisoryNames.has(name) ? { advisory: true } : {}),
    values: Array.from({ length: ROWS }, (_, i) => make(i)),
  });
  return [
    // Positives.
    col("email", true, (i) => `${pick(random, FIRST).toLowerCase()}${i}@example.com`),
    col("contact_email", true, (i) => `${pick(random, LAST).toLowerCase()}.${i}@mail.org`),
    col("mobile", true, (i) => (i % 3 === 0 ? `+61 4${digits(random, 2)} ${digits(random, 3)} ${digits(random, 3)}` : `04${digits(random, 8)}`)),
    col("phone", true, (i) => (i % 2 === 0 ? `(0${2 + (i % 3)}) ${digits(random, 4)} ${digits(random, 4)}` : `0${2 + (i % 3)}${digits(random, 8)}`)),
    col("tfn", true, () => tfn(random)),
    col("abn", true, () => abn(random)),
    col("card_number", true, () => luhn(`4${digits(random, 14)}`)),
    col("iban", true, () => iban(random)),
    col("full_name", true, (i) => `${pick(random, FIRST)} ${pick(random, LAST)}${i % 7}`),
    col("date_of_birth", true, () => `19${60 + Math.floor(random() * 40)}-0${1 + Math.floor(random() * 9)}-1${Math.floor(random() * 9)}`),
    col("home_address", true, (i) => `${1 + (i % 220)} ${pick(random, STREETS)}`),
    col("ip_address", true, () => `10.${Math.floor(random() * 255)}.${Math.floor(random() * 255)}.${1 + Math.floor(random() * 254)}`),
    col("notes", true, (i) => `Customer ${i} asked for a callback, reach them at ${pick(random, FIRST).toLowerCase()}${i}@example.com or on 04${digits(random, 8)} after lunch please.`),
    // Hard negatives.
    col("order_number", false, () => digits(random, 11)),
    // Order numbers: mostly random 11-digit values, a few of which happen to pass the ABN checksum.
    col("abn_shaped_order", false, (i) => (i % 25 === 0 ? abn(random) : digits(random, 11))),
    col("product_code", false, () => digits(random, 10)),
    col("tracking_number", false, () => digits(random, 16)),
    col("version", false, (i) => `${1 + (i % 4)}.${i % 10}.${i % 7}.${i % 3}`),
    col("sensor_lat", false, () => (-30 + random() * 5).toFixed(5)),
    col("sensor_lon", false, () => (140 + random() * 5).toFixed(5)),
    col("event_date", false, (i) => `2024-0${1 + (i % 9)}-${10 + (i % 18)}`),
    col("event_date_text", false, (i) => `${10 + (i % 18)}-${["Jan", "Feb", "Mar", "Apr"][i % 4]}-2023`),
    col("postcode", false, () => String(2000 + Math.floor(random() * 7000))),
    col("product_name", false, (i) => `Widget ${["Pro", "Max", "Lite"][i % 3]} ${i % 25}`),
    col("ticket", false, (i) => (i % 2 === 0 ? `A/5 ${21000 + i}` : `PC ${17000 + i}`)),
    col("census_geo_id", false, () => digits(random, 11)),
    col("altitude_range", false, () => `${1900 + Math.floor(random() * 90)}-${2100 + Math.floor(random() * 90)}`),
    col("lot", false, (i) => `03-0-${String(60 + (i % 40)).padStart(4, "0")}`),
    col("image_url", false, (i) => `https://cdn.example.com/img/${i}.svg`),
    col("status", false, (i) => ["active", "inactive", "pending"][i % 3]),
    col("price", false, () => (random() * 500).toFixed(2)),
  ];
}
