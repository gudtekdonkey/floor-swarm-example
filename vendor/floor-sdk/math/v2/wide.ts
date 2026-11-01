export type Round = "down" | "up";
export const DOWN: Round = "down";
export const UP: Round = "up";
export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;
const W3_LIMIT = 1n << 384n;
export const U256_LIMIT = 1n << 256n;
export function shlW(w: bigint, k: number): bigint | null {
    const v = w << BigInt(k);
    return v >= W3_LIMIT ? null : v;
}
export function shrW(w: bigint, k: number, r: Round): bigint {
    const kk = BigInt(k);
    const q = w >> kk;
    return r === UP && q << kk !== w ? q + 1n : q;
}
export function divW(w: bigint, d: bigint, r: Round): bigint | null {
    if (d === 0n)
        return null;
    const q = w / d;
    if (q >= U256_LIMIT)
        return null;
    if (r === UP && q * d !== w)
        return q + 1n >= U256_LIMIT ? null : q + 1n;
    return q;
}
export const toU128 = (x: bigint | null): bigint | null => (x === null || x > U128_MAX ? null : x);
export const wU128 = toU128;
export const mulDiv = (a: bigint, b: bigint, d: bigint, r: Round): bigint | null => toU128(divW(a * b, d, r));
export const mulShr = (a: bigint, b: bigint, k: number, r: Round): bigint | null => toU128(shrW(a * b, k, r));
export function shlDiv(x: bigint, k: number, d: bigint, r: Round): bigint | null {
    const s = shlW(x, k);
    return s === null ? null : divW(s, d, r);
}
export function isqrt(n: bigint): bigint {
    if (n < 0n)
        throw new RangeError("isqrt of a negative");
    if (n < 2n)
        return n;
    let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
    for (;;) {
        const y = (x + n / x) >> 1n;
        if (y >= x)
            return x;
        x = y;
    }
}
