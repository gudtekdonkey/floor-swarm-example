// A seeded PRNG (sfc32 over a sha256 of the seed), so a run's draws can be replayed from its stored seed.
import { createHash, randomBytes } from "node:crypto";

export interface Rng {
  readonly seed: string;
  /** [0, 1) */
  next(): number;
  /** an integer in [0, n) */
  int(n: number): number;
  /** a float in [a, b] */
  between(a: number, b: number): number;
  shuffle<T>(xs: readonly T[]): T[];
}

export const newSeed = (): string => randomBytes(8).toString("hex");

export function rng(seed: string = newSeed()): Rng {
  const h = createHash("sha256").update(seed).digest();
  let a = h.readUInt32LE(0), b = h.readUInt32LE(4), c = h.readUInt32LE(8), d = h.readUInt32LE(12);
  const u32 = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return r >>> 0;
  };
  for (let i = 0; i < 12; i++) u32();
  const next = (): number => u32() / 0x1_0000_0000;
  return {
    seed,
    next,
    int: (n) => Math.floor(next() * n),
    between: (x, y) => x + (y - x) * next(),
    shuffle: (xs) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}
