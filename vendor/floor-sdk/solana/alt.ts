import { base58Encode, readUintLE } from "../codec.ts";
import type { LookupTable } from "./tx.ts";
export const LOOKUP_TABLE_META_SIZE = 56;
export interface LookupTableAccount extends LookupTable {
    deactivationSlot: bigint;
    lastExtendedSlot: bigint;
    authority: string | null;
}
export function decodeLookupTable(address: string, data: Uint8Array): LookupTableAccount {
    if (data.length < LOOKUP_TABLE_META_SIZE || readUintLE(data, 0, 4) !== 1n || (data.length - LOOKUP_TABLE_META_SIZE) % 32 !== 0)
        throw new RangeError("not a lookup table account");
    const addresses: string[] = [];
    for (let o = LOOKUP_TABLE_META_SIZE; o < data.length; o += 32)
        addresses.push(base58Encode(data.slice(o, o + 32)));
    return {
        address,
        addresses,
        deactivationSlot: readUintLE(data, 4, 8),
        lastExtendedSlot: readUintLE(data, 12, 8),
        authority: data[21] === 1 ? base58Encode(data.slice(22, 54)) : null,
    };
}
