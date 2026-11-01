import { decodeEventData } from "../solana/floor/events.ts";
import { decodeEventDataV2 } from "../v2/events.ts";
import { decodeLogV2, V2_EVENTS } from "../v2/evm.ts";
import { decodeFloorLog } from "../evm/floor/events.ts";
import { checksumAddress } from "../evm/abi.ts";
import type { Log } from "../evm/items.ts";
import { hex } from "../codec.ts";
import { EVENT_IX_TAG_LE } from "../solana/instruction.ts";
import type { EvmEvent, SolanaEvent } from "./types.gen.ts";
export type { EvmEvent, EvmEventMap, SolanaEvent, SolanaEventMap } from "./types.gen.ts";
export { SHARED_EVENT_NAMES } from "./types.gen.ts";
export * from "./types.gen.ts";
export type FloorEvent = SolanaEvent | EvmEvent;
export function decodeSolanaEvent(data: Uint8Array): SolanaEvent | null {
    const d = decodeEventDataV2(data) ?? decodeEventData(data);
    return d ? ({ chain: "solana", name: d.name, fields: d.fields } as SolanaEvent) : null;
}
export function decodeSolanaEventCpi(ixData: Uint8Array): SolanaEvent | null {
    if (ixData.length < 16 || hex(ixData.slice(0, 8)) !== hex(EVENT_IX_TAG_LE))
        return null;
    return decodeSolanaEvent(ixData.slice(8));
}
export function decodeEvmLog(log: Log, from?: readonly string[]): EvmEvent | null {
    if (from && (!log.address || !from.some((a) => a.toLowerCase() === log.address!.toLowerCase())))
        return null;
    const v2 = decodeLogV2(log);
    const address = log.address ? checksumAddress(log.address) : undefined;
    if (v2)
        return { chain: "evm", name: v2.name, fields: v2.fields, ...(address ? { address } : {}) } as unknown as EvmEvent;
    const d = decodeFloorLog(log);
    if (!d)
        return null;
    const name = d.name in V2_EVENTS ? `${d.name}V1` : d.name;
    return { chain: "evm", name, fields: d.args, ...(address ? { address } : {}) } as unknown as EvmEvent;
}
export const decodeEvmLogs = (logs: readonly Log[], from?: readonly string[]): EvmEvent[] => logs.map((l) => decodeEvmLog(l, from)).filter((e): e is EvmEvent => e !== null);
export const isEvent = <N extends string>(e: FloorEvent, name: N): e is Extract<FloorEvent, {
    name: N;
}> => e.name === name;
