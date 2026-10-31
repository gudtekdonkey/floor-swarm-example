import { rowDepth, rowValidate } from "./rows.ts";
import type { Row } from "./rows.ts";
import { v2Fail } from "./error.ts";
import { pow } from "./pow.ts";
export type Kind = "Bonding" | "Climb" | "Sale" | "Unused" | "Tail";
export interface AskSeg {
    kind: Kind;
    stack: number;
    tokens: number;
    a: number;
    b: number;
    money: number;
    toFloor: number;
    toCk: number;
    toMs: number;
}
export interface StackReport {
    level: number;
    top: number;
    supplyAfter: number;
    milestone: number;
    milestoneRunning: number;
    moneyIn: number;
    toFloor: number;
    skipped: boolean;
    short: number;
}
export interface Ask {
    segs: AskSeg[];
    stacks: StackReport[];
    bondingTokens: number;
    supplyAfterStacks: number;
    supplyExcess: number;
    milestonesStacks: number;
    unusedShare: number;
    unusedMilestone: number;
    unusedFloor: number;
    ckAtTail: number;
    floorAtTail: number;
    fEnd: number;
    tailStart: number;
    tailTokens: number;
    floorBreak: number | null;
    contiguous: boolean;
}
export const milestonesTotal = (a: Ask): number => a.milestonesStacks + a.unusedMilestone;
export const SALE_STEP = 2;
function pieces(a: number, b: number, step: number): number {
    if (b <= a)
        return 1;
    return Math.trunc(fmax(Math.ceil(Math.log(b / a) / Math.log(step) - 1e-9), 1));
}
export const tailCap = (t0: number, q: number): number => t0 / ((1 - q) * (1 - q));
export const rangeTokens = (money: number, a: number, b: number): number => money / Math.sqrt(a * b);
interface St {
    s: number;
    fMoney: number;
    f: number;
    p: number;
    ck: number;
    m: number;
}
const fmax = (a: number, b: number): number => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : a >= b ? a : b);
const fmin = (a: number, b: number): number => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : a <= b ? a : b);
export function build(row: Row): Ask {
    rowValidate(row);
    const phi = row.phiBps / 10000;
    const theta = row.thetaBps / 10000;
    const es = 1 / phi - 1;
    const eps = es / rowDepth(row);
    const cap = Number(row.launchCap);
    const raise = Number(row.bondingRaise);
    const st: St = { s: raise / cap, fMoney: raise, f: cap, p: cap, ck: 0, m: 0 };
    const ask: Ask = {
        segs: [],
        stacks: [],
        bondingTokens: 0,
        supplyAfterStacks: 0,
        supplyExcess: 0,
        milestonesStacks: 0,
        unusedShare: 0,
        unusedMilestone: 0,
        unusedFloor: 0,
        ckAtTail: 0,
        floorAtTail: 0,
        fEnd: 0,
        tailStart: 0,
        tailTokens: 0,
        floorBreak: null,
        contiguous: true,
    };
    ask.bondingTokens = st.s;
    ask.segs.push({ kind: "Bonding", stack: 255, tokens: st.s, a: cap, b: cap, money: raise, toFloor: raise, toCk: 0, toMs: 0 });
    const climb = (lvl: number, stack: number, kind: Kind): void => {
        if (lvl <= st.p)
            return;
        const p0 = st.p;
        const k = pieces(st.p, lvl, row.climbStepX100 / 100);
        for (let j = 1; j <= k; j++) {
            const to = j === k ? lvl : p0 * pow(lvl / p0, j / k);
            const se = st.s * pow(to / st.p, 1 / eps);
            const q = (se - st.s) * Math.sqrt(st.p * to);
            const ft = fmax(st.f, phi * to);
            const df = fmin(q, fmax(ft * se - st.fMoney, 0));
            push(st, ask, kind, stack, se - st.s, st.p, to, q, df, q - df, 0, phi);
        }
    };
    const n = row.stacks.length;
    let running = 0;
    for (let i = 0; i < n; i++) {
        const sr = row.stacks[i]!;
        const lvl = Number(sr.level);
        if (lvl < st.p) {
            ask.stacks.push({ level: lvl, top: lvl, supplyAfter: st.s, milestone: 0, milestoneRunning: running, moneyIn: 0, toFloor: 0, skipped: true, short: Number(sr.milestone) });
            continue;
        }
        const money0 = sumMoney(ask);
        const floor0 = st.fMoney;
        climb(lvl, i, "Climb");
        const spread = (sr.spreadBps ?? row.spreadBps) / 10000;
        const top = i + 1 < n ? lvl * pow(Number(row.stacks[i + 1]!.level) / lvl, spread) : lvl * pow(2, spread);
        const a = st.p;
        const b = top;
        const tgt = Number(sr.milestone);
        const k = pieces(a, b, SALE_STEP);
        let qsum = 0;
        for (let j = 1; j <= k; j++)
            qsum += a * pow(b / a, (2 * j - 1) / (2 * k));
        const qbar = qsum / k;
        const ft = fmax(st.f, phi * b);
        const den = qbar - ft;
        const need = ft * st.s - st.fMoney;
        let xt: number;
        if (tgt > 0) {
            if (theta >= 1 || den <= 0)
                v2Fail("TargetUnreachable", i);
            xt = (tgt / (1 - theta) + need) / den;
        }
        else if (need <= 0) {
            xt = 0;
        }
        else if (den > 0) {
            xt = need / den;
        }
        else {
            v2Fail("TargetUnreachable", i);
        }
        const xmin = st.s * (pow(b / a, 1 / es) - 1);
        const x = fmax(fmax(xt, xmin), 0);
        let m = 0;
        for (let j = 1; j <= k; j++) {
            const pa = st.p;
            const pb = j === k ? b : a * pow(b / a, j / k);
            const xj = x / k;
            const qj = xj * Math.sqrt(pa * pb);
            const ftj = fmax(st.f, phi * pb);
            const dfj = fmin(qj, fmax(ftj * (st.s + xj) - st.fMoney, 0));
            const rj = qj - dfj;
            const mj = fmin(fmax(tgt - m, 0), (1 - theta) * rj);
            m += mj;
            push(st, ask, "Sale", i, xj, pa, pb, qj, dfj, rj - mj, mj, phi);
        }
        running += m;
        const money1 = sumMoney(ask);
        ask.stacks.push({ level: lvl, top, supplyAfter: st.s, milestone: m, milestoneRunning: running, moneyIn: money1 - money0, toFloor: st.fMoney - floor0, skipped: false, short: fmax(tgt - m, 0) });
    }
    ask.milestonesStacks = running;
    ask.supplyAfterStacks = st.s;
    const tail = row.tailBps / 10000;
    let u = 1 - tail - st.s;
    ask.supplyExcess = fmax(-u, 0);
    const t0 = st.p;
    ask.tailStart = t0;
    u = fmax(u, 0);
    ask.tailTokens = tail;
    if (u > 0) {
        const q = u * t0;
        const ft = fmax(st.f, phi * t0);
        const df = fmin(q, fmax(ft * (st.s + u) - st.fMoney, 0));
        ask.unusedShare = u;
        ask.unusedFloor = df;
        ask.unusedMilestone = q - df;
        push(st, ask, "Unused", 255, u, t0, t0, q, df, 0, q - df, phi);
    }
    ask.ckAtTail = st.ck;
    ask.floorAtTail = st.fMoney;
    ask.fEnd = st.f;
    ask.segs.push({ kind: "Tail", stack: 255, tokens: ask.tailTokens, a: t0, b: Infinity, money: 0, toFloor: 0, toCk: 0, toMs: 0 });
    let prevB = cap;
    for (const g of ask.segs.slice(1)) {
        if (Math.abs(g.a - prevB) > 1e-9 * fmax(prevB, 1))
            ask.contiguous = false;
        prevB = g.b;
    }
    return ask;
}
const sumMoney = (ask: Ask): number => ask.segs.reduce((a, g) => a + g.money, 0);
function push(st: St, ask: Ask, kind: Kind, stack: number, x: number, a: number, b: number, q: number, df: number, toCk: number, toMs: number, phi: number): void {
    st.s += x;
    st.fMoney += df;
    st.f = fmax(st.f, st.fMoney / st.s);
    st.ck += toCk;
    st.m += toMs;
    st.p = b;
    if (ask.floorBreak === null && st.fMoney / st.s < phi * b * (1 - 1e-9) && st.f < phi * b * (1 - 1e-9)) {
        ask.floorBreak = ask.segs.length;
    }
    ask.segs.push({ kind, stack, tokens: x, a, b, money: q, toFloor: df, toCk, toMs });
}
