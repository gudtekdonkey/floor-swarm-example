import { U128_MAX, U64_MAX, toU128 } from "./v2/wide.ts";
export { U128_MAX, U64_MAX, toU128 };
export const U256_MAX: bigint = (1n << 256n) - 1n;
export function assertU128(v: bigint, name: string): void {
    if (typeof v !== "bigint" || v < 0n || v > U128_MAX) {
        throw new RangeError(`${name} must be a bigint in [0, 2^128): got ${String(v)}`);
    }
}
export function mulU128(a: bigint, b: bigint): bigint {
    return a * b;
}
export function checkedMulU64(x: bigint, m: bigint): bigint | null {
    const p = x * m;
    return p > U256_MAX ? null : p;
}
export function checkedAdd(a: bigint, b: bigint): bigint | null {
    const p = a + b;
    return p > U256_MAX ? null : p;
}
export function checkedSub(a: bigint, b: bigint): bigint | null {
    return a < b ? null : a - b;
}
export function checkedShl64(x: bigint): bigint | null {
    return x >> 192n !== 0n ? null : x << 64n;
}
export function divRemU128(x: bigint, d: bigint): [
    bigint,
    bigint
] {
    if (d === 0n)
        throw new RangeError("division by zero");
    return [x / d, x % d];
}
export function divCeilU128(x: bigint, d: bigint): bigint {
    const [q, r] = divRemU128(x, d);
    return r === 0n ? q : q + 1n;
}
export function hiLo(x: bigint): [
    bigint,
    bigint
] {
    return [x >> 128n, x & U128_MAX];
}
