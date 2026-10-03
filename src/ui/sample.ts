const FIRST = [
  "John", "Jane", "Peter", "Alice", "Bob", "Anne", "Paul", "Chris", "Sarah", "Mark",
  "Emma", "Luke", "Nina", "Tom", "Kate", "Liam", "Olivia", "Noah", "Mia", "Ethan",
];
const LAST = [
  "Johnson", "Jonson", "Johnston", "Johnsen", "Smith", "Smyth", "Brown", "Taylor",
  "Wilson", "Davies", "Evans", "Walker", "Wright", "Harris", "Martin", "Clarke",
];
const SUBURBS = [
  "Malvern", "North Malvern", "Footscray", "Richmond", "Carlton", "Brunswick",
  "Preston", "Hawthorn", "Kew", "Brighton", "Oakleigh", "Dandenong", "Ringwood", "Eltham",
];
const STATUSES = ["Active", "Inactive", "Pending", "Trial", "Closed"];
const SUFFIXES = ["Energy", "Electrical", "Solar", "Power", "Group", "Services"];

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function sampleCsv(rowCount = 300): string {
  const rng = lcg(20261003);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(rng() * values.length)];

  const lines = ["Customer Name,Suburb,Annual Usage,Status,Year,Solar"];
  for (let i = 0; i < rowCount; i++) {
    const person = rng() < 0.7;
    const name = person
      ? `${pick(FIRST)} ${pick(LAST)}`
      : `${pick(LAST)} ${pick(SUFFIXES)}`;
    const suburb = pick(SUBURBS);
    const usage = Math.floor(rng() * 90000) + 1000;
    const status = pick(STATUSES);
    const year = 2020 + Math.floor(rng() * 6);
    const solar = rng() < 0.35 ? "Yes" : "No";
    lines.push(`${name},${suburb},"${usage.toLocaleString("en-US")}",${status},${year},${solar}`);
  }
  return lines.join("\n");
}
