import { BPS, fail } from "./index.ts";
const U128_MAX = (1n << 128n) - 1n;
const u128 = (v: bigint): bigint => (v > U128_MAX ? fail("Overflow") : v);
export function fixedRaiseClaim(c: bigint, raised: bigint, out: bigint, refund: bigint): [
    bigint,
    bigint
] {
    if (raised === 0n)
        fail("Zero");
    if (c > raised)
        fail("Overflow");
    return [u128((out * c) / raised), u128((refund * c) / raised)];
}
export const GENESIS_MIGRATED_DISCOUNT_BPS = 7500;
export function genesisWeight(migrated: bigint, publicIn: bigint): bigint | null {
    const w = migrated * BPS + publicIn * (BPS - BigInt(GENESIS_MIGRATED_DISCOUNT_BPS));
    return w >> 128n === 0n ? w : null;
}
export function genesisShare(tokensOut: bigint, w: bigint, weightTotal: bigint): bigint {
    if (weightTotal === 0n)
        return 0n;
    const v = (tokensOut * w) / weightTotal;
    if (v >> 128n !== 0n)
        fail("Overflow");
    return v;
}
export function genesisWeightListed(migrated: bigint, publicIn: bigint, listed: bigint, listedDiscount: boolean): bigint | null {
    return listedDiscount ? genesisWeight(migrated + listed, publicIn) : genesisWeight(migrated, publicIn + listed);
}
export function genesisClaim(c: bigint, w: bigint, raised: bigint, weightTotal: bigint, out: bigint, refund: bigint): [
    bigint,
    bigint
] {
    if (raised === 0n || weightTotal === 0n)
        fail("Zero");
    const lo = c * (BPS - BigInt(GENESIS_MIGRATED_DISCOUNT_BPS));
    const hi = c * BPS;
    if (lo >> 128n !== 0n || hi >> 128n !== 0n)
        fail("Overflow");
    if (c > raised || w > weightTotal || w < lo || w > hi)
        fail("Overflow");
    return [u128((out * w) / weightTotal), u128((refund * c) / raised)];
}
