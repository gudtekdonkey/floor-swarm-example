import { checksumAddress } from "../abi.ts";
import { decodeEventLog, itemTopic } from "../items.ts";
import type { EventArgsOf, EventName, Log } from "../items.ts";
import { FLOOR_AMM_ABI, FLOOR_AMM_UNFROZEN_EVENTS, FLOOR_ZAP_ABI } from "./iface.ts";
export type FloorEventName = EventName<typeof FLOOR_AMM_ABI> | EventName<typeof FLOOR_ZAP_ABI>;
export type FloorEventArgs<N extends EventName<typeof FLOOR_AMM_ABI>> = EventArgsOf<typeof FLOOR_AMM_ABI, N>;
export interface FloorEvmEvent {
    name: string;
    args: Record<string, any>;
    address?: string;
    unfrozen?: true;
}
const ALL = [...FLOOR_AMM_ABI, ...FLOOR_ZAP_ABI, ...FLOOR_AMM_UNFROZEN_EVENTS];
let unfrozen: Set<string> | undefined;
const UNFROZEN = (): Set<string> => (unfrozen ??= new Set(FLOOR_AMM_UNFROZEN_EVENTS.map((e) => itemTopic(e))));
export const FLOOR_EVENT_TOPICS: Record<string, string> = {};
for (const i of ALL.filter((i) => i.type === "event").reverse()) {
    const name = i.name;
    const first = ALL.find((j) => j.type === "event" && j.name === name)!;
    if (!(name in FLOOR_EVENT_TOPICS))
        Object.defineProperty(FLOOR_EVENT_TOPICS, name, {
            enumerable: true,
            configurable: true,
            get: () => {
                const value = itemTopic(first);
                Object.defineProperty(FLOOR_EVENT_TOPICS, name, { value, enumerable: true, configurable: true, writable: true });
                return value;
            },
        });
}
export function decodeFloorLog(log: Log, from?: readonly string[]): FloorEvmEvent | null {
    if (from && (!log.address || !from.some((a) => a.toLowerCase() === log.address!.toLowerCase())))
        return null;
    const d: FloorEvmEvent | null = decodeEventLog(ALL, log);
    if (!d)
        return null;
    if (UNFROZEN().has((log.topics[0] ?? "").toLowerCase()))
        d.unfrozen = true;
    return log.address ? { ...d, address: checksumAddress(log.address) } : d;
}
export function decodeFloorLogs(logs: readonly Log[], from?: readonly string[]): FloorEvmEvent[] {
    return logs.map((l) => decodeFloorLog(l, from)).filter((e): e is FloorEvmEvent => e !== null);
}
