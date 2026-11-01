import { fail } from "../index.ts";
import { BIDS_MAX, KIND_BONDING, rangeIsFlat, rangeLiquidity } from "./book.ts";
import type { Book, Range } from "./book.ts";
import type { SplitRow } from "./split.ts";
import { FRAC, flatMoneyForTokens, flatTokensForMoney, liquidityForMoney, moneyBetween, sqrtAfterTokens, tokensBetween } from "./sqrt.ts";
import type { Sqrt } from "./sqrt.ts";
import { DOWN, UP, U128_MAX, U64_MAX, divW, isqrt, mulDiv, shlDiv } from "./wide.ts";
const CUT_NUDGES = 8;
const ov = <T>(x: T | null): T => (x === null ? fail("Overflow") : x);
const u128 = (x: bigint): bigint => (x > U128_MAX ? fail("Overflow") : x);
const u64 = (x: bigint): bigint => (x > U64_MAX ? fail("Overflow") : x);
function slice(l: bigint, a: Sqrt, hi: Sqrt, sqrtF: Sqrt): {
    money: bigint;
    tok: bigint;
    fIn: bigint;
} {
    const money = ov(moneyBetween(l, a, hi, DOWN));
    const tok = ov(tokensBetween(l, a, hi, UP));
    const f = ov(flatMoneyForTokens(sqrtF, tok, UP));
    return { money, tok, fIn: f < money ? f : money };
}
function cutRoot(l: bigint, hi: Sqrt, sqrtF: Sqrt, left: bigint): Sqrt | null {
    const f2 = sqrtF * sqrtF;
    const fHi = divW(f2, hi, UP);
    if (fHi === null || fHi > U128_MAX)
        return null;
    const lt = shlDiv(left, FRAC, l, DOWN);
    if (lt === null || lt > U128_MAX)
        return null;
    const sum = hi + fHi;
    if (sum > U128_MAX)
        return null;
    const beta = sum - lt;
    if (beta < 0n)
        return null;
    const disc = beta * beta - 4n * f2;
    const sq = beta + isqrt(disc < 0n ? 0n : disc);
    if (sq > U128_MAX)
        return null;
    return sq / 2n + (sq & 1n);
}
export interface RelaySeg {
    lo: Sqrt;
    hi: Sqrt;
    money: bigint;
    fIn: bigint;
}
function absorb(sqrtF: Sqrt, edge: Sqrt, left: bigint): RelaySeg {
    if (edge <= sqrtF)
        return { lo: 0n, hi: 0n, money: 0n, fIn: 0n };
    const money = ov(mulDiv(left, edge, edge - sqrtF, DOWN));
    const f = ov(mulDiv(money, sqrtF, edge, UP));
    return { lo: sqrtF, hi: edge, money, fIn: f < money ? f : money };
}
export function mirror(ranges: readonly Range[], nRanges: number, sqrtF: Sqrt, top0: Sqrt, premium: bigint, tokCap: bigint, segMax: number = BIDS_MAX, absorbLast: boolean = false): {
    segs: RelaySeg[];
    tokens: bigint;
    left: bigint;
} {
    const segs: RelaySeg[] = [];
    let left = premium;
    let tokLeft = tokCap;
    let top = top0;
    if (left === 0n || tokLeft === 0n || segMax <= 0 || top <= sqrtF)
        return { segs, tokens: 0n, left };
    let cutDone = false;
    for (let i = nRanges - 1; i >= 0; i--) {
        const r = ranges[i];
        if (r.kind === KIND_BONDING || rangeIsFlat(r) || r.sqrtA >= top)
            continue;
        const hi = top < r.sqrtB ? top : r.sqrtB;
        const lo = r.sqrtA > sqrtF ? r.sqrtA : sqrtF;
        if (hi <= lo)
            continue;
        const l = ov(rangeLiquidity(r));
        if (l === 0n)
            continue;
        if (absorbLast && segs.length + 1 === segMax)
            break;
        const w = slice(l, lo, hi, sqrtF);
        if (w.money - w.fIn <= left && w.tok <= tokLeft) {
            segs.push({ lo, hi, money: w.money, fIn: w.fIn });
            left -= w.money - w.fIn;
            tokLeft -= w.tok;
            top = lo;
            if (left === 0n || tokLeft === 0n || segs.length === segMax)
                break;
            continue;
        }
        const at = sqrtAfterTokens(l, hi, tokLeft) ?? lo;
        const ap = cutRoot(l, hi, sqrtF, left) ?? lo;
        let a = ap > at ? ap : at;
        if (a < lo)
            a = lo;
        if (a > hi)
            a = hi;
        for (let k = 0; k < CUT_NUDGES + 1 && a < hi; k++, a++) {
            const c = slice(l, a, hi, sqrtF);
            if (c.money - c.fIn <= left && c.tok <= tokLeft) {
                segs.push({ lo: a, hi, money: c.money, fIn: c.fIn });
                left -= c.money - c.fIn;
                tokLeft -= c.tok;
                top = a;
                break;
            }
        }
        cutDone = true;
        break;
    }
    if (absorbLast && !cutDone && left > 0n && tokLeft > 0n && segs.length + 1 === segMax && top > sqrtF) {
        const g = absorb(sqrtF, top, left);
        const tok = g.money === 0n ? 0n : ov(tokensBetween(ov(liquidityForMoney(g.lo, g.hi, g.money)), g.lo, g.hi, UP));
        if (g.money > 0n && tok <= tokLeft) {
            tokLeft -= tok;
            left -= g.money - g.fIn;
            segs.push(g);
        }
    }
    return { segs, tokens: tokCap - tokLeft, left };
}
export interface Relay {
    nC: number;
    nK: number;
    laidC: bigint;
    laidK: bigint;
    atF: bigint;
    kept: number;
}
export function relay(b: Book, row: SplitRow, extraCk: bigint, circ: bigint, ckOut = 0n): Relay {
    const p = b.sqrtP;
    const f = b.sqrtF;
    const zero = (): RelaySeg => ({ lo: 0n, hi: 0n, money: 0n, fIn: 0n });
    let pool = u128(b.ckAtF + extraCk);
    let floor = b.floor - b.ckAtF;
    const edge: Sqrt[] = Array(BIDS_MAX + 1).fill(0n);
    const segs: RelaySeg[] = Array.from({ length: BIDS_MAX }, zero);
    const tok: bigint[] = Array(BIDS_MAX).fill(0n);
    const claim: bigint[] = Array(BIDS_MAX).fill(0n);
    const cflag: boolean[] = Array(BIDS_MAX).fill(false);
    let n = 0;
    let kept = 0;
    for (let i = 0; i < b.nBands; i++) {
        const lo = b.bandEdge[i + 1];
        const hi = b.bandEdge[i];
        const fi = b.bandF[i] < b.bandMoney[i] ? b.bandF[i] : b.bandMoney[i];
        pool = u128(pool + b.bandMoney[i] - fi);
        floor = u128(floor + fi);
        const klo = lo > p ? lo : p;
        if (hi > klo && (b.bandTokens[i] > 0n || b.bandFClaim[i] > 0n)) {
            if (n > 0 && edge[n] !== hi) {
                segs[n] = { lo: hi, hi: edge[n], money: 0n, fIn: 0n };
                edge[n + 1] = hi;
                n++;
            }
            edge[n] = hi;
            segs[n] = { lo: klo, hi, money: 0n, fIn: 0n };
            tok[n] = b.bandTokens[i];
            claim[n] = b.bandFClaim[i];
            cflag[n] = i < b.nC;
            edge[n + 1] = klo;
            n++;
            kept++;
        }
        else if (b.bandTokens[i] > 0n) {
            const t = b.bandTokens[i];
            let mine = t;
            if (f !== 0n) {
                const c = ov(flatTokensForMoney(f, b.bandFClaim[i], UP));
                mine = c < t ? c : t;
            }
            b.floorTokens = u64(b.floorTokens + t);
            b.ckFloorTokens = u64(b.ckFloorTokens + t - mine);
        }
    }
    if (ckOut > pool)
        fail("Overflow");
    pool -= ckOut;
    const room = p > f && f > 0n;
    if (room && n > 0 && edge[n] > p) {
        segs[n] = { lo: p, hi: edge[n], money: 0n, fIn: 0n };
        edge[n + 1] = p;
        n++;
    }
    const nTop = n;
    const r: Relay = { nC: 0, nK: 0, laidC: 0n, laidK: 0n, atF: 0n, kept };
    let lk = pool;
    if (room && n + 1 < BIDS_MAX) {
        const cp = ov(mulDiv(pool, BigInt(row.cShareBps), 10000n, DOWN));
        const backed = ov(flatTokensForMoney(f, floor, DOWN));
        let cap = circ;
        let laid: RelaySeg[];
        let nc: number;
        for (;;) {
            const c = mirror(b.ranges, b.nRanges, f, p, cp, cap, BIDS_MAX - 1 - n, false);
            nc = c.segs.length;
            const ktop = nc > 0 ? c.segs[nc - 1].lo : p;
            const k = mirror(b.ranges, b.nRanges, f, ktop, pool - cp + c.left, cap - c.tokens, BIDS_MAX - n - nc, true);
            laid = [...c.segs, ...k.segs];
            let fi = 0n;
            for (const g of laid)
                fi += g.fIn;
            if (fi <= floor || cap === 0n) {
                lk = k.left;
                break;
            }
            if (cap > backed)
                cap = backed;
            else {
                const short = ov(flatTokensForMoney(f, fi - floor, UP));
                const dropped = short + BigInt(laid.length) + 1n;
                cap = cap > dropped ? cap - dropped : 0n;
            }
        }
        r.nC = nc;
        r.nK = laid.length - nc;
        if (n === 0 && laid.length > 0)
            edge[0] = p;
        laid.forEach((g, j) => {
            segs[n + j] = g;
            edge[n + j + 1] = g.lo;
            cflag[n + j] = j < nc;
            if (j < nc)
                r.laidC += g.money - g.fIn;
            else
                r.laidK += g.money - g.fIn;
        });
        n += laid.length;
    }
    let fIn = 0n;
    for (let i = nTop; i < n; i++)
        fIn += segs[i].fIn;
    if (floor < fIn)
        fail("Overflow");
    b.floor = floor - fIn + lk;
    b.ckAtF = lk;
    b.nBands = n;
    b.nC = cflag.slice(0, n).filter((c) => c).length;
    b.bandEdge = Array.from({ length: BIDS_MAX + 1 }, (_, i) => (n > 0 && i <= n ? edge[i] : 0n));
    b.bandMoney = segs.map((g, i) => (i < n ? g.money : 0n));
    b.bandF = segs.map((g, i) => (i < n ? g.fIn : 0n));
    b.bandTokens = tok.map((t, i) => (i < n ? t : 0n));
    b.bandFClaim = claim.map((c, i) => (i < n ? c : 0n));
    r.atF = lk;
    return r;
}
