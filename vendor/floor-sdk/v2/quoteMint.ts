export const EXT_TRANSFER_FEE = 1;
export interface TransferFeeV2 {
    epoch: bigint;
    maximumFee: bigint;
    basisPoints: number;
}
export interface QuoteTransferFeeV2 {
    older: TransferFeeV2;
    newer: TransferFeeV2;
}
const U64_MAX = (1n << 64n) - 1n;
const u16 = (d: Uint8Array, o: number): number => d[o] | (d[o + 1] << 8);
const u64 = (d: Uint8Array, o: number): bigint => {
    let x = 0n;
    for (let i = 7; i >= 0; i--)
        x = (x << 8n) | BigInt(d[o + i]);
    return x;
};
export function mintTlvV2(data: Uint8Array): {
    type: number;
    value: Uint8Array;
}[] {
    const out: {
        type: number;
        value: Uint8Array;
    }[] = [];
    if (data.length <= 166)
        return out;
    for (let o = 166; o + 4 <= data.length;) {
        const t = u16(data, o);
        const l = u16(data, o + 2);
        if (t === 0 || o + 4 + l > data.length)
            break;
        out.push({ type: t, value: data.subarray(o + 4, o + 4 + l) });
        o += 4 + l;
    }
    return out;
}
export function decodeQuoteTransferFeeV2(data: Uint8Array): QuoteTransferFeeV2 | null {
    const ext = mintTlvV2(data).find((e) => e.type === EXT_TRANSFER_FEE);
    if (!ext || ext.value.length < 108)
        return null;
    const at = (o: number): TransferFeeV2 => ({ epoch: u64(ext.value, o), maximumFee: u64(ext.value, o + 8), basisPoints: u16(ext.value, o + 16) });
    return { older: at(72), newer: at(90) };
}
export function quoteTransferFeeV2(fee: QuoteTransferFeeV2 | null | undefined, epoch: bigint, amount: bigint): bigint {
    if (!fee)
        return 0n;
    if (amount < 0n || amount > U64_MAX)
        throw new RangeError(`amount ${amount} is not a u64`);
    const f = epoch >= fee.newer.epoch ? fee.newer : fee.older;
    if (f.basisPoints === 0)
        return 0n;
    const w = (amount * BigInt(f.basisPoints) + 9999n) / 10000n;
    return w < f.maximumFee ? w : f.maximumFee;
}
export function quoteReceivedV2(fee: QuoteTransferFeeV2 | null | undefined, epoch: bigint, amount: bigint): bigint {
    const w = quoteTransferFeeV2(fee, epoch, amount);
    return amount - (w < amount ? w : amount);
}
export function quoteBuyNetInV2(fee: QuoteTransferFeeV2 | null | undefined, epoch: bigint, amount: bigint): bigint {
    const w = quoteTransferFeeV2(fee, epoch, amount);
    if (w >= amount)
        throw new RangeError(`QuoteTransferShort: the quote mint's transfer fee ${w} takes the whole amount ${amount}`);
    return amount - w;
}
