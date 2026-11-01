import { bytesToHex, decodeAbi, encodeCall } from "../evm/abi.ts";
import type { AbiValue } from "../evm/abi.ts";
import { decodeTeamShareOf, decodeTeamSlotOf, viewCall } from "./evm.ts";
import type { TeamShareV2, TeamSlotV2 } from "./evm.ts";
import { EVM_TOKEN_SCALE } from "./market-evm.ts";
import { evmSignature } from "../generated/index.ts";
export const LAUNCH_STATE_VIEW_EVM = {
    sig: evmSignature("launchState"),
    ret: ["(address,address,address,uint8,uint32,bytes32,bool,uint64,uint64,uint64,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint16)"],
} as const;
export interface LaunchStateEvmV2 {
    token: string;
    quote: string;
    creator: string;
    presetId: number;
    presetVersion: number;
    presetHash: string;
    graduated: boolean;
    createdAt: bigint;
    createdBlock: bigint;
    creatorUnlockAt: bigint;
    supply: bigint;
    sOut: bigint;
    creatorLocked: bigint;
    floor: bigint;
    cushion: bigint;
    p0X64: bigint;
    priceX64: bigint;
    floorX64: bigint;
    slotRateBps: number;
}
const KEYS = [
    "token",
    "quote",
    "creator",
    "presetId",
    "presetVersion",
    "presetHash",
    "graduated",
    "createdAt",
    "createdBlock",
    "creatorUnlockAt",
    "supply",
    "sOut",
    "creatorLocked",
    "floor",
    "cushion",
    "p0X64",
    "priceX64",
    "floorX64",
    "slotRateBps",
] as const;
const NUMBERS = new Set<string>(["presetId", "presetVersion", "slotRateBps"]);
export const launchStateCallV2 = (launchId: bigint): string => bytesToHex(encodeCall(LAUNCH_STATE_VIEW_EVM.sig, [launchId]));
export function decodeLaunchStateV2(data: string | Uint8Array): LaunchStateEvmV2 {
    const [t] = decodeAbi(LAUNCH_STATE_VIEW_EVM.ret, data) as AbiValue[][];
    const o: Record<string, unknown> = {};
    KEYS.forEach((k, i) => { o[k] = NUMBERS.has(k) ? Number(t[i] as bigint) : t[i]; });
    return o as unknown as LaunchStateEvmV2;
}
export type TeamSlotSourceEvmV2 = TeamSlotV2;
export interface TeamBuyOwedEvmV2 {
    locked: bigint;
    unlockAt: bigint;
    unlocked: boolean;
    perPlace: bigint[] | null;
}
const PLACES = 10;
const ZERO_ADDRESS = "0x" + "00".repeat(20);
const ZERO_WORD = "0x" + "00".repeat(32);
function checkSource(s: TeamSlotSourceEvmV2): void {
    for (const k of ["members", "handles", "share", "weightPpb", "teamBuyPart", "slotOwed", "slotBoughtOwed", "wallets"] as const) {
        if (s[k].length !== PLACES)
            throw new RangeError(`TeamSlotSourceEvmV2.${k}: ${PLACES} places, got ${s[k].length}`);
    }
}
export function teamBuyOwedEvmV2(v: LaunchStateEvmV2, opts: {
    now?: bigint;
    slot?: TeamSlotSourceEvmV2;
} = {}): TeamBuyOwedEvmV2 {
    const now = opts.now ?? BigInt(Math.floor(Date.now() / 1000));
    if (opts.slot)
        checkSource(opts.slot);
    return {
        locked: v.creatorLocked,
        unlockAt: v.creatorUnlockAt,
        unlocked: now >= v.creatorUnlockAt,
        perPlace: opts.slot ? opts.slot.teamBuyPart.map((x) => x * EVM_TOKEN_SCALE) : null,
    };
}
export interface TeamSlotPlaceEvmV2 {
    place: number;
    wallet: string | null;
    handle: string | null;
    share: bigint;
    weightPpb: number;
    active: boolean;
    teamShareOwed: bigint;
    boughtOwed: bigint;
    teamBuyPart: bigint;
}
export interface TeamSlotEvmV2 {
    rateBps: number;
    creator: string;
    teamBuy: TeamBuyOwedEvmV2;
    wallet: TeamShareV2 | null;
    places: TeamSlotPlaceEvmV2[];
}
export async function readTeamSlotEvmV2(rpc: {
    ethCall: (to: string, data: string) => Promise<string>;
}, p: {
    amm: string;
    launchId: bigint;
    wallet?: string;
    now?: bigint;
    slot?: TeamSlotSourceEvmV2;
}): Promise<TeamSlotEvmV2> {
    const [state, slot, share] = await Promise.all([
        rpc.ethCall(p.amm, launchStateCallV2(p.launchId)),
        p.slot ? Promise.resolve(null) : rpc.ethCall(p.amm, viewCall("teamSlotOf", [p.launchId])),
        p.wallet === undefined ? Promise.resolve(null) : rpc.ethCall(p.amm, viewCall("teamShareOf", [p.launchId, p.wallet])),
    ]);
    const v = decodeLaunchStateV2(state);
    const s = p.slot ?? decodeTeamSlotOf(slot!);
    checkSource(s);
    const addr = (x: string): string | null => (x.toLowerCase() === ZERO_ADDRESS ? null : x);
    const places = Array.from({ length: PLACES }, (_, i): TeamSlotPlaceEvmV2 => {
        const w = addr(s.wallets[i]) ?? addr(s.members[i]);
        return {
            place: i,
            wallet: i === 0 ? w ?? v.creator : w,
            handle: s.handles[i].toLowerCase() === ZERO_WORD ? null : s.handles[i],
            share: s.share[i],
            weightPpb: s.weightPpb[i],
            active: s.share[i] > 0n,
            teamShareOwed: s.slotOwed[i],
            boughtOwed: s.slotBoughtOwed[i] * EVM_TOKEN_SCALE,
            teamBuyPart: s.teamBuyPart[i] * EVM_TOKEN_SCALE,
        };
    });
    return {
        rateBps: v.slotRateBps,
        creator: v.creator,
        teamBuy: teamBuyOwedEvmV2(v, { now: p.now, slot: s }),
        wallet: share === null ? null : decodeTeamShareOf(share),
        places,
    };
}
