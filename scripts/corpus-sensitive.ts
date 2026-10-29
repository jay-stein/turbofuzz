// Lists the possibly-sensitive columns the engine finds in every corpus fixture.
// Usage: npx tsx scripts/corpus-sensitive.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { profileBuffer } from "./lib/profile.js";

const root = join("test", "fixtures", "real-world");
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = readFileSync(join(root, entry.name, "data.csv"));
  const expect = JSON.parse(readFileSync(join(root, entry.name, "expect.json"), "utf8")) as { hasHeaders?: boolean };
  const profile = await profileBuffer(
    "data.csv",
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    { hasHeaders: expect.hasHeaders ?? true },
  );
  console.log(`== ${entry.name}`);
  for (const finding of profile.sensitive) {
    console.log(`   ${finding.name} → ${finding.class} ${finding.confidence}: ${finding.reasons.map((r) => r.label).join(" | ")}`);
  }
}
