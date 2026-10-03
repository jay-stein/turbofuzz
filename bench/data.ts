import { mulberry32, pick, randInt } from "./lib/prng.js";

export interface DatasetColumns {
  customer_name: string[];
  company: string[];
  suburb: string[];
  state: string[];
  annual_usage: string[];
  year: string[];
  install_date: string[];
  status: string[];
  nmi: string[];
  solar: string[];
}

export interface Dataset {
  size: number;
  columns: DatasetColumns;
}

const FIRST_NAMES = [
  "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles",
  "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen",
  "Christopher", "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Paul", "Andrew", "Joshua",
  "Kenneth", "Kevin", "Brian", "George", "Edward", "Ronald", "Timothy", "Jason", "Jeffrey", "Ryan",
  "Carol", "Michelle", "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca", "Laura", "Sharon", "Cynthia",
];

const LAST_NAMES = [
  "Johnson", "Jonson", "Johnston", "Johnsen", "Smith", "Smyth", "Smithe",
  "Brown", "Jones", "Williams", "Taylor", "Davies", "Evans", "Wilson", "Thomas", "Roberts",
  "Walker", "Wright", "Robinson", "Thompson", "White", "Hughes", "Edwards", "Green", "Hall",
  "Wood", "Harris", "Martin", "Jackson", "Clarke", "Turner", "Hill", "Scott", "Cooper", "Morris",
  "Ward", "Bell", "Watson", "Baker", "Kelly", "King", "Price", "Bennett", "Gray", "Murray",
  "Ryan", "Bailey", "Cox", "Richardson", "Howard",
];

const COMPANY_SUFFIXES = [
  "Energy", "Electrical", "Solar", "Power", "Group", "Holdings",
  "Services", "Utilities", "Retail", "Gas", "Networks", "Solutions",
];

const COMPANY_STEMS = [
  "Aus", "Sun", "Star", "Blue", "Green", "Gold", "Prime", "Metro", "National", "Pacific",
  "Southern", "Northern", "Eastern", "Western", "United", "Global", "Alpha", "Bright", "Clear", "Eco",
];

const SUBURB_BASES = [
  "Malvern", "Footscray", "Richmond", "Carlton", "Brunswick", "Preston", "Reservoir", "Coburg",
  "Hawthorn", "Kew", "Balwyn", "Doncaster", "Ringwood", "Croydon", "Bayswater", "Boronia",
  "Frankston", "Chelsea", "Mordialloc", "Mentone", "Oakleigh", "Clayton", "Glen", "Springvale",
  "Dandenong", "Noble", "Elwood", "Brighton", "Hampton", "Sandringham", "Beaumaris", "Blackburn",
  "Nunawading", "Mitcham", "Vermont", "Wantirna", "Bundoora", "Greensborough", "Eltham", "Diamond",
  "Research", "Montmorency", "Watsonia", "Heidelberg", "Ivanhoe", "Alphington", "Fairfield",
  "Clifton", "Northcote", "Thornbury",
];

const SUBURB_PREFIXES = ["", "North ", "South ", "East ", "West ", "Upper ", "Lower "];
const STATES = ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "NT", "ACT"];
const STATUSES = ["Active", "Inactive", "Pending", "Suspended", "Closed", "Prospect", "Churned", "Trial"];

const FORCED_NAMES = [
  "John Johnson",
  "Jane Jonson",
  "Bob Johnston",
  "Alice Johnsen",
  "Peter Smith",
  "Anne Smyth",
  "Paul Smithe",
  "Malvern Energy",
];

function companyName(rng: () => number): string {
  if (rng() < 0.5) return `${pick(rng, COMPANY_STEMS)} ${pick(rng, COMPANY_SUFFIXES)}`;
  return `${pick(rng, LAST_NAMES)} ${pick(rng, COMPANY_SUFFIXES)}`;
}

function personName(rng: () => number): string {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
}

function suburbName(rng: () => number): string {
  return `${pick(rng, SUBURB_PREFIXES)}${pick(rng, SUBURB_BASES)}`;
}

function formatInt(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

export function generateDataset(size: number, seed: number): Dataset {
  const rng = mulberry32(seed);
  const columns: DatasetColumns = {
    customer_name: new Array<string>(size),
    company: new Array<string>(size),
    suburb: new Array<string>(size),
    state: new Array<string>(size),
    annual_usage: new Array<string>(size),
    year: new Array<string>(size),
    install_date: new Array<string>(size),
    status: new Array<string>(size),
    nmi: new Array<string>(size),
    solar: new Array<string>(size),
  };

  const seenNmi = new Set<string>();

  for (let i = 0; i < size; i++) {
    columns.customer_name[i] = i < FORCED_NAMES.length
      ? FORCED_NAMES[i]
      : i % 3 === 0
        ? companyName(rng)
        : personName(rng);
    columns.company[i] = companyName(rng);
    columns.suburb[i] = suburbName(rng);
    columns.state[i] = pick(rng, STATES);
    columns.annual_usage[i] = rng() < 0.3 ? formatInt(randInt(rng, 0, 120000)) : String(randInt(rng, 0, 120000));
    columns.year[i] = String(randInt(rng, 2018, 2026));
    const day = String(randInt(rng, 1, 28)).padStart(2, "0");
    const month = String(randInt(rng, 1, 12)).padStart(2, "0");
    columns.install_date[i] = `${day}/${month}/${randInt(rng, 2019, 2026)}`;
    columns.status[i] = pick(rng, STATUSES);

    let nmi = "";
    do {
      nmi = String(randInt(rng, 1, 9));
      for (let d = 0; d < 10; d++) nmi += String(randInt(rng, 0, 9));
    } while (seenNmi.has(nmi));
    seenNmi.add(nmi);
    columns.nmi[i] = nmi;

    columns.solar[i] = rng() < 0.35 ? "Yes" : "No";
  }

  return { size, columns };
}
