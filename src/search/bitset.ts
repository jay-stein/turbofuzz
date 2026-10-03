export function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

export class BitSet {
  readonly words: Uint32Array;

  constructor(readonly size: number) {
    this.words = new Uint32Array((size + 31) >>> 5);
  }

  set(i: number): void {
    this.words[i >>> 5] |= 1 << (i & 31);
  }

  get(i: number): boolean {
    return (this.words[i >>> 5] & (1 << (i & 31))) !== 0;
  }

  setAll(): void {
    this.words.fill(0xffffffff);
    const remainder = this.size & 31;
    if (remainder !== 0) {
      this.words[this.words.length - 1] = (1 << remainder) - 1;
    }
  }

  or(other: BitSet): void {
    const w = this.words;
    const o = other.words;
    for (let i = 0; i < w.length; i++) w[i] |= o[i];
  }

  and(other: BitSet): void {
    const w = this.words;
    const o = other.words;
    for (let i = 0; i < w.length; i++) w[i] &= o[i];
  }

  clear(): void {
    this.words.fill(0);
  }

  clone(): BitSet {
    const copy = new BitSet(this.size);
    copy.words.set(this.words);
    return copy;
  }

  count(): number {
    let total = 0;
    const w = this.words;
    for (let i = 0; i < w.length; i++) total += popcount32(w[i]);
    return total;
  }

  toIndices(): Uint32Array {
    let total = 0;
    const w = this.words;
    for (let i = 0; i < w.length; i++) total += popcount32(w[i]);
    const out = new Uint32Array(total);
    let k = 0;
    for (let i = 0; i < w.length; i++) {
      let word = w[i];
      while (word !== 0) {
        const bit = 31 - Math.clz32(word & -word);
        out[k++] = (i << 5) + bit;
        word &= word - 1;
      }
    }
    return out;
  }

  first(n: number): number[] {
    const out: number[] = [];
    const w = this.words;
    for (let i = 0; i < w.length && out.length < n; i++) {
      let word = w[i];
      while (word !== 0 && out.length < n) {
        const bit = 31 - Math.clz32(word & -word);
        out.push((i << 5) + bit);
        word &= word - 1;
      }
    }
    return out;
  }
}
