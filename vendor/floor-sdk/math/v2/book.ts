import { fail } from "../index.ts";
import { FeeAcc, ratesAt } from "./fees.ts";
import { DOWN, UP, U64_MAX, U128_MAX } from "./wide.ts";
import { SQRT_TAIL_END, flatMoneyForTokens, flatTokensForMoney, liquidityForMoney, liquidityForTokens, moneyBetween, sqrtAfterMoney, sqrtAfterTokens, tokensBetween, } from "./sqrt.ts";
import type { Sqrt } from "./sqrt.ts";
import type { Piece } from "./split.ts";
export const RANGES_MAX = 48;
export const BIDS_MAX = 24;
export const MAX_WALK_STEPS = 24;
export const PIECES_MAX = MAX_WALK_STEPS * 2;
export const SOL_BUY_WALK_STEPS = 16;
export const KIND_BONDING = 0;
export const KIND_CLIMB = 1;
export const KIND_SALE_BAND = 2;
export const KIND_RETIRED_3 = 3;
export const KIND_UNUSED = 4;
export const KIND_TAIL = 5;
export interface Range {
    sqrtA: Sqrt;
    sqrtB: Sqrt;
    tokens: bigint;
    askLeft: bigint;
    back: bigint;
    place: bigint;
    thetaBps: number;
    psiBps: number;
    kind: number;
    class: number;
    msCapPpm: number;
}
export interface Book {
    sqrtP: Sqrt;
    sqrtF: Sqrt;
    sqrtLMax: Sqrt;
    floor: bigint;
    floorTokens: bigint;
    nBands: number;
    nC: number;
    bandEdge: Sqrt[];
    bandMoney: bigint[];
    bandTokens: bigint[];
    bandF: bigint[];
    bandFClaim: bigint[];
    ckAtF: bigint;
    ckFloorTokens: bigint;
    feePpm: number[];
    feeStartPpm: number[];
    sqrtFeeA: Sqrt;
    sqrtFeeB: Sqrt;
    graduated: boolean;
    ownFees?: boolean;
    nRanges: number;
    ranges: Range[];
}
export interface WalkUp {
    money: bigint;
    tokens: bigint;
    fromResale: bigint;
    fromFirst: bigint;
    steps: number;
    budgetHit: boolean;
    graduatedNow: boolean;
}
export interface WalkDown {
    tokens: bigint;
    money: bigint;
    fromF: bigint;
    fromK: bigint;
    fromC: bigint;
    steps: number;
    budgetHit: boolean;
}
type Part = {
    t: "range";
    i: number;
} | {
    t: "band";
    i: number;
} | {
    t: "floor";
};
type FlatPart = {
    t: "range";
    i: number;
} | {
    t: "floor";
};
const ov = <T>(x: T | null): T => (x === null ? fail("Overflow") : x);
const u64 = (x: bigint): bigint => (x < 0n || x > U64_MAX ? fail("Overflow") : x);
const u128 = (x: bigint): bigint => (x < 0n || x > U128_MAX ? fail("Overflow") : x);
export const UNDO_MAX = MAX_WALK_STEPS + 1;
export class Undo {
    private seen = new Set<number>();
    readonly bought: Piece[] = [];
    touch(i: number): void {
        if (this.seen.has(i))
            return;
        if (this.seen.size === UNDO_MAX)
            fail("StepBudget");
        this.seen.add(i);
    }
    buyFirst(i: number, lo: Sqrt, hi: Sqrt, money: bigint, tokens: bigint): void {
        const n = this.bought.length;
        if (n > 0 && this.bought[n - 1].range === i) {
            const p = this.bought[n - 1];
            p.sqrtHi = hi;
            p.money = u128(p.money + money);
            p.tokens = u64(p.tokens + tokens);
            return;
        }
        if (n === PIECES_MAX)
            fail("StepBudget");
        this.bought.push({ sqrtLo: lo, sqrtHi: hi, money, tokens, range: i });
    }
}
const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);
export const emptyRange = (): Range => ({ sqrtA: 0n, sqrtB: 0n, tokens: 0n, askLeft: 0n, back: 0n, place: 0n, thetaBps: 0, psiBps: 0, kind: 0, class: 0, msCapPpm: 0 });
export const rangeIsFlat = (r: Range): boolean => r.sqrtA === r.sqrtB;
export const rangeLiquidity = (r: Range): bigint | null => liquidityForTokens(r.sqrtA, r.sqrtB, r.tokens);
export const rangeHeld = (r: Range): bigint => r.askLeft + r.back;
export function emptyBook(sqrtP: Sqrt, feePpm: readonly number[]): Book {
    return {
        sqrtP,
        sqrtF: 0n,
        sqrtLMax: 0n,
        floor: 0n,
        floorTokens: 0n,
        nBands: 0,
        nC: 0,
        bandEdge: new Array(BIDS_MAX + 1).fill(0n),
        bandMoney: new Array(BIDS_MAX).fill(0n),
        bandTokens: new Array(BIDS_MAX).fill(0n),
        bandF: new Array(BIDS_MAX).fill(0n),
        bandFClaim: new Array(BIDS_MAX).fill(0n),
        ckAtF: 0n,
        ckFloorTokens: 0n,
        feePpm: [...feePpm],
        feeStartPpm: [0, 0, 0, 0, 0],
        sqrtFeeA: 0n,
        sqrtFeeB: 0n,
        graduated: false,
        nRanges: 0,
        ranges: Array.from({ length: RANGES_MAX }, emptyRange),
    };
}
export const feesNow = (b: Book): number[] => feesAt(b, b.sqrtP);
export const feesAt = (b: Book, sqrtP: Sqrt): number[] => ratesAt(b.graduated, b.ownFees === true, b.feePpm, b.feeStartPpm, b.sqrtFeeA, b.sqrtFeeB, sqrtP);
function charge(b: Book, acc: FeeAcc, q: bigint): void {
    if (q > 0n && !acc.add(q, feesAt(b, b.sqrtP)))
        fail("Overflow");
}
export function cloneBook(b: Book): Book {
    return { ...b, bandEdge: [...b.bandEdge], bandMoney: [...b.bandMoney], bandTokens: [...b.bandTokens], bandF: [...b.bandF], bandFClaim: [...b.bandFClaim], feePpm: [...b.feePpm], feeStartPpm: [...b.feeStartPpm], ranges: b.ranges.map((r) => ({ ...r })) };
}
export function pushRange(b: Book, sqrtA: Sqrt, sqrtB: Sqrt, tokens: bigint, kind: number, cls: number): void {
    const n = b.nRanges;
    if (n === RANGES_MAX)
        fail("RowTooManyRanges");
    if (sqrtA === 0n || sqrtA > sqrtB || sqrtB > SQRT_TAIL_END || (n > 0 && b.ranges[n - 1].sqrtB !== sqrtA))
        fail("SqrtRange");
    b.ranges[n] = { ...emptyRange(), sqrtA, sqrtB, tokens: u64(tokens), askLeft: tokens, kind, class: cls };
    b.nRanges++;
}
function cpUp(l: bigint, p: Sqrt, hi: Sqrt, rem: bigint, held: bigint, allAtTop: boolean): [
    bigint,
    bigint,
    Sqrt
] {
    if (held === 0n || p >= hi || l === 0n)
        return [0n, 0n, p];
    const qFull = moneyBetween(l, p, hi, UP);
    let p2: Sqrt, q: bigint;
    if (qFull !== null && rem >= qFull)
        [p2, q] = [hi, qFull];
    else {
        p2 = min(ov(sqrtAfterMoney(l, p, rem)), hi);
        q = ov(moneyBetween(l, p, p2, UP));
    }
    if (p2 <= p)
        return [0n, 0n, p];
    let dt = min(ov(tokensBetween(l, p, p2, DOWN)), held);
    if (allAtTop && p2 === hi)
        dt = held;
    if (dt === 0n)
        return [0n, 0n, p];
    return [dt, q, p2];
}
function cpDown(l: bigint, lo: Sqrt, p: Sqrt, rem: bigint, held: bigint): [
    bigint,
    bigint,
    Sqrt
] {
    if (held === 0n || p <= lo || l === 0n)
        return [0n, 0n, p];
    const xFull = ov(tokensBetween(l, lo, p, UP));
    let p2: Sqrt, dx: bigint;
    if (rem >= xFull)
        [p2, dx] = [lo, xFull & U64_MAX];
    else {
        p2 = max(ov(sqrtAfterTokens(l, p, rem)), lo);
        if (p2 >= p)
            return [0n, 0n, p];
        dx = min(ov(tokensBetween(l, p2, p, UP)), rem);
    }
    const q = min(ov(moneyBetween(l, p2, p, DOWN)), held);
    if (q === 0n)
        return [0n, 0n, p];
    return [dx, q, p2];
}
function flatCanBuy(s: Sqrt, money: bigint): boolean {
    if (money === 0n)
        return false;
    const t = flatTokensForMoney(s, money, DOWN);
    if (t === null || t < 1n)
        return false;
    const q = flatMoneyForTokens(s, t, DOWN);
    return q !== null && q > 0n;
}
const rangeLo = (b: Book, r: Range): Sqrt => max(r.sqrtA, b.sqrtLMax);
function cpEdges(b: Book, pc: Part): [
    Sqrt,
    Sqrt
] {
    switch (pc.t) {
        case "range": return [rangeLo(b, b.ranges[pc.i]), b.ranges[pc.i].sqrtB];
        case "band": return [b.bandEdge[pc.i + 1], b.bandEdge[pc.i]];
        case "floor": return [b.sqrtF, b.sqrtF];
    }
}
function tokensOf(b: Book, pc: Part): bigint {
    switch (pc.t) {
        case "range": return rangeHeld(b.ranges[pc.i]);
        case "band": return b.bandTokens[pc.i];
        case "floor": return b.floorTokens;
    }
}
function moneyOf(b: Book, pc: Part): bigint {
    switch (pc.t) {
        case "range": return b.ranges[pc.i].place;
        case "band": return b.bandMoney[pc.i];
        case "floor": return b.floor;
    }
}
const isFlat = (b: Book, pc: Part): boolean => (pc.t === "range" ? rangeIsFlat(b.ranges[pc.i]) : pc.t === "floor");
function flatBids(b: Book, i: number): boolean {
    const r = b.ranges[i];
    return rangeIsFlat(r) && flatCanBuy(r.sqrtA, r.place);
}
const floorBids = (b: Book): boolean => b.sqrtF !== 0n && flatCanBuy(b.sqrtF, b.floor);
const flatS = (b: Book, pc: Part): Sqrt => (pc.t === "range" ? b.ranges[pc.i].sqrtA : b.sqrtF);
function pieces(b: Book): Part[] {
    const out: Part[] = [];
    for (let i = 0; i < b.nRanges; i++)
        out.push({ t: "range", i });
    for (let i = 0; i < b.nBands; i++)
        out.push({ t: "band", i });
    if (b.sqrtF !== 0n)
        out.push({ t: "floor" });
    return out;
}
const sum = (xs: readonly bigint[], n: number): bigint => {
    let s = 0n;
    for (let i = 0; i < n; i++)
        s += xs[i];
    return s;
};
export function moneyHeld(b: Book): bigint {
    let t = bidMoneySum(b);
    for (let i = 0; i < b.nRanges; i++)
        t += b.ranges[i].place;
    return t;
}
export const fOwn = (b: Book): bigint => b.floor - b.ckAtF + sum(b.bandF, b.nBands);
export const fClaims = (b: Book): bigint => sum(b.bandFClaim, b.nBands);
export const ckMoney = (b: Book): bigint => sum(b.bandMoney, b.nBands) - sum(b.bandF, b.nBands) + b.ckAtF;
export const ckHeld = (b: Book): bigint => sum(b.bandTokens, b.nBands) + b.ckFloorTokens;
const bidMoneySum = (b: Book): bigint => b.floor + sum(b.bandMoney, b.nBands);
export const placeMoney = (b: Book): bigint => {
    let t = 0n;
    for (let i = 0; i < b.nRanges; i++)
        t += b.ranges[i].place;
    return t;
};
export function bidMoneyOf(b: Book): bigint {
    const s = bidMoneySum(b);
    if (s > U128_MAX)
        throw new RangeError("bid money past u128");
    return s;
}
export function vaultV2(b: Book): bigint {
    const s = fOwn(b) + placeMoney(b);
    if (s > U128_MAX)
        throw new RangeError("bid money past u128");
    return s;
}
export function sqrtT0(b: Book): Sqrt {
    for (let i = b.nRanges - 1; i >= 0; i--)
        if (b.ranges[i].kind === KIND_TAIL)
            return b.ranges[i].sqrtA;
    return SQRT_TAIL_END;
}
export function tokensHeld(b: Book): bigint {
    let t = b.floorTokens;
    for (let i = 0; i < b.nBands; i++)
        t += b.bandTokens[i];
    for (let i = 0; i < b.nRanges; i++)
        t += rangeHeld(b.ranges[i]);
    return t;
}
export function forSale(b: Book): bigint {
    let t = 0n;
    for (let i = 0; i < b.nRanges; i++)
        t += b.ranges[i].askLeft;
    return u64(t);
}
export function boughtBack(b: Book): bigint {
    let t = b.floorTokens;
    for (let i = 0; i < b.nRanges; i++)
        t += b.ranges[i].back;
    for (let i = 0; i < b.nBands; i++)
        t += b.bandTokens[i];
    return u64(t);
}
export function checkBook(b: Book): void {
    const n = b.nRanges;
    if (n === 0 || n > RANGES_MAX || b.nBands > BIDS_MAX || b.nC > b.nBands)
        fail("BookEmpty");
    if (b.sqrtP === 0n || b.sqrtP > SQRT_TAIL_END)
        fail("SqrtRange");
    for (let i = 0; i < n; i++) {
        const r = b.ranges[i];
        if (r.sqrtA === 0n || r.sqrtA > r.sqrtB || (i > 0 && b.ranges[i - 1].sqrtB !== r.sqrtA))
            fail("SqrtRange");
        if (r.askLeft + r.back > U64_MAX)
            fail("Overflow");
        if (r.kind !== KIND_BONDING && (r.place !== 0n || r.back !== 0n))
            fail("Overflow");
        if (r.kind === KIND_BONDING && i !== 0)
            fail("SqrtRange");
    }
    if (b.ranges[n - 1].sqrtB !== SQRT_TAIL_END || rangeIsFlat(b.ranges[n - 1]))
        fail("SqrtRange");
    const nb = b.nBands;
    if (nb > 0) {
        if (b.bandEdge[0] > b.sqrtLMax || b.bandEdge[nb] < b.sqrtF)
            fail("SqrtRange");
        for (let i = 0; i < nb; i++) {
            if (b.bandEdge[i + 1] > b.bandEdge[i])
                fail("SqrtRange");
            if (b.bandF[i] > b.bandMoney[i])
                fail("Overflow");
        }
    }
    if (b.ckAtF > b.floor || b.ckFloorTokens > b.floorTokens)
        fail("Overflow");
}
function flatUp(b: Book): FlatPart | null {
    const p = b.sqrtP;
    if (b.sqrtF !== 0n && b.sqrtF === p && b.floorTokens > 0n)
        return { t: "floor" };
    for (let i = 0; i < b.nRanges; i++) {
        const r = b.ranges[i];
        if (rangeIsFlat(r) && r.sqrtA === p && rangeHeld(r) > 0n)
            return { t: "range", i };
    }
    return null;
}
function flatDown(b: Book): FlatPart | null {
    const p = b.sqrtP;
    for (let i = b.nRanges - 1; i >= 0; i--)
        if (b.ranges[i].sqrtA === p && flatBids(b, i))
            return { t: "range", i };
    if (b.sqrtF === p && floorBids(b))
        return { t: "floor" };
    return null;
}
function cpPieceUp(b: Book): Part | null {
    const p = b.sqrtP;
    for (const pc of pieces(b)) {
        const [lo, hi] = cpEdges(b, pc);
        if (!isFlat(b, pc) && lo < hi && lo <= p && p < hi && tokensOf(b, pc) > 0n)
            return pc;
    }
    return null;
}
function bandDown(b: Book): number | null {
    const p = b.sqrtP;
    for (let j = 0; j < b.nBands; j++) {
        const [lo, hi] = [b.bandEdge[j + 1], b.bandEdge[j]];
        if (lo < hi && lo < p && p <= hi && b.bandMoney[j] > 0n)
            return j;
    }
    return null;
}
function nextUp(b: Book): Sqrt | null {
    let best: Sqrt | null = null;
    for (const pc of pieces(b)) {
        if (tokensOf(b, pc) === 0n)
            continue;
        let s: Sqrt;
        if (isFlat(b, pc))
            s = flatS(b, pc);
        else {
            const [lo, hi] = cpEdges(b, pc);
            if (!(lo < hi))
                continue;
            s = lo;
        }
        if (s > b.sqrtP && (best === null || s < best))
            best = s;
    }
    return best;
}
function nextDown(b: Book): Sqrt | null {
    let best: Sqrt | null = null;
    for (const pc of pieces(b)) {
        let s: Sqrt;
        if (pc.t === "range" && rangeIsFlat(b.ranges[pc.i])) {
            if (!flatBids(b, pc.i))
                continue;
            s = b.ranges[pc.i].sqrtA;
        }
        else if (pc.t === "floor") {
            if (!floorBids(b))
                continue;
            s = b.sqrtF;
        }
        else if (pc.t === "band") {
            const [lo, hi] = cpEdges(b, pc);
            if (!(lo < hi && b.bandMoney[pc.i] > 0n))
                continue;
            s = hi;
        }
        else
            continue;
        if (s < b.sqrtP && (best === null || s > best))
            best = s;
    }
    return best;
}
const lUp = (b: Book, pc: Part, hi: Sqrt): bigint => (pc.t === "range" ? ov(rangeLiquidity(b.ranges[pc.i])) : ov(liquidityForTokens(b.sqrtP, hi, tokensOf(b, pc))));
function graduate(b: Book): void {
    const r = b.ranges[0];
    b.floor = u128(b.floor + r.place);
    r.place = 0n;
    b.sqrtF = r.sqrtA;
    b.sqrtLMax = max(b.sqrtLMax, r.sqrtA);
    b.graduated = true;
}
function floorRebuy(b: Book, take: bigint, cost: bigint): void {
    const [x0, xe] = [b.floorTokens, b.ckFloorTokens];
    if (xe > 0n) {
        const back = (cost * xe) / x0;
        const gone = min((take * xe + x0 - 1n) / x0, xe);
        b.ckAtF = u128(b.ckAtF + back);
        b.ckFloorTokens -= gone;
    }
    b.floorTokens -= take;
    b.floor = u128(b.floor + cost);
}
function bandRebuy(b: Book, j: number, dt: bigint, q: bigint): void {
    const claim = b.bandFClaim[j];
    const t0 = b.bandTokens[j];
    const r = min(min((claim * dt + t0 - 1n) / t0, claim), q);
    b.bandTokens[j] -= dt;
    b.bandMoney[j] = u128(b.bandMoney[j] + q);
    b.bandF[j] += r;
    b.bandFClaim[j] -= r;
}
function rangeUp(b: Book, i: number, l: bigint, hi: Sqrt, st: {
    rem: bigint;
}, w: WalkUp, acc: FeeAcc, u: Undo): boolean {
    const p = b.sqrtP;
    const [dt, q, p2] = cpUp(l, p, hi, st.rem, b.ranges[i].askLeft, false);
    if (dt === 0n)
        return false;
    b.ranges[i].askLeft -= dt;
    b.sqrtP = p2;
    b.sqrtLMax = max(b.sqrtLMax, p2);
    u.buyFirst(i, p, p2, q, dt);
    st.rem -= q;
    w.money += q;
    w.tokens += dt;
    w.fromFirst += dt;
    charge(b, acc, q);
    return true;
}
export function nextAskSqrt(b: Book): Sqrt | null {
    const c: Book = { ...b };
    for (let i = 0; i <= 2 * (RANGES_MAX + BIDS_MAX + 2); i++) {
        if (flatUp(c))
            return c.sqrtP;
        const pc = cpPieceUp(c);
        if (pc) {
            const [, hi] = cpEdges(c, pc);
            const l = pc.t === "range" ? rangeLiquidity(c.ranges[pc.i]) : liquidityForTokens(c.sqrtP, hi, tokensOf(c, pc));
            const t = l === null ? null : tokensBetween(l, c.sqrtP, hi, DOWN);
            if (t !== 0n)
                return c.sqrtP;
            c.sqrtP = hi;
            continue;
        }
        const s = nextUp(c);
        if (s === null)
            return null;
        c.sqrtP = s;
    }
    return null;
}
export function nextBidSqrt(b: Book): Sqrt | null {
    const c: Book = { ...b };
    for (let i = 0; i <= 2 * (RANGES_MAX + BIDS_MAX + 2); i++) {
        if (flatDown(c))
            return c.sqrtP;
        const j = bandDown(c);
        if (j !== null) {
            const lo = c.bandEdge[j + 1];
            const l = liquidityForMoney(lo, c.sqrtP, c.bandMoney[j]);
            const q = l === null ? null : moneyBetween(l, lo, c.sqrtP, DOWN);
            if (q !== 0n)
                return c.sqrtP;
        }
        const s = nextDown(c);
        if (s === null)
            return null;
        c.sqrtP = s;
    }
    return null;
}
export function walkUp(b: Book, budget: bigint): WalkUp {
    return walkUpFrom(b, budget, { money: 0n, tokens: 0n, fromResale: 0n, fromFirst: 0n, steps: 0, budgetHit: false, graduatedNow: false }, new FeeAcc(feesNow(b)));
}
export function walkUpFrom(b: Book, budget: bigint, w0: WalkUp, acc: FeeAcc, maxSteps: number = MAX_WALK_STEPS, u: Undo = new Undo()): WalkUp {
    const st = { rem: budget };
    const w: WalkUp = { ...w0, budgetHit: false };
    while (st.rem > 0n) {
        if (w.steps >= Math.min(maxSteps, MAX_WALK_STEPS)) {
            w.budgetHit = true;
            break;
        }
        w.steps++;
        const fp = flatUp(b);
        if (fp) {
            const s = flatS(b, fp);
            const can = ov(flatTokensForMoney(s, st.rem, DOWN));
            const take = min(can, tokensOf(b, fp));
            if (take === 0n)
                break;
            const cost = ov(flatMoneyForTokens(s, take, UP));
            st.rem -= cost;
            w.money += cost;
            w.tokens += take;
            charge(b, acc, cost);
            if (fp.t === "floor") {
                floorRebuy(b, take, cost);
                w.fromResale += take;
            }
            else {
                u.touch(fp.i);
                const r = b.ranges[fp.i];
                const bonding = r.kind === KIND_BONDING;
                const tb = min(take, r.back);
                r.back -= tb;
                r.askLeft -= take - tb;
                w.fromResale += tb;
                w.fromFirst += take - tb;
                if (bonding) {
                    r.place = u128(r.place + cost);
                    if (rangeHeld(r) === 0n && !b.graduated) {
                        graduate(b);
                        w.graduatedNow = true;
                    }
                }
                else {
                    b.sqrtLMax = max(b.sqrtLMax, s);
                    u.buyFirst(fp.i, s, s, cost, take);
                }
            }
            if (tokensOf(b, fp) > 0n)
                break;
            continue;
        }
        const pc = cpPieceUp(b);
        if (pc) {
            const [, hi] = cpEdges(b, pc);
            const l = lUp(b, pc, hi);
            const p = b.sqrtP;
            let moved: boolean;
            if (pc.t === "range") {
                u.touch(pc.i);
                moved = rangeUp(b, pc.i, l, hi, st, w, acc, u);
            }
            else if (pc.t === "band") {
                const [dt, q, p2] = cpUp(l, p, hi, st.rem, b.bandTokens[pc.i], true);
                if (dt > 0n) {
                    bandRebuy(b, pc.i, dt, q);
                    b.sqrtP = p2;
                    st.rem -= q;
                    w.money += q;
                    w.tokens += dt;
                    w.fromResale += dt;
                    charge(b, acc, q);
                }
                moved = dt > 0n;
            }
            else
                throw new Error("unreachable");
            if (b.sqrtP === hi)
                continue;
            if (!moved && st.rem > 0n && ov(tokensBetween(l, b.sqrtP, hi, DOWN)) === 0n) {
                if (pc.t === "range") {
                    const q = ov(moneyBetween(l, b.sqrtP, hi, UP));
                    if (q > st.rem)
                        break;
                    u.buyFirst(pc.i, b.sqrtP, hi, q, 0n);
                    st.rem -= q;
                    w.money += q;
                    charge(b, acc, q);
                    b.sqrtLMax = max(b.sqrtLMax, hi);
                }
                b.sqrtP = hi;
                continue;
            }
            if (!moved || st.rem === 0n || tokensOf(b, pc) > 0n)
                break;
            continue;
        }
        const s = nextUp(b);
        if (s === null)
            break;
        b.sqrtP = s;
    }
    w.tokens = u64(w.tokens);
    return w;
}
export function walkDown(b: Book, tokens: bigint): WalkDown {
    return walkDownAcc(b, tokens, new FeeAcc(feesNow(b)));
}
export function walkDownAcc(b: Book, tokens: bigint, acc: FeeAcc, u: Undo = new Undo()): WalkDown {
    let rem = tokens;
    const w: WalkDown = { tokens: 0n, money: 0n, fromF: 0n, fromK: 0n, fromC: 0n, steps: 0, budgetHit: false };
    while (rem > 0n) {
        if (w.steps === MAX_WALK_STEPS) {
            w.budgetHit = true;
            break;
        }
        w.steps++;
        const fp = flatDown(b);
        if (fp) {
            const s = flatS(b, fp);
            const money = moneyOf(b, fp);
            const can = ov(flatTokensForMoney(s, money, DOWN));
            const take = min(can, rem);
            const q = take === 0n ? 0n : min(ov(flatMoneyForTokens(s, take, DOWN)), money);
            if (q === 0n)
                break;
            rem -= take;
            w.tokens += take;
            w.money += q;
            charge(b, acc, q);
            if (fp.t === "floor") {
                const ce = min(q, b.ckAtF);
                if (ce > 0n) {
                    const xe = min(ov(flatTokensForMoney(s, ce, DOWN)), take);
                    b.ckAtF -= ce;
                    b.ckFloorTokens = u64(b.ckFloorTokens + xe);
                }
                b.floor -= q;
                b.floorTokens = u64(b.floorTokens + take);
                w.fromF += q;
            }
            else {
                u.touch(fp.i);
                const r = b.ranges[fp.i];
                r.place -= q;
                r.back = u64(r.back + take);
            }
            continue;
        }
        const j = bandDown(b);
        if (j !== null) {
            const lo = b.bandEdge[j + 1];
            const l = ov(liquidityForMoney(lo, b.sqrtP, b.bandMoney[j]));
            const [dx, q0, p2] = cpDown(l, lo, b.sqrtP, rem, b.bandMoney[j]);
            let q = q0;
            if (dx === 0n) {
                if (ov(moneyBetween(l, lo, b.sqrtP, DOWN)) === 0n) {
                    const s = nextDown(b);
                    if (s === null)
                        break;
                    b.sqrtP = s;
                    continue;
                }
                break;
            }
            const dF = min(min(ov(flatMoneyForTokens(b.sqrtF, dx, DOWN)), b.bandF[j]), q);
            q = min(q, b.bandMoney[j] - b.bandF[j] + dF);
            b.bandF[j] -= dF;
            b.bandFClaim[j] = u128(b.bandFClaim[j] + dF);
            b.bandMoney[j] -= q;
            b.bandTokens[j] = u64(b.bandTokens[j] + dx);
            if (j < b.nC)
                w.fromC += q;
            else
                w.fromK += q;
            b.sqrtP = p2;
            rem -= dx;
            w.tokens += dx;
            w.money += q;
            charge(b, acc, q);
            if (p2 === lo && b.bandMoney[j] > 0n) {
                b.floor = u128(b.floor + b.bandMoney[j]);
                b.ckAtF = u128(b.ckAtF + b.bandMoney[j] - b.bandF[j]);
                b.bandMoney[j] = 0n;
                b.bandF[j] = 0n;
            }
            if (p2 === lo || b.bandMoney[j] === 0n) {
                if (p2 !== lo) {
                    const s = nextDown(b);
                    if (s === null)
                        break;
                    b.sqrtP = s;
                }
                continue;
            }
            break;
        }
        const s = nextDown(b);
        if (s === null)
            break;
        b.sqrtP = s;
    }
    return w;
}
