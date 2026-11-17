import { bytesToHex, decodeAbi, encodeCall, hexToBytes } from "../evm/abi.ts";
import type { AbiValue } from "../evm/abi.ts";
import { ROW_LEN, decodeRowV2 } from "../math/v2/preset.ts";
import type { RowV2 } from "../math/v2/preset.ts";
import type { PresetRowV2Account } from "./types.ts";
import { evmSignature } from "../generated/index.ts";
import { MULTICALL3_ADDRESS, aggregate3Call, decodeAggregate3Result } from "../evm/multicall.ts";
export const PRESET_ROW_VIEW_EVM = { sig: evmSignature("presetRow"), ret: ["(uint8,bool,bool,uint32,bytes32,bytes)"] } as const;
export const NEXT_PRESET_ID_VIEW_EVM = { sig: evmSignature("nextPresetId"), ret: ["uint8"] } as const;
const RESERVED_ID = 0;
const RETIRED_ID = 2;
export function presetRowCallV2(id: number): string {
    if (!Number.isInteger(id) || id < 0 || id > 255)
        throw new RangeError(`preset id ${id}: a u8`);
    return bytesToHex(encodeCall(PRESET_ROW_VIEW_EVM.sig, [BigInt(id)]));
}
export const nextPresetIdCallV2 = (): string => bytesToHex(encodeCall(NEXT_PRESET_ID_VIEW_EVM.sig, []));
export const decodeNextPresetIdEvmV2 = (data: string | Uint8Array): number => Number(decodeAbi(NEXT_PRESET_ID_VIEW_EVM.ret, data)[0] as bigint);
export function decodePresetRowEvmV2(data: string | Uint8Array): PresetRowV2Account | null {
    const [t] = decodeAbi(PRESET_ROW_VIEW_EVM.ret, data) as AbiValue[][];
    const spec = hexToBytes(t[5] as string);
    if (spec.length === 0)
        return null;
    if (spec.length !== ROW_LEN)
        throw new RangeError(`preset row spec ${spec.length} bytes, want ${ROW_LEN}`);
    return {
        id: Number(t[0] as bigint),
        bump: 0,
        checked: 0,
        genesisRow: 0,
        padVersion: new Uint8Array(2),
        enabled: t[1] ? 1 : 0,
        deleted: t[2] ? 1 : 0,
        version: Number(t[3] as bigint),
        rowHash: hexToBytes(t[4] as string),
        row: spec,
        padEnd: new Uint8Array(0),
    };
}
export interface PresetMenuItemV2 {
    id: number;
    version: number;
    rowHash: string;
    row: RowV2;
}
export function presetMenuV2(rows: readonly (PresetRowV2Account | null)[]): PresetMenuItemV2[] {
    return rows
        .filter((r): r is PresetRowV2Account => r !== null && r.enabled !== 0 && r.deleted === 0 && r.id !== RESERVED_ID && r.id !== RETIRED_ID)
        .sort((a, b) => a.id - b.id)
        .map((r) => ({ id: r.id, version: r.version, rowHash: bytesToHex(r.rowHash), row: decodeRowV2(r.row) }));
}
const PRESET_MENU_BATCH = 100;
export async function readPresetMenuEvmV2(rpc: {
    ethCall: (to: string, data: string) => Promise<string>;
}, amm: string, opts: {
    multicall?: string | null;
} = {}): Promise<PresetMenuItemV2[]> {
    const next = decodeNextPresetIdEvmV2(await rpc.ethCall(amm, nextPresetIdCallV2()));
    const ids = Array.from({ length: Math.max(0, next - 1) }, (_, i) => i + 1).filter((id) => id !== RETIRED_ID);
    if (opts.multicall === null) {
        return presetMenuV2(await Promise.all(ids.map(async (id) => decodePresetRowEvmV2(await rpc.ethCall(amm, presetRowCallV2(id))))));
    }
    const multicall = opts.multicall ?? MULTICALL3_ADDRESS;
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += PRESET_MENU_BATCH)
        chunks.push(ids.slice(i, i + PRESET_MENU_BATCH));
    const rows = (await Promise.all(chunks.map(async (chunk) => {
        const call = aggregate3Call(chunk.map((id) => ({ target: amm, allowFailure: true, callData: presetRowCallV2(id) })), multicall);
        const res = decodeAggregate3Result(await rpc.ethCall(call.to, call.data));
        if (res.length !== chunk.length)
            throw new RangeError(`aggregate3: ${res.length} results, ${chunk.length} calls`);
        return res.map((r, i) => {
            if (!r.success)
                throw new Error(`presetRow(${chunk[i]}) failed: ${r.returnData}`);
            return decodePresetRowEvmV2(r.returnData);
        });
    }))).flat();
    return presetMenuV2(rows);
}
