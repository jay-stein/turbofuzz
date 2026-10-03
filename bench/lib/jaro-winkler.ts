export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatches = new Uint8Array(la);
  const bMatches = new Uint8Array(lb);
  let matches = 0;

  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, lb);
    for (let j = start; j < end; j++) {
      if (bMatches[j] === 1) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = 1;
      bMatches[j] = 1;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (aMatches[i] === 0) continue;
    while (bMatches[k] === 0) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro = (matches / la + matches / lb + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  const maxPrefix = Math.min(4, la, lb);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;

  return jaro + prefix * 0.1 * (1 - jaro);
}
