import { U128_MAX } from "./wide.ts";
import { v2Fail } from "./error.ts";
import type { Book } from "./book.ts";
export interface BidHoldings {
    c: bigint;
    k: bigint;
    f: bigint;
}
export function circulatingS(nLive: bigint, forSale: bigint, held: BidHoldings, dead: bigint): bigint {
    let out = forSale;
    for (const x of [held.c, held.k, held.f, dead]) {
        out += x;
        if (out > U128_MAX)
            v2Fail("Overflow");
    }
    if (nLive < out)
        v2Fail("Overflow");
    return nLive - out;
}
export function sweepIfEmpty(s: bigint, f: bigint, c: bigint, k: bigint): [
    bigint,
    [
        bigint,
        bigint,
        bigint
    ]
] {
    if (s > 0n)
        return [0n, [f, c, k]];
    const rest = f + c + k;
    if (f + c > U128_MAX || rest > U128_MAX)
        v2Fail("Overflow");
    return [rest, [0n, 0n, 0n]];
}
export function sweepUnsettled(b: Book): bigint {
    let moved = 0n;
    for (let i = 0; i < b.nRanges; i++) {
        moved += b.ranges[i].place;
        if (moved > U128_MAX)
            v2Fail("Overflow");
    }
    if (moved === 0n)
        return 0n;
    for (let i = 0; i < b.nRanges; i++)
        b.ranges[i].place = 0n;
    if (b.sqrtP > b.sqrtLMax)
        b.sqrtLMax = b.sqrtP;
    return moved;
}
const bytes = (n: number, tail: number[]): Uint8Array => {
    const a = new Uint8Array(n);
    a.set(tail, n - tail.length);
    return a;
};
export const EVM_DEAD: readonly Uint8Array[] = [
    new Uint8Array(20),
    bytes(20, [222, 173]),
    bytes(20, [1]),
    Uint8Array.from([222, 173, 0, 0, 0, 0, 0, 0, 0, 0, 66, 6, 148, 32, 105, 66, 6, 148, 32, 105]),
];
const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
export function isEvmDead(a: Uint8Array): boolean {
    return a.length === 20 && EVM_DEAD.some((d) => eq(d, a));
}
export const SOLANA_INCINERATOR = Uint8Array.from([
    0,
    51,
    144,
    114,
    141,
    52,
    17,
    96,
    121,
    189,
    201,
    17,
    191,
    255,
    0,
    219,
    212,
    77,
    46,
    205,
    204,
    247,
    156,
    166,
    225,
    0,
    56,
    225,
    0,
    0,
    0,
    0,
]);
export const SOLANA_SYSTEM_PROGRAM = new Uint8Array(32);
export function isSolanaDeadOwner(owner: Uint8Array): boolean {
    return eq(owner, SOLANA_INCINERATOR) || eq(owner, SOLANA_SYSTEM_PROGRAM);
}
