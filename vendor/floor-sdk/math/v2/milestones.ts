import { U128_MAX } from "./wide.ts";
import { v2Fail } from "./error.ts";
const u128 = (x: bigint): bigint => (x > U128_MAX ? v2Fail("Overflow") : x);
export function bookedFromRemainder(r: bigint, thetaBps: number): bigint {
    const keep = 10000n - BigInt(thetaBps);
    if (keep < 0n)
        v2Fail("Overflow");
    return u128(r * keep) / 10000n;
}
export interface ClassSplit {
    platform: bigint;
    floorToken: bigint;
    class: bigint;
}
export function splitByRow(amount: bigint, platformBps: number, floorBps: number): ClassSplit {
    if (platformBps + floorBps > 10000)
        v2Fail("RowInvalid");
    const part = (b: number): bigint => u128(amount * BigInt(b)) / 10000n;
    const platform = part(platformBps);
    const floorToken = part(floorBps);
    return { platform, floorToken, class: amount - platform - floorToken };
}
export interface TeamSplit {
    referrers: [
        bigint,
        bigint,
        bigint
    ];
    slot: bigint;
}
export function teamSplit(amount: bigint, levelsPresent: readonly [
    boolean,
    boolean,
    boolean
]): TeamSplit {
    const tenth = amount / 10n;
    const w = [90n, 9n, 1n];
    const referrers: [
        bigint,
        bigint,
        bigint
    ] = [0n, 0n, 0n];
    let paid = 0n;
    for (let i = 0; i < 3; i++) {
        if (levelsPresent[i]) {
            referrers[i] = (tenth * w[i]!) / 100n;
            paid += referrers[i];
        }
    }
    return { referrers, slot: amount - paid };
}
export function slotSplit(slot: bigint, sharesBps: readonly number[]): {
    parts: bigint[];
    dust: bigint;
} {
    const parts = sharesBps.map((s) => (slot * BigInt(s)) / 10000n);
    const paid = parts.reduce((a, b) => a + b, 0n);
    return { parts, dust: slot - paid };
}
