import { fail } from "../index.ts";
import { creatorLegs, platformLegs } from "./fees.ts";
import { U64_MAX, U128_MAX } from "./wide.ts";
export const MAX_MEMBERS = 10;
export const WEIGHT_ONE = 1000000000n;
export const CREATOR_BUY_LOCK_SECS = 86400n;
export { CREATOR_REF_BPS, TRADER_REF_BPS } from "./fees.ts";
export { platformLegs as platformLegsV2, creatorLegs as creatorLegsV2 } from "./fees.ts";
const u128 = (x: bigint): bigint => (x < 0n || x > U128_MAX ? fail("Overflow") : x);
const members = (n: number, what: string): void => {
    if (n !== MAX_MEMBERS)
        throw new RangeError(`${what}: ${n} entries, want ${MAX_MEMBERS}`);
};
export function weightsV2(paid: readonly bigint[], bought: bigint): number[] {
    members(paid.length, "paid");
    const w: number[] = Array(MAX_MEMBERS).fill(0);
    if (bought === 0n)
        return w;
    const t = paid.reduce((a, p) => a + p, 0n);
    if (t > U128_MAX || t > bought)
        fail("Overflow");
    for (let i = 0; i < MAX_MEMBERS; i++)
        w[i] = Number(((paid[i] < bought ? paid[i] : bought) * WEIGHT_ONE) / bought);
    return w;
}
export function slotWeightsV2(shares: readonly bigint[]): number[] {
    members(shares.length, "shares");
    const total = u128(shares.reduce((a, x) => a + x, 0n));
    if (total === 0n) {
        const w: number[] = Array(MAX_MEMBERS).fill(0);
        w[0] = Number(WEIGHT_ONE);
        return w;
    }
    return weightsV2(shares, total);
}
export function splitMembersV2(amount: bigint, w: readonly number[]): [
    bigint[],
    bigint
] {
    members(w.length, "weights");
    u128(amount);
    const parts: bigint[] = Array(MAX_MEMBERS).fill(0n);
    let given = 0n;
    for (let i = 0; i < MAX_MEMBERS; i++) {
        const wi = BigInt(w[i]) < WEIGHT_ONE ? BigInt(w[i]) : WEIGHT_ONE;
        let p = (amount * wi) / WEIGHT_ONE;
        if (p > amount - given)
            p = amount - given;
        parts[i] = p;
        given += p;
    }
    return [parts, amount > given ? amount - given : 0n];
}
export function splitReleaseV2(tokens: bigint, w: readonly number[]): bigint[] {
    members(w.length, "weights");
    if (w.every((x) => x === 0)) {
        const parts: bigint[] = Array(MAX_MEMBERS).fill(0n);
        parts[0] = u128(tokens);
        return parts;
    }
    const [parts, dust] = splitMembersV2(tokens, w);
    parts[0] = u128(parts[0] + dust);
    return parts;
}
export function splitTeamBuyV2(tokens: bigint, w: readonly number[], createdAt: bigint, now: bigint): bigint[] {
    const due = createdAt + CREATOR_BUY_LOCK_SECS > U64_MAX ? U64_MAX : createdAt + CREATOR_BUY_LOCK_SECS;
    if (now < due)
        fail("NotDue");
    return splitReleaseV2(tokens, w);
}
