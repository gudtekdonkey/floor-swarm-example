import { U64_MAX } from "./wide.ts";
import { v2Fail } from "./error.ts";
const Q64 = 64n;
export interface HolderBook {
    index: bigint;
    w: bigint;
    carry: bigint;
    bookedTotal: bigint;
    paidTotal: bigint;
}
export interface Position {
    amount: bigint;
    owed: bigint;
    indexSnap: bigint;
    optedOut: boolean;
}
export const newPosition = (): Position => ({ amount: 0n, owed: 0n, indexSnap: 0n, optedOut: false });
export const optedOutPosition = (): Position => ({ ...newPosition(), optedOut: true });
export type Payout = "Indexed" | "Carried";
function u64(x: bigint): bigint {
    if (x < 0n || x > U64_MAX)
        throw new RangeError("holders: u64 overflow");
    return x;
}
function earned(amount: bigint, dIndex: bigint): bigint {
    const hi = dIndex >> Q64;
    const lo = dIndex & U64_MAX;
    return BigInt.asUintN(128, amount * hi + ((amount * lo) >> Q64));
}
export const newHolderBook = (): HolderBook => ({ index: 0n, w: 0n, carry: 0n, bookedTotal: 0n, paidTotal: 0n });
export const cloneHolderBook = (b: HolderBook): HolderBook => ({ ...b });
export function holderAddReward(b: HolderBook, amount: bigint, sCirc: bigint): Payout {
    const booked = b.bookedTotal + amount;
    if (booked > U64_MAX)
        v2Fail("Overflow");
    b.bookedTotal = booked;
    const total = b.carry + amount;
    if (total > U64_MAX)
        v2Fail("Overflow");
    const w = b.w;
    if (w === 0n || w > sCirc || total === 0n) {
        b.carry = total;
        return "Carried";
    }
    const step = (total << Q64) / w;
    const out = (step * w + (1n << Q64) - 1n) >> Q64;
    const index = b.index + step;
    if (index >= 1n << 128n)
        v2Fail("Overflow");
    b.index = index;
    b.carry = total - (out < total ? out : total);
    return "Indexed";
}
export function holderSettle(b: HolderBook, p: Position): void {
    if (!p.optedOut)
        p.owed = u64(p.owed + BigInt.asUintN(64, earned(p.amount, b.index - p.indexSnap)));
    p.indexSnap = b.index;
}
export function holderAdd(b: HolderBook, p: Position, amount: bigint): void {
    holderSettle(b, p);
    const a = p.amount + amount;
    if (a > U64_MAX)
        v2Fail("Overflow");
    p.amount = a;
    if (!p.optedOut) {
        const w = b.w + amount;
        if (w > U64_MAX)
            v2Fail("Overflow");
        b.w = w;
    }
}
export function holderSub(b: HolderBook, p: Position, amount: bigint): void {
    if (amount > p.amount)
        v2Fail("NotHeld");
    holderSettle(b, p);
    p.amount -= amount;
    if (!p.optedOut)
        b.w = u64(b.w - amount);
}
export function holderSync(b: HolderBook, p: Position, real: bigint): void {
    if (real > p.amount)
        return holderAdd(b, p, real - p.amount);
    if (real === p.amount)
        return;
    if (!p.optedOut) {
        const d = b.index - p.indexSnap;
        const all = earned(p.amount, d);
        const kept = earned(real, d);
        p.owed = u64(p.owed + BigInt.asUintN(64, kept));
        const carry = b.carry + BigInt.asUintN(64, all - kept);
        if (carry > U64_MAX)
            v2Fail("Overflow");
        b.carry = carry;
        b.w = u64(b.w - (p.amount - real));
    }
    p.indexSnap = b.index;
    p.amount = real;
}
export function holderOptIn(b: HolderBook, p: Position): void {
    if (!p.optedOut)
        return;
    p.optedOut = false;
    p.indexSnap = b.index;
    b.w = u64(b.w + p.amount);
}
export function holderTake(b: HolderBook, p: Position): bigint {
    holderSettle(b, p);
    const x = p.owed;
    p.owed = 0n;
    b.paidTotal = u64(b.paidTotal + x);
    return x;
}
