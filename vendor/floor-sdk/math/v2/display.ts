import { FloorMathError } from "../index.ts";
import { KIND_BONDING, KIND_TAIL, MAX_WALK_STEPS, bidMoneyOf, feesAt, feesNow, nextAskSqrt, nextBidSqrt, placeMoney, rangeHeld, vaultV2 } from "./book.ts";
export { bidMoneyOf, placeMoney, vaultV2 };
import type { Book } from "./book.ts";
import { LEG_BACKING, LEG_FLOOR, LEG_HOLDER, LEG_PLATFORM, LEG_TEAM } from "./fees.ts";
import { FRAC, priceX64 } from "./sqrt.ts";
import type { Sqrt } from "./sqrt.ts";
import { quoteBookBuy, quoteBookSell } from "./trade.ts";
import type { BookBuy, BookSell } from "./trade.ts";
import { U64_MAX, U128_MAX, isqrt } from "./wide.ts";
export const nextBuySqrt = (b: Book): Sqrt => nextAskSqrt(b) ?? b.sqrtP;
export const nextBuyPriceX64 = (b: Book): bigint => priceX64(nextBuySqrt(b));
export function marketCapV2(b: Book, liveSupply: bigint): bigint {
    if (liveSupply < 0n || liveSupply > U64_MAX)
        throw new RangeError(`liveSupply ${liveSupply}: u64 math units`);
    const s = nextBuySqrt(b);
    return (s * s * liveSupply) >> BigInt(2 * FRAC);
}
export function dexLiquidityV2(b: Book): bigint {
    return dexLiquidityOfParts(bidMoneyOf(b), placeMoney(b));
}
export function dexLiquidityOfParts(bidMoney: bigint, place: bigint): bigint {
    if (bidMoney < 0n || place < 0n)
        throw new RangeError("liquidity parts are money: \u2265 0");
    const s = bidMoney + place;
    if (s > U128_MAX)
        throw new RangeError("liquidity past u128");
    return s;
}
export function bestBidPriceX64V2(b: Book): bigint | null {
    const s = nextBidSqrt(b);
    return s === null ? null : priceX64(s);
}
export const isGraduatedV2 = (b: Book): boolean => b.graduated;
export interface FeeRates {
    backing: number;
    team: number;
    platform: number;
    floorToken: number;
    holder: number;
}
const ratesOf = (ppm: readonly number[]): FeeRates => ({ backing: ppm[LEG_BACKING], team: ppm[LEG_TEAM], platform: ppm[LEG_PLATFORM], floorToken: ppm[LEG_FLOOR], holder: ppm[LEG_HOLDER] });
export interface CurveViewV2 {
    curve: boolean;
    progress: number;
    rates: FeeRates;
    start: FeeRates;
    end: FeeRates;
}
export function curveViewV2(b: Book): CurveViewV2 {
    const curve = b.sqrtFeeB !== 0n;
    let progress = 1;
    if (curve) {
        if (b.sqrtP <= b.sqrtFeeA)
            progress = 0;
        else if (b.sqrtP < b.sqrtFeeB) {
            const lg = (x: bigint): number => Math.log2(Number(x));
            const [la, lb] = [lg(b.sqrtFeeA), lg(b.sqrtFeeB)];
            progress = lb > la ? Math.min(1, Math.max(0, (lg(b.sqrtP) - la) / (lb - la))) : 1;
        }
    }
    return { curve, progress, rates: ratesOf(feesNow(b)), start: ratesOf(curve ? b.feeStartPpm : b.feePpm), end: ratesOf(b.feePpm) };
}
export interface FeesAtMarketCapV2 {
    sqrtP: Sqrt;
    ppm: number[];
    rates: FeeRates;
}
export function feesAtMarketCapV2(b: Book, marketCap: bigint, liveSupply: bigint): FeesAtMarketCapV2 {
    if (liveSupply <= 0n || liveSupply > U64_MAX)
        throw new RangeError(`liveSupply ${liveSupply}: 1 ..= u64 math units`);
    if (marketCap < 0n)
        throw new RangeError("marketCap < 0");
    const sqrtP = isqrt((marketCap << BigInt(2 * FRAC)) / liveSupply);
    const ppm = feesAt(b, sqrtP);
    return { sqrtP, ppm, rates: ratesOf(ppm) };
}
export type LaunchStageV2 = "window" | "stack" | "tail";
export interface StackViewV2 {
    stage: LaunchStageV2;
    range: number | null;
    windowLeft: bigint;
    stackTotal: bigint;
    stackLeft: bigint;
    stackSold: bigint;
    stackSoldBps: number;
    sqrtT0: Sqrt | null;
}
export function stackViewV2(b: Book): StackViewV2 {
    const ask = nextAskSqrt(b);
    let range: number | null = null;
    let total = 0n, left = 0n;
    let t0: Sqrt | null = null;
    for (let i = 0; i < b.nRanges; i++) {
        const r = b.ranges[i];
        if (r.kind === KIND_TAIL)
            t0 ??= r.sqrtA;
        else if (r.kind !== KIND_BONDING) {
            total += r.tokens;
            left += r.askLeft;
        }
        if (ask !== null && range === null && rangeHeld(r) > 0n && (r.sqrtA === r.sqrtB ? ask === r.sqrtA : r.sqrtA <= ask && ask < r.sqrtB)) {
            if (!(b.sqrtF !== 0n && b.sqrtF === ask && b.floorTokens > 0n))
                range = i;
        }
    }
    const kind = range === null ? null : b.ranges[range].kind;
    const stage: LaunchStageV2 = !b.graduated ? "window" : kind === KIND_TAIL || (t0 !== null && ask !== null && ask >= t0) ? "tail" : "stack";
    const sold = total > left ? total - left : 0n;
    return {
        stage,
        range,
        windowLeft: b.graduated || b.nRanges === 0 ? 0n : rangeHeld(b.ranges[0]),
        stackTotal: total,
        stackLeft: left,
        stackSold: sold,
        stackSoldBps: total === 0n ? 0 : Number((sold * 10000n) / total),
        sqrtT0: t0,
    };
}
export interface LaunchDisplayV2 {
    nextBuyPriceX64: bigint;
    marketCap: bigint;
    dexLiquidity: bigint;
    graduated: boolean;
    curve: CurveViewV2;
    stack: StackViewV2;
}
export function launchDisplayV2(b: Book, liveSupply: bigint): LaunchDisplayV2 {
    return { nextBuyPriceX64: nextBuyPriceX64(b), marketCap: marketCapV2(b, liveSupply), dexLiquidity: dexLiquidityV2(b), graduated: b.graduated, curve: curveViewV2(b), stack: stackViewV2(b) };
}
export type ExactOutErrorCode = "Zero" | "Overflow" | "OutOfReach";
export class ExactOutError extends Error {
    readonly code: ExactOutErrorCode;
    constructor(code: ExactOutErrorCode, detail?: string) {
        super(`floor exact-out: ${code}${detail ? ` (${detail})` : ""}`);
        this.name = "ExactOutError";
        this.code = code;
    }
}
export const EXACT_OUT_SCAN = 16n;
const nothing = (e: unknown): boolean => e instanceof FloorMathError && (e.code === "NothingToDo" || e.code === "BookEmpty");
function least(ok: (v: bigint) => boolean, lo: bigint, hi: bigint): bigint {
    while (hi - lo > 1n) {
        const m = (lo + hi) / 2n;
        if (ok(m))
            hi = m;
        else
            lo = m;
    }
    let best = hi;
    for (let v = hi - 1n; v >= 1n && v >= hi - EXACT_OUT_SCAN; v--)
        if (ok(v))
            best = v;
    return best;
}
export function quoteBuyExactOutV2(b: Book, tokensOut: bigint, walkSteps: number = MAX_WALK_STEPS): {
    gross: bigint;
    quote: BookBuy;
    quotes: number;
} {
    if (tokensOut <= 0n)
        throw new ExactOutError("Zero");
    if (tokensOut > U64_MAX)
        throw new ExactOutError("Overflow");
    let quotes = 0;
    const memo = new Map<bigint, BookBuy | null>();
    const at = (g: bigint): BookBuy | null => {
        if (memo.has(g))
            return memo.get(g)!;
        quotes++;
        let r: BookBuy | null = null;
        try {
            r = quoteBookBuy(b, g, walkSteps);
        }
        catch (e) {
            if (!nothing(e))
                throw e;
        }
        memo.set(g, r);
        return r;
    };
    const ok = (g: bigint): boolean => (at(g)?.tokens ?? 0n) >= tokensOut;
    const s = nextBuySqrt(b);
    let hi = (s * s * tokensOut) >> BigInt(2 * FRAC);
    if (hi < 1n)
        hi = 1n;
    let lo = 0n;
    let prev = -1n;
    let flat = 0;
    while (!ok(hi)) {
        const r = at(hi);
        const got = r?.tokens ?? 0n;
        if (r !== null && r.refund > 0n && got === prev) {
            if (++flat >= 2)
                throw new ExactOutError("OutOfReach");
        }
        else
            flat = 0;
        prev = got;
        lo = hi;
        if (hi === U128_MAX)
            throw new ExactOutError("OutOfReach");
        hi = hi * 2n > U128_MAX ? U128_MAX : hi * 2n;
    }
    const gross = least(ok, lo, hi);
    return { gross, quote: at(gross)!, quotes };
}
export function quoteSellExactOutV2(b: Book, quoteOut: bigint): {
    tokensIn: bigint;
    quote: BookSell;
    quotes: number;
} {
    if (quoteOut <= 0n)
        throw new ExactOutError("Zero");
    if (quoteOut > U128_MAX)
        throw new ExactOutError("Overflow");
    let quotes = 0;
    const memo = new Map<bigint, BookSell | null>();
    const at = (t: bigint): BookSell | null => {
        if (memo.has(t))
            return memo.get(t)!;
        quotes++;
        let r: BookSell | null = null;
        try {
            r = quoteBookSell(b, t);
        }
        catch (e) {
            if (!nothing(e))
                throw e;
        }
        memo.set(t, r);
        return r;
    };
    const ok = (t: bigint): boolean => {
        const r = at(t);
        return r !== null && r.unfilled === 0n && r.out >= quoteOut;
    };
    let hi = 1n;
    let lo = 0n;
    while (!ok(hi)) {
        const r = at(hi);
        if (r !== null && r.unfilled > 0n) {
            const filled = hi - r.unfilled;
            if (filled > lo && ok(filled)) {
                hi = filled;
                break;
            }
            throw new ExactOutError("OutOfReach");
        }
        if (hi === U64_MAX)
            throw new ExactOutError("OutOfReach");
        lo = hi;
        hi = hi * 2n > U64_MAX ? U64_MAX : hi * 2n;
    }
    const tokensIn = least(ok, lo, hi);
    return { tokensIn, quote: at(tokensIn)!, quotes };
}
