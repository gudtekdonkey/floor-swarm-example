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
        wcBps: 300,
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
    ck0: bigint;
    held: bigint;
    sNew: bigint;
}
export interface Split {
    dF: bigint;
    ckAdd: bigint;
    ckTake: bigint;
    ms: bigint;
    booked: [
        bigint,
        bigint,
        bigint,
        bigint
    ];
    sqrtFNew: Sqrt;
}
export function split(row: SplitRow, ranges: readonly Range[], inp: SplitIn, pieces: readonly Piece[]): Split {
    let tokensSum = 0n;
    for (const p of pieces)
        tokensSum += p.tokens;
    let sr = inp.sNew - tokensSum;
    if (sr < 0n)
        fail("Overflow");
    let fr = inp.fTotal;
    const phi = BigInt(row.phiBps);
    let ckAdd = 0n;
    let ms = 0n;
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
        const needAll = max(flatUp(inp.sqrtF, n), cdiv(flatUp(pc.sqrtHi, n) * phi, 10000n));
        if (r.kind !== KIND_TAIL)
            topNeed = needAll;
        const need = sat(needAll, fr + inp.fClaims);
        const dF = min(cap, need);
        fr += dF;
        const rem = pc.money - dF;
        if (r.thetaBps >= 10000) {
            ckAdd += rem;
            continue;
        }
        const gap = sat(cdiv(flatUp(pc.sqrtHi, sr) * BigInt(row.ckBps), 10000n), inp.ck0 + ckAdd);
        let ck = min(rem, gap);
        let mm = rem - ck;
        if (r.msCapPpm > 0) {
            const capm = (pc.money * BigInt(r.msCapPpm)) / 1000000n;
            if (mm > capm) {
                ck += mm - capm;
                mm = capm;
            }
        }
        ckAdd += ck;
        ms += mm;
    }
    let ckTake = 0n;
    const short = sat(topNeed, fr + inp.fClaims);
    if (short > 0n && inp.ck0 + ckAdd > 0n) {
        const a = min(short, ckAdd);
        const m2 = min(short - a, ms);
        ckTake = min(short - a - m2, inp.ck0);
        ckAdd -= a;
        ms -= m2;
        fr += a + m2 + ckTake;
    }
    booked[2] = (ms * BigInt(row.platformMsBps)) / 10000n;
    booked[3] = (ms * BigInt(row.floorMsBps)) / 10000n;
    booked[row.msClass === MS_HOLDER ? 1 : 0] += ms - booked[2] - booked[3];
    const ratio = sqrtOfRatio(fr + inp.fClaims, inp.sNew + inp.held);
    const capSqrt = ov(sqrtScaleDownBps(inp.sqrtP1, row.wcBps));
    const sqrtFNew = max(inp.sqrtF, ratio === null ? inp.sqrtF : min(ratio, capSqrt));
    return { dF: fr - inp.fTotal, ckAdd: u128(ckAdd), ckTake, ms: u128(ms), booked, sqrtFNew };
}
export const pieceEntersSplit = (r: Range): boolean => r.kind !== KIND_BONDING;
