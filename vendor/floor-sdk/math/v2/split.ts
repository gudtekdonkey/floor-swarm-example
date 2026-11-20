import { fail } from "../index.ts";
import { KIND_BONDING, KIND_TAIL, PIECES_MAX } from "./book.ts";
import type { Range } from "./book.ts";
import { flatMoneyForTokens, sqrtOfRatio, sqrtScaleDownBps } from "./sqrt.ts";
import type { Sqrt } from "./sqrt.ts";
import { U128_MAX, UP } from "./wide.ts";
export const MS_TEAM = 1;
export const MS_HOLDER = 2;
export { PIECES_MAX };
const ov = <T>(x: T | null): T => (x === null ? fail("Overflow") : x);
const u128 = (x: bigint): bigint => (x > U128_MAX ? fail("Overflow") : x);
const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const sat = (a: bigint, b: bigint): bigint => (a > b ? a - b : 0n);
const cdiv = (a: bigint, d: bigint): bigint => (a + d - 1n) / d;
export const shareSplit = (x: bigint, cShareBps: number): [
    bigint,
    bigint
] => {
    const c = cdiv(x * BigInt(cShareBps), 10000n);
    return [c, x - c];
};
export const potsSplit = (x: bigint, cShareBps: number, gapC: bigint, gapK: bigint): [
    bigint,
    bigint
] => {
    let [c, k] = shareSplit(x, cShareBps);
    if (c > gapC) {
        k += c - gapC;
        c = gapC;
    }
    else if (k > gapK) {
        c += k - gapK;
        k = gapK;
    }
    return [c, k];
};
const flatUp = (s: Sqrt, n: bigint): bigint => ov(flatMoneyForTokens(s, n, UP));
export interface SplitRow {
    phiBps: number;
    ckBps: number;
    wcBps: number;
    cShareBps: number;
    msClass: number;
    platformMsBps: number;
    floorMsBps: number;
}
export function splitRowOfRowV2(r: {
    phiBps: number;
    ckTargetBps?: number;
    ckBps?: number;
    wcBps?: number;
    msClass: number;
    flags: number;
    platformMsBps: number;
    floorMsBps: number;
}): SplitRow {
    const ck = r.ckTargetBps ?? r.ckBps;
    if (!Number.isInteger(ck))
        throw new RangeError("splitRowOfRowV2: the row has no C + K share (`ckTargetBps`)");
    if (r.ckTargetBps !== undefined && r.ckBps !== undefined && r.ckTargetBps !== r.ckBps) {
        throw new RangeError(`splitRowOfRowV2: ckTargetBps ${r.ckTargetBps} and ckBps ${r.ckBps} disagree`);
    }
    return {
        phiBps: r.phiBps,
        ckBps: ck as number,
        wcBps: r.wcBps ?? 300,
        cShareBps: 5000,
        msClass: r.msClass,
        platformMsBps: (r.flags & 1) !== 0 ? r.platformMsBps : 0,
        floorMsBps: (r.flags & 2) !== 0 ? r.floorMsBps : 0,
    };
}
export interface Piece {
    sqrtLo: Sqrt;
    sqrtHi: Sqrt;
    money: bigint;
    tokens: bigint;
    range: number;
}
export interface SplitIn {
    sqrtF: Sqrt;
    sqrtP1: Sqrt;
    fTotal: bigint;
    fClaims: bigint;
    c0: bigint;
    k0: bigint;
    held: bigint;
    sNew: bigint;
}
export interface Split {
    dF: bigint;
    ckAdd: bigint;
    ckTake: bigint;
    cAdd: bigint;
    kAdd: bigint;
    cTake: bigint;
    kTake: bigint;
    ms: bigint;
    booked: [
        bigint,
        bigint,
        bigint,
        bigint
    ];
    sqrtFNew: Sqrt;
}
export function surplus(sqrtF: Sqrt, back: bigint, n: bigint): bigint {
    const base = flatMoneyForTokens(sqrtF, n, UP);
    return base === null || base === undefined ? 0n : sat(back, base);
}
export function split(row: SplitRow, ranges: readonly Range[], inp: SplitIn, pieces: readonly Piece[]): Split {
    let tokensSum = 0n;
    for (const p of pieces)
        tokensSum += p.tokens;
    let sr = inp.sNew - tokensSum;
    if (sr < 0n)
        fail("Overflow");
    let fr = inp.fTotal;
    const s0 = surplus(inp.sqrtF, fr + inp.fClaims, sr + inp.held);
    const phi = BigInt(row.phiBps);
    let cAdd = 0n;
    let kAdd = 0n;
    let ms = 0n;
    const cs = BigInt(row.cShareBps);
    const force = (x: bigint): void => {
        const xc = cdiv(x * cs, 10000n);
        cAdd += xc;
        kAdd += x - xc;
    };
    let topNeed = 0n;
    const booked: [
        bigint,
        bigint,
        bigint,
        bigint
    ] = [0n, 0n, 0n, 0n];
    for (const pc of pieces) {
        const r = ranges[pc.range];
        sr += pc.tokens;
        const lo = pc.sqrtLo;
        const capA = cdiv(pc.money * BigInt(r.psiBps), 10000n);
        const capB = cdiv(cdiv(pc.money * inp.sqrtF, lo) * inp.sqrtF, lo);
        const cap = min(max(capA, capB), pc.money);
        const n = sr + inp.held;
        const needAll = max(flatUp(inp.sqrtF, n) + s0, cdiv(flatUp(pc.sqrtHi, n) * phi, 10000n));
        if (r.kind !== KIND_TAIL)
            topNeed = needAll;
        const need = sat(needAll, fr + inp.fClaims);
        const dF = min(cap, need);
        fr += dF;
        const rem = pc.money - dF;
        if (r.thetaBps >= 10000) {
            force(rem);
            continue;
        }
        const t = cdiv(flatUp(pc.sqrtHi, sr) * BigInt(row.ckBps), 10000n);
        const tc = cdiv(t * cs, 10000n);
        const gapC = sat(tc, inp.c0 + cAdd);
        const gapK = sat(t - tc, inp.k0 + kAdd);
        const m = min(rem, gapC + gapK);
        let mc = cdiv(m * cs, 10000n);
        let mk = m - mc;
        if (mc > gapC) {
            mk += mc - gapC;
            mc = gapC;
        }
        else if (mk > gapK) {
            mc += mk - gapK;
            mk = gapK;
        }
        cAdd += mc;
        kAdd += mk;
        let mm = rem - m;
        if (r.msCapPpm > 0) {
            const capm = (pc.money * BigInt(r.msCapPpm)) / 1000000n;
            if (mm > capm) {
                force(mm - capm);
                mm = capm;
            }
        }
        ms += mm;
    }
    let cTake = 0n;
    let kTake = 0n;
    const short = sat(topNeed, fr + inp.fClaims);
    if (short > 0n && inp.c0 + inp.k0 + cAdd + kAdd > 0n) {
        const x = min(short, cAdd + kAdd);
        const [ac, ak] = potsSplit(x, 5000, cAdd, kAdd);
        let left = short - x;
        const m2 = min(left, ms);
        left -= m2;
        const y = min(left, inp.c0 + inp.k0);
        [cTake, kTake] = potsSplit(y, 5000, inp.c0, inp.k0);
        cAdd -= ac;
        kAdd -= ak;
        ms -= m2;
        fr += ac + ak + m2 + cTake + kTake;
    }
    booked[2] = (ms * BigInt(row.platformMsBps)) / 10000n;
    booked[3] = (ms * BigInt(row.floorMsBps)) / 10000n;
    booked[row.msClass === MS_HOLDER ? 1 : 0] += ms - booked[2] - booked[3];
    const ratio = sqrtOfRatio(fr + inp.fClaims, inp.sNew + inp.held);
    const capSqrt = ov(sqrtScaleDownBps(inp.sqrtP1, row.wcBps));
    const sqrtFNew = max(inp.sqrtF, ratio === null ? inp.sqrtF : min(ratio, capSqrt));
    return { dF: fr - inp.fTotal, ckAdd: u128(cAdd + kAdd), ckTake: cTake + kTake, cAdd: u128(cAdd), kAdd: u128(kAdd), cTake, kTake, ms: u128(ms), booked, sqrtFNew };
}
export const pieceEntersSplit = (r: Range): boolean => r.kind !== KIND_BONDING;
