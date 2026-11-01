import { bytesToHex, checksumAddress, decodeAbi, encodeCall, hexToBytes } from "../../evm/abi.ts";
import type { AbiValue } from "../../evm/abi.ts";
import { teamSlotHandleId } from "../../handle.ts";
import { freshRegistryPrice } from "../../registryPrice.ts";
import type { RegistryPrice } from "../../registryPrice.ts";
import type { EvmCall } from "../evm.ts";
import { evmSignature } from "../../generated/index.ts";
export { claimV2Call, CLAIM_HOLDER_EVM, CLAIM_KNOWN_V2_EVM, creditBackingCall, optInCall, viewCall, decodeTeamShareOf } from "../evm.ts";
export type { EvmCall } from "../evm.ts";
export { traderRefDigest, traderRefAuthDigest, bindHandleDigest, bindHandleAuthDigest } from "../../evm/floor/calls.ts";
export { CLAIM_CREATOR, CLAIM_CREATOR_REF, CLAIM_TEAM_SLOT, CLAIM_TRADER_REF, CLAIM_PAYOUT, CLAIM_TEAM_BUY, CLAIM_SHARE_BOUGHT, MEMBER_WALLET, MEMBER_HANDLE, NATIVE_QUOTE } from "../../evm/floor/iface.ts";
export const EVM_V2_TX = {
    createLaunch: evmSignature("createLaunch"),
    teamSlotAdd: evmSignature("teamSlotAdd"),
    unlockCreatorBuy: evmSignature("unlockCreatorBuy"),
    claim: evmSignature("claim"),
    teamShareBuy: evmSignature("teamShareBuy"),
    setTraderRef: evmSignature("setTraderRef"),
    bindHandle: evmSignature("bindHandle"),
    claimPayoutTo: evmSignature("claimPayoutTo"),
} as const;
export const EVM_V2_TX_VIEWS = {
    traderRef: { sig: evmSignature("traderRef"), ret: ["address[3]"] },
    launchCount: { sig: evmSignature("launchCount"), ret: ["uint256"] },
    predictToken: { sig: evmSignature("predictToken"), ret: ["address"] },
} as const;
const NATIVE = "0x0000000000000000000000000000000000000000";
const MAX_NAME = 32;
const MAX_SYMBOL = 10;
const U128 = (1n << 128n) - 1n;
const call = (to: string, sig: string, args: AbiValue[], value = 0n): EvmCall => ({ to: checksumAddress(to), data: bytesToHex(encodeCall(sig, args)), value });
const deadlineOf = (d: bigint | undefined): bigint => d ?? (1n << 256n) - 1n;
export interface CreateParamsV2 {
    presetId: number;
    quote: string;
    name: string;
    symbol: string;
    creatorBuy?: bigint;
    creatorBuyMinTokens?: bigint;
    sameAddressEverywhere?: boolean;
    creatorSalt?: string;
    quoteUsdCentsX64?: bigint;
}
export function createLaunchCallV2(p: {
    floorAmm: string;
    params: CreateParamsV2;
    teamSlotMaxBps: number;
    createFee: bigint;
    listed: boolean;
    teamBuyMax?: bigint;
    registry?: {
        entry: RegistryPrice;
        now: bigint;
    };
}): EvmCall {
    const q = p.params;
    if ("uri" in (q as object))
        throw new RangeError("no uri: the token's uri is derived (metadataBase/<token>.json)");
    const enc = new TextEncoder();
    const nl = enc.encode(q.name).length;
    const sl = enc.encode(q.symbol).length;
    if (nl === 0 || sl === 0 || nl > MAX_NAME || sl > MAX_SYMBOL)
        throw new RangeError("name 1..32, symbol 1..10 bytes (BadArgument)");
    if (!Number.isInteger(q.presetId) || q.presetId <= 0 || q.presetId > 255)
        throw new RangeError("presetId is a u8 > 0 (id 0 reserved)");
    if (q.presetId === 2)
        throw new RangeError("preset id 2 is retired");
    const rate = p.teamSlotMaxBps;
    if (!Number.isInteger(rate) || rate < 0 || rate > 65535)
        throw new RangeError("teamSlotMaxBps is a u16");
    const buy = q.creatorBuy ?? 0n;
    const minTok = q.creatorBuyMinTokens ?? 0n;
    if (buy < 0n || minTok < 0n)
        throw new RangeError("the Team Buy and its minimum are \u2265 0");
    if (buy === 0n && minTok > 0n)
        throw new RangeError("a minimum without a Team Buy (SlippageExceeded)");
    if (p.teamBuyMax !== undefined && buy > p.teamBuyMax)
        throw new RangeError(`the Team Buy ${buy} is over the row's share ${p.teamBuyMax} (CreatorBuyTooLarge)`);
    const usd = q.quoteUsdCentsX64 ?? 0n;
    if (p.listed && usd !== 0n)
        throw new RangeError("a listed quote declares no price (BadArgument)");
    if (!p.listed && (usd === 0n || usd > U128))
        throw new RangeError("an unlisted quote declares 0 < price \u2264 2^128 \u2212 1 (BadArgument)");
    if (p.listed && p.registry)
        freshRegistryPrice(p.registry.entry, p.registry.now);
    const native = q.quote.toLowerCase() === NATIVE;
    const value = !p.listed ? p.createFee : native ? p.createFee + buy : 0n;
    const salt = hexToBytes(q.creatorSalt ?? "0x" + "00".repeat(32));
    if (salt.length !== 32)
        throw new RangeError("creatorSalt is bytes32");
    return call(p.floorAmm, EVM_V2_TX.createLaunch, [[BigInt(q.presetId), q.quote, q.name, q.symbol, buy, minTok, q.sameAddressEverywhere ?? false, salt, usd, BigInt(rate)]], value);
}
export function createApprovalV2(p: {
    listed: boolean;
    quote: string;
    createFee: bigint;
    creatorBuy?: bigint;
}): bigint {
    if (p.quote.toLowerCase() === NATIVE)
        return 0n;
    return (p.listed ? p.createFee : 0n) + (p.creatorBuy ?? 0n);
}
export type SlotMemberEvm = {
    wallet: string;
} | {
    platform: string;
    handle: string;
};
export function slotMemberKeyEvm(m: SlotMemberEvm): {
    key: string;
    kind: number;
} {
    if ("wallet" in m)
        return { key: "0x" + "00".repeat(12) + checksumAddress(m.wallet).slice(2).toLowerCase(), kind: 0 };
    return { key: teamSlotHandleId(m.platform, m.handle), kind: 1 };
}
export function teamSlotAddCallV2(p: {
    floorAmm: string;
    launchId: bigint;
    member: SlotMemberEvm;
    shares: bigint;
}): EvmCall {
    if (p.shares <= 0n)
        throw new RangeError("teamSlotAdd: shares > 0 (NothingToDo)");
    const { key, kind } = slotMemberKeyEvm(p.member);
    return call(p.floorAmm, EVM_V2_TX.teamSlotAdd, [p.launchId, hexToBytes(key), BigInt(kind), p.shares, false]);
}
export const unlockCreatorBuyCallV2 = (p: {
    floorAmm: string;
    launchId: bigint;
}): EvmCall => call(p.floorAmm, EVM_V2_TX.unlockCreatorBuy, [p.launchId]);
export const EVM_V2_TX_ONE_PRESS = {
    teamShareBuyAndClaim: evmSignature("teamShareBuyAndClaim"),
} as const;
export function teamShareBuyAndClaimCallV2(p: {
    floorAmm: string;
    launchId: bigint;
    deadline?: bigint;
    amountIn: bigint;
    minOut: bigint;
}): EvmCall {
    const amount = p.amountIn;
    if (amount < 0n)
        throw new RangeError("teamShareBuyAndClaim: amount \u2265 0 (0 = everything owed)");
    return call(p.floorAmm, EVM_V2_TX_ONE_PRESS.teamShareBuyAndClaim, [p.launchId, amount, p.minOut, deadlineOf(p.deadline)]);
}
export function teamShareBuyCallV2(p: {
    floorAmm: string;
    launchId: bigint;
    deadline?: bigint;
    amountIn: bigint;
    minOut: bigint;
}): EvmCall {
    const amount = p.amountIn;
    if (amount <= 0n)
        throw new RangeError("teamShareBuy: amount > 0");
    return call(p.floorAmm, EVM_V2_TX.teamShareBuy, [p.launchId, amount, p.minOut, deadlineOf(p.deadline)]);
}
export function setTraderRefCallV2(p: {
    floorAmm: string;
    trader: string;
    tiers: readonly [
        string,
        string,
        string
    ];
    deadline: bigint;
    authSig: string;
    traderSig?: string;
}): EvmCall {
    return call(p.floorAmm, EVM_V2_TX.setTraderRef, [p.trader, [...p.tiers], p.deadline, hexToBytes(p.authSig), hexToBytes(p.traderSig ?? "0x")]);
}
export function bindHandleCallV2(p: {
    floorAmm: string;
    handleId: string;
    wallet: string;
    quotes: readonly string[];
    deadline: bigint;
    authSig: string;
    walletSig?: string;
}): EvmCall {
    return call(p.floorAmm, EVM_V2_TX.bindHandle, [hexToBytes(p.handleId), p.wallet, [...p.quotes], p.deadline, hexToBytes(p.authSig), hexToBytes(p.walletSig ?? "0x")]);
}
export const claimPayoutToCallV2 = (p: {
    floorAmm: string;
    quote: string;
    to: string;
}): EvmCall => call(p.floorAmm, EVM_V2_TX.claimPayoutTo, [p.quote, p.to]);
export const traderRefDataV2 = (trader: string): string => bytesToHex(encodeCall(EVM_V2_TX_VIEWS.traderRef.sig, [trader]));
export const decodeTraderRefV2 = (data: string | Uint8Array): string[] => (decodeAbi(EVM_V2_TX_VIEWS.traderRef.ret, data)[0] as string[]).map((a) => checksumAddress(a));
export const predictTokenDataV2 = (creator: string, salt: string): string => bytesToHex(encodeCall(EVM_V2_TX_VIEWS.predictToken.sig, [creator, hexToBytes(salt)]));
