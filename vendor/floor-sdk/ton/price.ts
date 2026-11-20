import { beginCell } from "./cell.ts";
import type { Cell } from "./cell.ts";
import { addr } from "./addresses.ts";
import { bodyOf, sig512Cell } from "./messages.ts";
import type { AddressLike, TonChain, TonTx } from "./types.ts";
export const TON_PRICE_WINDOW_S = 86400;
export const TON_PRICE_AHEAD_CAP_S = 87000;
export const TON_PRICE_WRITE_VALUE = 20000000n;
export interface TonPriceArgs {
    factory: AddressLike;
    quote: AddressLike | null;
    usdCentsX64: bigint;
    validUntil: number | bigint;
}
const U128 = (1n << 128n) - 1n;
const U32 = (1n << 32n) - 1n;
function checked(usdCentsX64: bigint, validUntil: number | bigint): {
    usd: bigint;
    vu: bigint;
} {
    if (typeof usdCentsX64 !== "bigint" || usdCentsX64 < 0n || usdCentsX64 > U128)
        throw new RangeError("usdCentsX64 out of uint128 range");
    if (typeof validUntil === "number" && !Number.isInteger(validUntil))
        throw new RangeError("validUntil out of uint32 range");
    const vu = BigInt(validUntil);
    if (vu < 0n || vu > U32)
        throw new RangeError("validUntil out of uint32 range");
    return { usd: usdCentsX64, vu };
}
export function tonPriceCell(a: TonPriceArgs): Cell {
    const { usd, vu } = checked(a.usdCentsX64, a.validUntil);
    return beginCell().storeAddress(addr(a.factory)).storeAddress(a.quote === null ? null : addr(a.quote)).storeUint(usd, 128).storeUint(vu, 32).endCell();
}
export function tonPriceDigest(a: TonPriceArgs): Uint8Array {
    return tonPriceCell(a).hash();
}
export function tonSetQuotePriceBody(a: {
    quote: AddressLike | null;
    usdCentsX64: bigint;
    validUntil: number | bigint;
    signature: Uint8Array;
    queryId?: bigint;
}): Cell {
    const { usd, vu } = checked(a.usdCentsX64, a.validUntil);
    const sig = sig512Cell(a.signature);
    return bodyOf("set_quote_price", a.queryId ?? 0n).storeAddress(a.quote === null ? null : addr(a.quote)).storeUint(usd, 128).storeUint(vu, 32).storeRef(sig).endCell();
}
export function buildTonSetQuotePrice(chain: Pick<TonChain, "factory">, a: {
    quote: AddressLike | null;
    usdCentsX64: bigint;
    validUntil: number | bigint;
    signature: Uint8Array;
    queryId?: bigint;
    value?: bigint;
}): TonTx {
    if (a.usdCentsX64 === 0n)
        throw new RangeError("usdCentsX64 is zero: every create would refuse this price");
    const value = a.value ?? TON_PRICE_WRITE_VALUE;
    if (value <= 0n)
        throw new RangeError("value must be positive");
    const body = tonSetQuotePriceBody(a);
    return { family: "ton", messages: [{ to: addr(chain.factory), value, bounce: true, body }] };
}
export function tonQuotePriceFresh(p: {
    usdCentsX64: bigint;
    validUntil: bigint | number;
}, nowS: number | bigint): boolean {
    return p.usdCentsX64 > 0n && BigInt(nowS) <= BigInt(p.validUntil);
}
