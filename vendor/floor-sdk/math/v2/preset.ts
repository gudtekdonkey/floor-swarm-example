import { AccountDecodeError } from "../../solana/floor/accounts.ts";
import { MAX_BANDS } from "./rows.ts";
import { RANGES_MAX } from "./book.ts";
export const ROW_GLOBALS = 112;
export const RANGE_ROW = 48;
export { RANGES_MAX };
export const ROW_LEN = ROW_GLOBALS + RANGES_MAX * RANGE_ROW;
export const ROW_VERSION = 2;
export const MS_CAP_OFF = 42;
export const RANGE_PAD_OFF = 46;
export const OFF = {
    VERSION: 0,
    MS_CLASS: 1,
    N_RANGES: 2,
    N_BANDS: 3,
    FLAGS: 4,
    TEAM_BUY_RULE: 5,
    PHI: 6,
    WC: 8,
    PSI_TAIL: 10,
    TEAM_BUY_SHARE: 12,
    TEAM_SLOT_MAX: 14,
    PLATFORM_MS: 16,
    FLOOR_MS: 18,
    FEE_PPM: 20,
    BANDS: 40,
    RAISE_USD_CENTS: 56,
    LAUNCH_CAP_USD_CENTS: 64,
    PAD_CK: 72,
    CK_TARGET_BPS: 74,
    FEE_START: 76,
    FEE_A: 96,
    FEE_B: 104,
} as const;
export interface RangeRowV2 {
    sqrtARel: bigint;
    sqrtBRel: bigint;
    sharePpb: number;
    thetaBps: number;
    psiBps: number;
    kind: number;
    class: number;
    msCapPpm: number;
}
export interface RowV2 {
    version: number;
    msClass: number;
    nBands: number;
    flags: number;
    teamBuyRule: number;
    phiBps: number;
    wcBps: number;
    psiTailBps: number;
    teamBuyShareBps: number;
    teamSlotMaxBps: number;
    platformMsBps: number;
    floorMsBps: number;
    feePpm: number[];
    bands: {
        widthBps: number;
        shareBps: number;
    }[];
    raiseUsdCents: bigint;
    launchCapUsdCents: bigint;
    ckTargetBps: number;
    feeStartPpm: number[];
    feeARel: bigint;
    feeBRel: bigint;
    ranges: RangeRowV2[];
}
const u128At = (v: DataView, o: number) => v.getBigUint64(o, true) | (v.getBigUint64(o + 8, true) << 64n);
export function decodeRowV2(b: Uint8Array): RowV2 {
    if (b.length !== ROW_LEN)
        throw new AccountDecodeError(`RowV2: ${b.length} bytes, want ${ROW_LEN}`);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const u16 = (o: number) => v.getUint16(o, true);
    const u32 = (o: number) => v.getUint32(o, true);
    const u64 = (o: number) => v.getBigUint64(o, true);
    if (b[OFF.VERSION] !== ROW_VERSION)
        throw new AccountDecodeError(`RowV2: version ${b[OFF.VERSION]}`);
    const n = b[OFF.N_RANGES];
    const nb = b[OFF.N_BANDS];
    if (n > RANGES_MAX)
        throw new AccountDecodeError(`RowV2: ${n} ranges`);
    if (nb > MAX_BANDS)
        throw new AccountDecodeError(`RowV2: ${nb} bands`);
    if (b[OFF.PAD_CK] !== 0 || b[OFF.PAD_CK + 1] !== 0)
        throw new AccountDecodeError("RowV2: pad not zero");
    if (b.subarray(OFF.BANDS + 4 * nb, OFF.BANDS + 4 * MAX_BANDS).some((x) => x !== 0))
        throw new AccountDecodeError("RowV2: a band past n_bands not zero");
    const ranges: RangeRowV2[] = [];
    for (let i = 0; i < RANGES_MAX; i++) {
        const o = ROW_GLOBALS + i * RANGE_ROW;
        if (i >= n) {
            if (b.subarray(o, o + RANGE_ROW).some((x) => x !== 0))
                throw new AccountDecodeError(`RowV2: unused range ${i} not zero`);
            continue;
        }
        if (b.subarray(o + RANGE_PAD_OFF, o + RANGE_ROW).some((x) => x !== 0))
            throw new AccountDecodeError(`RowV2: range ${i} pad not zero`);
        ranges.push({
            sqrtARel: u128At(v, o),
            sqrtBRel: u128At(v, o + 16),
            sharePpb: u32(o + 32),
            thetaBps: u16(o + 36),
            psiBps: u16(o + 38),
            kind: b[o + 40],
            class: b[o + 41],
            msCapPpm: u32(o + MS_CAP_OFF),
        });
    }
    const legs = (o: number) => [0, 1, 2, 3, 4].map((i) => u32(o + 4 * i));
    return {
        version: b[OFF.VERSION],
        msClass: b[OFF.MS_CLASS],
        nBands: nb,
        flags: b[OFF.FLAGS],
        teamBuyRule: b[OFF.TEAM_BUY_RULE],
        phiBps: u16(OFF.PHI),
        wcBps: u16(OFF.WC),
        psiTailBps: u16(OFF.PSI_TAIL),
        teamBuyShareBps: u16(OFF.TEAM_BUY_SHARE),
        teamSlotMaxBps: u16(OFF.TEAM_SLOT_MAX),
        platformMsBps: u16(OFF.PLATFORM_MS),
        floorMsBps: u16(OFF.FLOOR_MS),
        feePpm: legs(OFF.FEE_PPM),
        bands: Array.from({ length: MAX_BANDS }, (_, i) => ({ widthBps: u16(OFF.BANDS + 4 * i), shareBps: u16(OFF.BANDS + 2 + 4 * i) })),
        raiseUsdCents: u64(OFF.RAISE_USD_CENTS),
        launchCapUsdCents: u64(OFF.LAUNCH_CAP_USD_CENTS),
        ckTargetBps: u16(OFF.CK_TARGET_BPS),
        feeStartPpm: legs(OFF.FEE_START),
        feeARel: u64(OFF.FEE_A),
        feeBRel: u64(OFF.FEE_B),
        ranges,
    };
}
export function encodeRowV2(r: Omit<RowV2, "nBands" | "ckTargetBps" | "feeStartPpm" | "feeARel" | "feeBRel"> & Partial<RowV2>): Uint8Array {
    if (r.ranges.length > RANGES_MAX)
        throw new RangeError(`${r.ranges.length} ranges > ${RANGES_MAX}`);
    if (r.bands.length > MAX_BANDS)
        throw new RangeError(`${r.bands.length} bands > ${MAX_BANDS}`);
    const b = new Uint8Array(ROW_LEN);
    const v = new DataView(b.buffer);
    const u16 = (o: number, x: number) => v.setUint16(o, x, true);
    const u32 = (o: number, x: number) => v.setUint32(o, x, true);
    const u64 = (o: number, x: bigint) => v.setBigUint64(o, BigInt.asUintN(64, x), true);
    const u128 = (o: number, x: bigint) => {
        u64(o, x & ((1n << 64n) - 1n));
        u64(o + 8, x >> 64n);
    };
    b[OFF.VERSION] = ROW_VERSION;
    b[OFF.MS_CLASS] = r.msClass;
    b[OFF.N_RANGES] = r.ranges.length;
    b[OFF.N_BANDS] = r.bands.length;
    b[OFF.FLAGS] = r.flags;
    b[OFF.TEAM_BUY_RULE] = r.teamBuyRule;
    u16(OFF.PHI, r.phiBps);
    u16(OFF.WC, r.wcBps);
    u16(OFF.PSI_TAIL, r.psiTailBps);
    u16(OFF.TEAM_BUY_SHARE, r.teamBuyShareBps);
    u16(OFF.TEAM_SLOT_MAX, r.teamSlotMaxBps);
    u16(OFF.PLATFORM_MS, r.platformMsBps);
    u16(OFF.FLOOR_MS, r.floorMsBps);
    r.feePpm.forEach((x, i) => u32(OFF.FEE_PPM + 4 * i, x));
    r.bands.forEach((x, i) => {
        u16(OFF.BANDS + 4 * i, x.widthBps);
        u16(OFF.BANDS + 2 + 4 * i, x.shareBps);
    });
    u64(OFF.RAISE_USD_CENTS, r.raiseUsdCents);
    u64(OFF.LAUNCH_CAP_USD_CENTS, r.launchCapUsdCents);
    u16(OFF.CK_TARGET_BPS, r.ckTargetBps ?? 0);
    (r.feeStartPpm ?? [0, 0, 0, 0, 0]).forEach((x, i) => u32(OFF.FEE_START + 4 * i, x));
    u64(OFF.FEE_A, r.feeARel ?? 0n);
    u64(OFF.FEE_B, r.feeBRel ?? 0n);
    r.ranges.forEach((g, i) => {
        const o = ROW_GLOBALS + i * RANGE_ROW;
        u128(o, g.sqrtARel);
        u128(o + 16, g.sqrtBRel);
        u32(o + 32, g.sharePpb);
        u16(o + 36, g.thetaBps);
        u16(o + 38, g.psiBps);
        b[o + 40] = g.kind;
        b[o + 41] = g.class;
        u32(o + MS_CAP_OFF, g.msCapPpm ?? 0);
    });
    return b;
}
