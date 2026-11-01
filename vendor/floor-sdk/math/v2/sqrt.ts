import { DOWN, UP, U256_LIMIT, divW, isqrt, mulShr, shlDiv, shlW, shrW, toU128 } from "./wide.ts";
import type { Round } from "./wide.ts";
export type Sqrt = bigint;
export const FRAC = 72;
export const ONE: Sqrt = 1n << 72n;
export const SQRT_TAIL_END: Sqrt = 1n << 127n;
const sub = (b: bigint, a: bigint): bigint | null => (b < a ? null : b - a);
export function moneyBetween(l: bigint, a: Sqrt, b: Sqrt, r: Round): bigint | null {
    const d = sub(b, a);
    return d === null ? null : mulShr(l, d, FRAC, r);
}
export function tokensBetween(l: bigint, a: Sqrt, b: Sqrt, r: Round): bigint | null {
    if (a === 0n)
        return null;
    const d = sub(b, a);
    if (d === null)
        return null;
    const t = shlDiv(l * d, FRAC, b, r);
    return t === null ? null : toU128(divW(t, a, r));
}
export function sqrtAfterMoney(l: bigint, p: Sqrt, money: bigint): Sqrt | null {
    const dp = toU128(shlDiv(money, FRAC, l, DOWN));
    return dp === null ? null : toU128(p + dp);
}
export function sqrtAfterTokens(l: bigint, p: Sqrt, tokens: bigint): Sqrt | null {
    const num = shlW(l * p, FRAC);
    const lw = shlW(l, FRAC);
    if (num === null || lw === null || lw >= U256_LIMIT)
        return null;
    const den = lw + tokens * p;
    if (den >= U256_LIMIT)
        return null;
    return toU128(divW(num, den, UP));
}
export function sqrtAfterBuyingTokens(l: bigint, p: Sqrt, tokens: bigint): Sqrt | null {
    const num = shlW(l * p, FRAC);
    const lw = shlW(l, FRAC);
    if (num === null || lw === null || lw >= U256_LIMIT)
        return null;
    const den = lw - tokens * p;
    if (den <= 0n)
        return null;
    return toU128(divW(num, den, UP));
}
export function liquidityForTokens(a: Sqrt, b: Sqrt, tokens: bigint): bigint | null {
    const d = sub(b, a);
    if (d === null || d === 0n)
        return null;
    return toU128(divW(shrW(tokens * a * b, FRAC, DOWN), d, DOWN));
}
export function liquidityForMoney(a: Sqrt, b: Sqrt, money: bigint): bigint | null {
    const d = sub(b, a);
    if (d === null || d === 0n)
        return null;
    return toU128(shlDiv(money, FRAC, d, DOWN));
}
export function flatTokensForMoney(s: Sqrt, money: bigint, r: Round): bigint | null {
    if (s === 0n)
        return null;
    const w = shlW(money, 2 * FRAC);
    if (w === null)
        return null;
    const t = divW(w, s, r);
    return t === null ? null : toU128(divW(t, s, r));
}
export const flatMoneyForTokens = (s: Sqrt, tokens: bigint, r: Round): bigint | null => toU128(shrW(tokens * s * s, 2 * FRAC, r));
export function sqrtOfRatio(money: bigint, tokens: bigint): Sqrt | null {
    if (tokens === 0n)
        return null;
    const w = shlW(money, 2 * FRAC);
    if (w === null)
        return null;
    const n = divW(w, tokens, DOWN);
    return n === null ? null : isqrt(n);
}
export function sqrtScaleDownBps(s: Sqrt, bps: number): Sqrt | null {
    if (bps > 10000)
        return null;
    const n = divW(shlW(BigInt(10000 - bps), 2 * FRAC)!, 10000n, DOWN)!;
    return mulShr(s, isqrt(n), FRAC, DOWN);
}
export const priceX64 = (s: Sqrt): bigint => toU128(shrW(s * s, 2 * FRAC - 64, DOWN)) ?? (1n << 128n) - 1n;
