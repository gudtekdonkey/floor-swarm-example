import { v2Fail } from "./error.ts";
import { pow } from "./pow.ts";
import { build } from "./ask.ts";
import { DEFAULT_FEE_PPM } from "./fees.ts";
import { BPS } from "../index.ts";
export const MAX_STACKS = 9;
export const MAX_BANDS = 4;
export { BPS } from "../index.ts";
export const CLASS_TEAM = 0;
export const CLASS_HOLDER = 1;
export type MilestoneClass = 0 | 1;
export interface StackRow {
    level: bigint;
    milestone: bigint;
    spreadBps: number | null;
}
export interface Row {
    id: number;
    name: string;
    phiBps: number;
    wBps: number;
    bands: number[];
    thetaBps: number;
    depthX100: number;
    climbStepX100: number;
    spreadBps: number;
    tailBps: number;
    psiTBps: number;
    bondingRaise: bigint;
    launchCap: bigint;
    stacks: StackRow[];
    class: MilestoneClass;
    platformMsBps: number;
    floorMsBps: number;
    teamBuyBps: number;
    teamSlotMaxBps: number;
    ckBps: number;
    feeCurve: FeeCurveRow | null;
}
export interface FeeCurveRow {
    startPpm: number[];
    endPpm: number[];
    fromUsd: bigint;
    toUsd: bigint;
}
export const FEE_FROM_GRAD = 0n;
export const FEE_TO_TAIL = 0n;
export const FEE_REL_ONE = 1n << 32n;
export function feeCurve(startPpm: readonly number[], endPpm: readonly number[]): FeeCurveRow {
    return { startPpm: [...startPpm], endPpm: [...endPpm], fromUsd: FEE_FROM_GRAD, toUsd: FEE_TO_TAIL };
}
const WAGMI_FEES = [[10000, 0, 2000, 500, 1000], [2000, 0, 500, 100, 1000]] as const;
const HODL_FEES = [[2000, 0, 2000, 500, 9000], [1000, 0, 500, 100, 2000]] as const;
const WAGMI_GENESIS_FEES = [[6000, 0, 2000, 500, 0], [6000, 0, 500, 100, 0]] as const;
const MOONSHOT_FEES = [[2000, 9000, 2000, 500, 0], [1000, 2000, 500, 100, 0]] as const;
const FLOOR_GENESIS_FEES = [[3000, 0, 2000, 0, 0], [2000, 0, 500, 0, 0]] as const;
export function feeKnotRel(usd: bigint, launchCap: bigint): bigint {
    const x = Math.sqrt(Number(usd) / Number(launchCap)) * Number(FEE_REL_ONE);
    if (!Number.isFinite(x) || x < 1 || x >= 2 ** 64)
        v2Fail("RowInvalid");
    return f64ToU128(x);
}
export function rowFeeFields(r: Row): {
    feePpm: number[];
    feeStartPpm: number[];
    feeARel: bigint;
    feeBRel: bigint;
} {
    if (!r.feeCurve)
        return { feePpm: [...DEFAULT_FEE_PPM], feeStartPpm: [0, 0, 0, 0, 0], feeARel: 0n, feeBRel: 0n };
    const c = r.feeCurve;
    const from = c.fromUsd === FEE_FROM_GRAD ? r.launchCap : c.fromUsd;
    const to = c.toUsd === FEE_TO_TAIL ? BigInt(Math.round(build(r).tailStart)) : c.toUsd;
    return { feePpm: [...c.endPpm], feeStartPpm: [...c.startPpm], feeARel: feeKnotRel(from, r.launchCap), feeBRel: feeKnotRel(to, r.launchCap) };
}
export function cloneRow(r: Row): Row {
    return {
        ...r,
        bands: [...r.bands],
        ckBps: r.ckBps,
        feeCurve: r.feeCurve ? { ...r.feeCurve, startPpm: [...r.feeCurve.startPpm], endPpm: [...r.feeCurve.endPpm] } : null,
        stacks: r.stacks.map((s) => ({ ...s })),
    };
}
export const rowWcBps = (r: Row): number => r.bands.reduce((a, b) => a + b, 0);
export const rowDepth = (r: Row): number => r.depthX100 / 100;
export const rowTeamBuyBounds = (r: Row): [
    bigint,
    bigint
] => [0n, (r.bondingRaise * BigInt(r.teamBuyBps)) / BPS];
export function rowValidate(r: Row): void {
    const bad = r.id === 0
        || r.id === 2
        || r.phiBps === 0
        || r.phiBps >= 10000
        || r.wBps >= 10000
        || r.thetaBps > 10000
        || r.tailBps >= 10000
        || r.psiTBps === 0
        || r.psiTBps > 10000
        || r.depthX100 < 100
        || r.climbStepX100 <= 100
        || r.spreadBps > 10000
        || r.bands.length === 0
        || r.bands.length > MAX_BANDS
        || rowWcBps(r) >= 10000
        || r.stacks.length === 0
        || r.stacks.length > MAX_STACKS
        || r.bondingRaise === 0n
        || r.launchCap <= r.bondingRaise
        || r.platformMsBps + r.floorMsBps > 10000
        || r.teamBuyBps > 10000
        || r.teamSlotMaxBps > 9500
        || r.stacks.some((s) => s.level === 0n || (s.spreadBps !== null && s.spreadBps > 10000))
        || r.stacks.some((s, i) => i > 0 && s.level <= r.stacks[i - 1]!.level);
    if (bad)
        v2Fail("RowInvalid");
}
export const DEPTH_X100 = 101;
export const STEP_PHI10_X100 = 150;
export const STEP_PHI50_X100 = 120;
export function r1DepthX100(phiBps: number, stepX100: number): number | null {
    const phi = phiBps / 10000;
    const r = stepX100 / 100;
    const u = Math.sqrt(r);
    if (phi * u >= 1)
        return null;
    const need = (phi * (r - 1)) / (u * (1 - phi * u));
    for (let d = 100; d <= 400; d++) {
        if (pow(r, d / 100 / (1 / phi - 1)) - 1 >= need)
            return d;
    }
    return null;
}
const st = (level: bigint, milestone: bigint): StackRow => ({ level, milestone, spreadBps: null });
function base(id: number, name: string): Row {
    return {
        id,
        name,
        phiBps: 1000,
        wBps: 2500,
        bands: [300],
        thetaBps: 0,
        depthX100: DEPTH_X100,
        climbStepX100: STEP_PHI10_X100,
        spreadBps: 0,
        tailBps: 4000,
        psiTBps: 8000,
        bondingRaise: 0n,
        launchCap: 0n,
        stacks: [],
        class: CLASS_TEAM,
        platformMsBps: 0,
        floorMsBps: 0,
        teamBuyBps: 10000,
        teamSlotMaxBps: 0,
        ckBps: 0,
        feeCurve: null,
    };
}
export const CK_TARGET_CIRC_BPS = 500;
export const CK_TARGET_DEFAULT = CK_TARGET_CIRC_BPS;
export const MOONSHOT_CK_TARGET = 700;
export function withCkTarget(row: Row, ckBps: number): Row {
    return { ...cloneRow(row), ckBps };
}
export function moonshot(): Row {
    return {
        ...base(3, "moonshot-10"),
        thetaBps: 1000,
        spreadBps: 10000,
        bondingRaise: 2000n,
        launchCap: 100000n,
        tailBps: 200,
        stacks: [
            st(250000n, 12000n),
            st(450000n, 20000n),
            st(500000n, 60000n),
            st(1000000n, 150000n),
            st(2500000n, 250000n),
            st(5000000n, 700000n),
            st(9000000n, 1500000n),
            { level: 75000000n, milestone: 1280000n, spreadBps: 144 },
        ],
        platformMsBps: 1000,
        floorMsBps: 1000,
        teamSlotMaxBps: 6000,
        ckBps: MOONSHOT_CK_TARGET,
        feeCurve: feeCurve(...MOONSHOT_FEES),
    };
}
export const WAGMI_SPEC_MILESTONES: readonly bigint[] = [11550000n];
export const WAGMI_END_USD = 177730000n;
export const WAGMI_THETA_OPTIONS: readonly (readonly [
    number,
    bigint
])[] = [
    [250, 1000000n],
    [100, 1000000n],
    [50, 1000000n],
    [0, 1000000n],
];
export const WAGMI_THETA_BPS = 250;
export function wagmiMsScalePpm(thetaBps: number): bigint | null {
    const o = WAGMI_THETA_OPTIONS.find(([t]) => t === thetaBps);
    return o ? o[1] : null;
}
export const WAGMI_MS_SCALE_PPM: bigint = wagmiMsScalePpm(WAGMI_THETA_BPS)!;
export const STEP_WAGMI_X100 = 109;
function wagmiBase(): Row {
    return {
        ...base(1, "wagmi-75"),
        phiBps: 7500,
        wBps: 2000,
        climbStepX100: STEP_WAGMI_X100,
        tailBps: 1000,
        bondingRaise: 1000n,
        launchCap: 10000000n,
        stacks: [st(WAGMI_END_USD, WAGMI_SPEC_MILESTONES[0])],
        spreadBps: 144,
        class: CLASS_HOLDER,
        platformMsBps: 5000,
        floorMsBps: 5000,
        ckBps: CK_TARGET_DEFAULT,
        feeCurve: feeCurve(...WAGMI_FEES),
    };
}
export function wagmiAt(thetaBps: number): Row | null {
    const k = wagmiMsScalePpm(thetaBps);
    if (k === null)
        return null;
    const r = wagmiBase();
    r.thetaBps = thetaBps;
    r.stacks = r.stacks.map((s, i) => ({ ...s, milestone: (WAGMI_SPEC_MILESTONES[i] * k) / 1000000n }));
    return r;
}
export function wagmi(): Row {
    return wagmiAt(WAGMI_THETA_BPS)!;
}
export const FLOOR_GENESIS_PHI_BPS = 5000;
export function floorGenesis(): Row {
    const phiBps = FLOOR_GENESIS_PHI_BPS;
    return {
        ...moonshot(),
        id: 4,
        name: "floor-genesis",
        ckBps: CK_TARGET_DEFAULT,
        phiBps,
        climbStepX100: STEP_PHI50_X100,
        depthX100: Math.max(r1DepthX100(phiBps, STEP_PHI50_X100) ?? 400, DEPTH_X100),
        bondingRaise: 2000n,
        launchCap: 5000000n,
        teamBuyBps: 0,
        teamSlotMaxBps: 0,
        feeCurve: feeCurve(...FLOOR_GENESIS_FEES),
        stacks: [
            { level: 20000000n, milestone: 125000n, spreadBps: 1000 },
            { level: 90000000n, milestone: 1125000n, spreadBps: 1000 },
            { level: 500000000n, milestone: 102400000n, spreadBps: 1000 },
        ],
    };
}
export function hodl(): Row {
    return {
        ...moonshot(),
        id: 6,
        name: "hodl",
        ckBps: CK_TARGET_DEFAULT,
        phiBps: 3000,
        climbStepX100: STEP_PHI50_X100,
        depthX100: 125,
        launchCap: 2000000n,
        bondingRaise: 12600n,
        class: CLASS_HOLDER,
        teamSlotMaxBps: 0,
        feeCurve: feeCurve(...HODL_FEES),
        stacks: [
            { level: 50000000n, milestone: 1000000n, spreadBps: 144 },
            { level: 100000000n, milestone: 2000000n, spreadBps: 144 },
            { level: 250000000n, milestone: 5000000n, spreadBps: 144 },
            { level: 500000000n, milestone: 198961000n, spreadBps: 144 },
        ],
    };
}
export function floorGenesisPhiStudy(phiBps: number): Row {
    return {
        ...base(4, "floor-genesis"),
        phiBps,
        climbStepX100: phiBps <= 1000 ? STEP_PHI10_X100 : STEP_PHI50_X100,
        depthX100: Math.max(r1DepthX100(phiBps, phiBps <= 1000 ? STEP_PHI10_X100 : STEP_PHI50_X100) ?? 400, DEPTH_X100),
        bondingRaise: 20000n,
        launchCap: 800000n,
        stacks: [
            st(1000000n, 10000n),
            st(5000000n, 50000n),
            st(10000000n, 100000n),
            st(50000000n, 500000n),
            st(100000000n, 1000000n),
            st(1000000000n, 10000000n),
        ],
        teamBuyBps: 0,
        teamSlotMaxBps: 0,
        ckBps: CK_TARGET_DEFAULT,
    };
}
export function f64ToU128(x: number): bigint {
    if (!(x > 0))
        return 0n;
    if (x >= 2 ** 128)
        return (1n << 128n) - 1n;
    return BigInt(Math.trunc(x));
}
export const WAGMI_GENESIS_CAP_USD = 75530000n;
export const WAGMI_GENESIS_KEEP_USD = 1711410n;
export const WAGMI_GENESIS_UNUSED_MAX = 0.0001;
export function wagmiGenesisAt(raise: bigint, target: bigint): Row {
    const w = wagmi();
    return {
        ...w,
        id: 5,
        name: "wagmi-genesis",
        launchCap: WAGMI_GENESIS_CAP_USD,
        bondingRaise: raise,
        teamBuyBps: 0,
        teamSlotMaxBps: 0,
        feeCurve: feeCurve(...WAGMI_GENESIS_FEES),
        stacks: w.stacks.map((s, i) => (i === 0 ? { ...s, milestone: target } : s)),
    };
}
export function wagmiGenesisTarget(raise: bigint): bigint {
    const unused = (t: bigint) => {
        try {
            const a = build(wagmiGenesisAt(raise, t));
            return a;
        }
        catch {
            return undefined;
        }
    };
    const a0 = unused(0n);
    if (!a0 || !(a0.supplyExcess <= 0) || a0.stacks[0].skipped)
        return 0n;
    let lo = 0n;
    let hi = 1000000000n;
    while (hi - lo > 1n) {
        const m = (lo + hi) / 2n;
        const a = unused(m);
        if (a && a.unusedShare > WAGMI_GENESIS_UNUSED_MAX)
            lo = m;
        else
            hi = m;
    }
    return (lo / 1000n) * 1000n;
}
export function wagmiGenesis(overflow: bigint): Row {
    const raise = overflow < WAGMI_GENESIS_KEEP_USD ? overflow : WAGMI_GENESIS_KEEP_USD;
    return wagmiGenesisAt(raise, wagmiGenesisTarget(raise));
}
