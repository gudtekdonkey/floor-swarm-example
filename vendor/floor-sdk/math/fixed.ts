import { U128_MAX, assertU128 } from "./u256.ts";
const K: readonly bigint[] = [
    0xb504f333f9de6484597d89b3754abe9fn,
    0x9837f0518db8a96f46ad23182e42f6f6n,
    0x8b95c1e3ea8bd6e6fbe4628758a53c90n,
    0x85aac367cc487b14c5c95b8c2154c1b2n,
    0x82cd8698ac2ba1d73e2a475b46520bffn,
    0x8164d1f3bc0307737be56527bd14def4n,
    0x80b1ed4fd999ab6c25335719b6e6fd20n,
    0x8058d7d2d5e5f6b094d589f608ee4aa2n,
    0x802c6436d0e04f50ff8ce94a6797b3cen,
    0x8016302f174676283690dfe44d11d008n,
    0x800b179c82028fd0945e54e2ae18f2f0n,
    0x80058baf7fee3b5d1c718b38e549cb93n,
    0x8002c5d00fdcfcb6b6566a58c048be1fn,
    0x800162e61bed4a48e84c2e1a463473d9n,
    0x8000b17292f702a3aa22beacca949013n,
    0x800058b92abbae02030c5fa5256f41fen,
    0x80002c5c8dade4d71776c0f4dbea67d6n,
    0x8000162e44eaf636526be456600bdbe4n,
    0x80000b1721fa7c188307016c1cd4e8b6n,
    0x8000058b90de7e4cecfc487503488bb1n,
    0x800002c5c8678f36cbfce50a6de60b14n,
    0x80000162e431db9f80b2347b5d62e516n,
    0x800000b1721872d0c7b08cf1e0114152n,
    0x80000058b90c1aa8a5c3736cb77e8dffn,
    0x8000002c5c8605a4635f2efc2362d978n,
    0x800000162e4300e635cf4a109e3939bdn,
    0x8000000b17217ff81bef9c551590cf83n,
    0x800000058b90bfdd4e39cd52c0cfa27cn,
    0x80000002c5c85fe6f72d669e0e76e411n,
    0x8000000162e42ff18f9ad35186d0df28n,
    0x80000000b17217f84cce71aa0dcfffe7n,
    0x8000000058b90bfc07a77ad56ed22aaan,
    0x800000002c5c85fdfc23cdead40da8d6n,
    0x80000000162e42fefc25eb1571853a66n,
    0x800000000b17217f7d97f692baacded5n,
    0x80000000058b90bfbead3b8b5dd254d7n,
    0x8000000002c5c85fdf4eedd62f084e67n,
    0x800000000162e42fefa58aef378bf586n,
    0x8000000000b17217f7d24a78a3c7ef02n,
    0x800000000058b90bfbe9067c93e474a6n,
    0x80000000002c5c85fdf47b8e5a72599fn,
    0x8000000000162e42fefa3bdb315934a2n,
    0x80000000000b17217f7d1d7299b49c46n,
    0x8000000000058b90bfbe8e9a8d1c4ea0n,
    0x800000000002c5c85fdf4745969ea76fn,
    0x80000000000162e42fefa3a0df5373bfn,
    0x800000000000b17217f7d1cff4aac1e1n,
    0x80000000000058b90bfbe8e7db95a2f1n,
    0x8000000000002c5c85fdf473e61ae1f8n,
    0x800000000000162e42fefa39f121751cn,
    0x8000000000000b17217f7d1cf815bb96n,
    0x800000000000058b90bfbe8e7bec1e0dn,
    0x80000000000002c5c85fdf473dee5f17n,
    0x8000000000000162e42fefa39ef5438fn,
    0x80000000000000b17217f7d1cf7a26c8n,
    0x8000000000000058b90bfbe8e7bcf4a4n,
    0x800000000000002c5c85fdf473de72a2n,
    0x80000000000000162e42fefa39ef3765n,
    0x800000000000000b17217f7d1cf79b37n,
    0x80000000000000058b90bfbe8e7bcd7dn,
    0x8000000000000002c5c85fdf473de6b6n,
    0x800000000000000162e42fefa39ef359n,
    0x8000000000000000b17217f7d1cf79acn,
    0x800000000000000058b90bfbe8e7bcd6n,
];
const ONE_127 = 1n << 127n;
const TWO_255 = 1n << 255n;
const POW2: readonly bigint[] = Array.from({ length: 257 }, (_, k) => 1n << BigInt(k));
const FRAC_BIT: readonly bigint[] = Array.from({ length: 65 }, (_, i) => (i === 0 ? 0n : 1n << BigInt(64 - i)));
const U32 = 0xffffffffn;
export function bitLength(n: bigint): number {
    let lo = 0;
    let hi = 256;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (n >= POW2[mid])
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}
export const FIXED_MEMO_MAX = 4096;
const LOG2_MEMO = new Map<bigint, bigint | null>();
const EXP2_MEMO = new Map<bigint, bigint | null>();
export function clearFixedMemo(): void {
    LOG2_MEMO.clear();
    EXP2_MEMO.clear();
}
function remember(memo: Map<bigint, bigint | null>, k: bigint, v: bigint | null): bigint | null {
    if (memo.size >= FIXED_MEMO_MAX)
        memo.clear();
    memo.set(k, v);
    return v;
}
export function log2X64(n: bigint): bigint | null {
    const hit = LOG2_MEMO.get(n);
    return hit !== undefined ? hit : remember(LOG2_MEMO, n, log2X64Uncached(n));
}
export function exp2X64(y: bigint): bigint | null {
    const hit = EXP2_MEMO.get(y);
    return hit !== undefined ? hit : remember(EXP2_MEMO, y, exp2X64Uncached(y));
}
export function log2X64Uncached(n: bigint): bigint | null {
    assertU128(n, "n");
    if (n === 0n)
        return null;
    const m0 = bitLength(n) - 1;
    let m = (n << BigInt(127 - m0)) & U128_MAX;
    let frac = 0n;
    for (let i = 1; i <= 64; i++) {
        const p = m * m;
        if (p >= TWO_255) {
            frac |= FRAC_BIT[i];
            m = p >> 128n;
        }
        else {
            m = p >> 127n;
        }
    }
    return (BigInt(m0) << 64n) | frac;
}
export function exp2X64Uncached(y: bigint): bigint | null {
    assertU128(y, "y");
    const int = y >> 64n;
    if (int >= 64n)
        return null;
    const fHi = Number((y >> 32n) & U32);
    const fLo = Number(y & U32);
    let r = ONE_127;
    for (let i = 1; i <= 64; i++) {
        const bit = i <= 32 ? (fHi >>> (32 - i)) & 1 : (fLo >>> (64 - i)) & 1;
        if (bit === 1)
            r = ((r * K[i - 1]) >> 127n) & U128_MAX;
    }
    return r >> (63n - int);
}
