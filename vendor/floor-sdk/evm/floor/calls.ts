import { bytesToHex, checksumAddress, encodeAbi, hexToBytes } from "../abi.ts";
import { keccak256 } from "../keccak.ts";
import { decodeErrorResult, decodeFunctionResult, encodeFunctionData } from "../items.ts";
import type { ArgsOf, FunctionName, ResultOf } from "../items.ts";
import { EVM_TOKEN_SCALE } from "../../v2/market-evm.ts";
import { CLAIM_KNOWN, CLAIM_SHARE_BOUGHT, CLAIM_TEAM_BUY, EVM_TOKEN_DECIMALS, FLOOR_AMM_ABI, FLOOR_TOKEN_ABI, FLOOR_ZAP_ABI, MATH_ERROR_CODES, NATIVE_QUOTE } from "./iface.ts";
import { freshRegistryPrice } from "../../registryPrice.ts";
import { MAX_METADATA_BASE_LEN, MAX_NAME_LEN, MAX_SYMBOL_LEN, MAX_URI_LEN, METADATA_BASE_SCHEMES, metadataBaseOk } from "../../solana/floor/instructions.ts";
import type { RegistryPrice } from "../../registryPrice.ts";
export interface EvmCall {
    to: string;
    data: string;
    value: bigint;
}
export type FloorAmmFunction = FunctionName<typeof FLOOR_AMM_ABI>;
export type FloorZapFunction = FunctionName<typeof FLOOR_ZAP_ABI>;
export type FloorAmmArgs<N extends FloorAmmFunction> = ArgsOf<typeof FLOOR_AMM_ABI, N>;
export type FloorAmmResult<N extends FloorAmmFunction> = ResultOf<typeof FLOOR_AMM_ABI, N>;
export function floorAmmCall<N extends FloorAmmFunction>(to: string, name: N, args: FloorAmmArgs<N>, value = 0n): EvmCall {
    return { to: checksumAddress(to), data: encodeFunctionData(FLOOR_AMM_ABI, name, args as Record<string, unknown>), value };
}
export function floorZapCall<N extends FloorZapFunction>(to: string, name: N, args: ArgsOf<typeof FLOOR_ZAP_ABI, N>, value = 0n): EvmCall {
    return { to: checksumAddress(to), data: encodeFunctionData(FLOOR_ZAP_ABI, name, args as Record<string, unknown>), value };
}
export function floorTokenCall<N extends FunctionName<typeof FLOOR_TOKEN_ABI>>(token: string, name: N, args: ArgsOf<typeof FLOOR_TOKEN_ABI, N>): EvmCall {
    return { to: checksumAddress(token), data: encodeFunctionData(FLOOR_TOKEN_ABI, name, args as Record<string, unknown>), value: 0n };
}
export function decodeFloorAmmResult<N extends FloorAmmFunction>(name: N, data: string): FloorAmmResult<N> {
    return decodeFunctionResult(FLOOR_AMM_ABI, name, data) as FloorAmmResult<N>;
}
export function decodeFloorError(data: string): {
    name: string;
    args: Record<string, any>;
    mathError?: string;
} | null {
    const e = decodeErrorResult([...FLOOR_AMM_ABI, ...FLOOR_ZAP_ABI, ...FLOOR_TOKEN_ABI], data);
    if (e?.name === "MathFailed")
        return { ...e, mathError: MATH_ERROR_CODES[Number(e.args.code)] ?? `code ${e.args.code}` };
    return e;
}
const isNative = (quote: string): boolean => quote.toLowerCase() === NATIVE_QUOTE;
const valueFor = (quote: string, amount: bigint): bigint => (isNative(quote) ? amount : 0n);
const minOut = (v: bigint, what: string): bigint => {
    if (v <= 0n)
        throw new RangeError(`${what} must be > 0 (the NO_MINIMUM rule)`);
    return v;
};
export function approveCall(token: string, spender: string, amount: bigint): EvmCall {
    return floorTokenCall(token, "approve", { spender, value: amount });
}
export function deadlineArg(d: bigint | undefined): bigint {
    if (d === undefined)
        return 0n;
    if (d < 0n || d > 100000000000n)
        throw new RangeError(`deadline ${d} is not unix seconds (0 = none; a millisecond clock reads as no deadline)`);
    return d;
}
export function buyCall(p: {
    floorAmm: string;
    quote: string;
    launchId: bigint;
    amountIn: bigint;
    minTokensOut: bigint;
    to: string;
    deadline?: bigint;
}): EvmCall {
    if (p.amountIn <= 0n)
        throw new RangeError("amountIn must be > 0");
    return floorAmmCall(p.floorAmm, "buy", { launchId: p.launchId, amountIn: p.amountIn, minTokensOut: minOut(p.minTokensOut, "minTokensOut"), to: p.to, deadline: deadlineArg(p.deadline) }, valueFor(p.quote, p.amountIn));
}
export function teamShareBuyCall(p: {
    floorAmm: string;
    launchId: bigint;
    amount: bigint;
    minTokensOut: bigint;
    deadline?: bigint;
}): EvmCall {
    if (p.amount < 0n)
        throw new RangeError("amount must be \u2265 0 (0 = everything claimable)");
    return floorAmmCall(p.floorAmm, "teamShareBuy", { launchId: p.launchId, amount: p.amount, minTokensOut: minOut(p.minTokensOut, "minTokensOut"), deadline: deadlineArg(p.deadline) });
}
export const teamShareOfCall = (p: {
    floorAmm: string;
    launchId: bigint;
    wallet: string;
}): EvmCall => floorAmmCall(p.floorAmm, "teamShareOf", { launchId: p.launchId, wallet: p.wallet });
export function sellCall(p: {
    floorAmm: string;
    launchId: bigint;
    tokensIn: bigint;
    minQuoteOut: bigint;
    to: string;
    deadline?: bigint;
}): EvmCall {
    const tokensIn = p.tokensIn - (p.tokensIn % EVM_TOKEN_SCALE);
    minOut(p.minQuoteOut, "minQuoteOut");
    if (tokensIn <= 0n)
        throw new RangeError("tokensIn must be at least one TOKEN_SCALE (10^12)");
    return floorAmmCall(p.floorAmm, "sell", { launchId: p.launchId, tokensIn, minQuoteOut: minOut(p.minQuoteOut, "minQuoteOut"), to: p.to, deadline: deadlineArg(p.deadline) });
}
export const buyFromBalanceCall = (p: {
    floorAmm: string;
    launchId: bigint;
    minTokensOut: bigint;
    to: string;
    refundTo: string;
    deadline?: bigint;
}): EvmCall => floorAmmCall(p.floorAmm, "buyFromBalance", { launchId: p.launchId, minTokensOut: minOut(p.minTokensOut, "minTokensOut"), to: p.to, refundTo: p.refundTo, deadline: deadlineArg(p.deadline) });
export const sellFromBalanceCall = (p: {
    floorAmm: string;
    launchId: bigint;
    minQuoteOut: bigint;
    to: string;
    deadline?: bigint;
}): EvmCall => floorAmmCall(p.floorAmm, "sellFromBalance", { launchId: p.launchId, minQuoteOut: minOut(p.minQuoteOut, "minQuoteOut"), to: p.to, deadline: deadlineArg(p.deadline) });
export { MAX_NAME_LEN, MAX_SYMBOL_LEN, MAX_URI_LEN };
type CreateParams = FloorAmmArgs<"createLaunch">["p"];
export type CreateLaunchParams = Omit<CreateParams, "sameAddressEverywhere" | "creatorSalt" | "quoteUsdCentsX64" | "creatorBuy" | "creatorBuyMinTokens" | "teamSlotRateBps"> & Partial<Pick<CreateParams, "sameAddressEverywhere" | "creatorSalt" | "quoteUsdCentsX64" | "creatorBuy" | "creatorBuyMinTokens" | "teamSlotRateBps">>;
export function createTeamBuy(p: {
    params: CreateLaunchParams;
}): {
    creatorBuy: bigint;
    creatorBuyMinTokens: bigint;
} {
    const creatorBuy = p.params.creatorBuy ?? 0n;
    const creatorBuyMinTokens = p.params.creatorBuyMinTokens ?? 0n;
    if (creatorBuy < 0n || creatorBuyMinTokens < 0n)
        throw new RangeError("creatorBuy and creatorBuyMinTokens are \u2265 0");
    if (creatorBuy === 0n && creatorBuyMinTokens !== 0n)
        throw new RangeError("no Team Buy (creatorBuy 0): creatorBuyMinTokens must be 0");
    return { creatorBuy, creatorBuyMinTokens };
}
export const MAX_QUOTE_USD_CENTS_X64 = (1n << 128n) - 1n;
export const createQuoteTotal = (p: {
    createFee: bigint;
    params: CreateLaunchParams;
    registry?: {
        entry: RegistryPrice;
        now: bigint;
    };
}): bigint => ((p.params.quoteUsdCentsX64 ?? 0n) > 0n ? 0n : p.createFee) + createTeamBuy(p).creatorBuy;
export function createLaunchCall(p: {
    floorAmm: string;
    createFee: bigint;
    params: CreateLaunchParams;
    nativeCreateFee?: bigint;
    registry?: {
        entry: RegistryPrice;
        now: bigint;
    };
}): EvmCall {
    const enc = new TextEncoder();
    const params: CreateParams = { ...p.params, ...createTeamBuy(p), sameAddressEverywhere: p.params.sameAddressEverywhere ?? false, creatorSalt: p.params.creatorSalt ?? "0x" + "00".repeat(32), quoteUsdCentsX64: p.params.quoteUsdCentsX64 ?? 0n, teamSlotRateBps: p.params.teamSlotRateBps ?? 0n };
    if (params.teamSlotRateBps < 0n || params.teamSlotRateBps > 0xffffn)
        throw new RangeError(`the Team Slot's rate is a u16 (bps, 0 ..= the row's max): ${params.teamSlotRateBps}`);
    if (p.registry && params.quoteUsdCentsX64 === 0n)
        freshRegistryPrice(p.registry.entry, p.registry.now);
    if (params.sameAddressEverywhere && /^0x0{64}$/i.test(params.creatorSalt))
        throw new RangeError("sameAddressEverywhere needs a creatorSalt");
    if ("uri" in (p.params as object))
        throw new RangeError("v1.3f: createLaunch takes no uri \u2014 the token's is derived on chain, <metadataBase()>/<token>.json (evmMetadataUri)");
    if (enc.encode(p.params.name).length > MAX_NAME_LEN || enc.encode(p.params.symbol).length > MAX_SYMBOL_LEN)
        throw new RangeError("name \u2264 32, symbol \u2264 10 bytes");
    if (params.creatorBuy > 0n)
        minOut(params.creatorBuyMinTokens, "creatorBuyMinTokens");
    if (params.quoteUsdCentsX64 < 0n || params.quoteUsdCentsX64 > MAX_QUOTE_USD_CENTS_X64)
        throw new RangeError("quoteUsdCentsX64 is 0 (listed) or in (0, 2^128 - 1] (unlisted)");
    if (params.quoteUsdCentsX64 > 0n) {
        if (isNative(params.quote))
            throw new RangeError("the native coin is never an unlisted quote (quoteUsdCentsX64 must be 0)");
        if (p.nativeCreateFee === undefined)
            throw new RangeError("an unlisted quote's create pays nativeCreateFee() as value: pass nativeCreateFee");
        return floorAmmCall(p.floorAmm, "createLaunch", { p: params }, p.nativeCreateFee);
    }
    return floorAmmCall(p.floorAmm, "createLaunch", { p: params }, valueFor(p.params.quote, p.createFee + params.creatorBuy));
}
export { MAX_METADATA_BASE_LEN, METADATA_BASE_SCHEMES, metadataBaseOk };
export function evmMetadataUri(base: string, token: string): string {
    if (!/^0x[0-9a-fA-F]{40}$/.test(token))
        throw new RangeError("token is a 20-byte 0x address");
    return `${base}/${token.toLowerCase()}.json`;
}
export function setMetadataBaseCall(p: {
    floorAmm: string;
    base: string;
}): EvmCall {
    if (!metadataBaseOk(p.base))
        throw new RangeError("the metadata base is \"\" or https:// \u00B7 ipfs:// \u00B7 ar://, printable ASCII, no space, no trailing slash, \u2264 72 bytes (MetadataBaseInvalid)");
    return floorAmmCall(p.floorAmm, "setMetadataBase", { base: p.base });
}
export const metadataBaseCall = (floorAmm: string): EvmCall => floorAmmCall(floorAmm, "metadataBase", {});
export const decodeMetadataBase = (data: string): string => (decodeFloorAmmResult("metadataBase", data) as Record<string, unknown>)["0"] as string;
export const setPriceUpdaterCall = (p: {
    floorAmm: string;
    updater: string;
}): EvmCall => floorAmmCall(p.floorAmm, "setPriceUpdater", { updater: p.updater });
export function setQuotePriceCall(p: {
    floorAmm: string;
    token: string;
    usdCentsX64: bigint;
}): EvmCall {
    if (p.usdCentsX64 <= 0n || p.usdCentsX64 > MAX_QUOTE_USD_CENTS_X64)
        throw new RangeError("usdCentsX64 is in (0, 2^128 - 1] (BadArgument)");
    return floorAmmCall(p.floorAmm, "setQuotePrice", { token: p.token, usdCentsX64: p.usdCentsX64 });
}
export const priceUpdaterCall = (floorAmm: string): EvmCall => floorAmmCall(floorAmm, "priceUpdater", {});
export function decodePriceUpdater(data: string): string | null {
    const a = (decodeFloorAmmResult("priceUpdater", data) as Record<string, unknown>)["0"] as string;
    return a.toLowerCase() === NATIVE_QUOTE ? null : checksumAddress(a);
}
export const quoteEntryCall = (floorAmm: string, token: string): EvmCall => floorAmmCall(floorAmm, "quoteEntry", { token });
export type EvmQuoteEntry = {
    listed: boolean;
    enabled: boolean;
    decimals: bigint;
    createFee: bigint;
    usdCentsX64: bigint;
    launches: bigint;
    updatedAt: bigint;
};
export const decodeQuoteEntry = (data: string): EvmQuoteEntry => (decodeFloorAmmResult("quoteEntry", data) as Record<string, unknown>)["0"] as EvmQuoteEntry;
export function teamSlotAddCall(p: {
    floorAmm: string;
    quote?: string;
    launchId: bigint;
    key: string;
    kind: number;
    amount: bigint;
    payNow?: boolean;
}): EvmCall {
    if (p.amount <= 0n)
        throw new RangeError("a Team Slot place takes > 0 shares");
    return floorAmmCall(p.floorAmm, "teamSlotAdd", { launchId: p.launchId, key: p.key, kind: BigInt(p.kind), amount: p.amount, payNow: p.payNow ?? true });
}
export const walletKey = (wallet: string): string => "0x" + "00".repeat(12) + checksumAddress(wallet).slice(2).toLowerCase();
export function handleKey(platform: string, handle: string): string {
    const p = platform.trim().toLowerCase();
    const h = handle.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9]+$/.test(p))
        throw new RangeError(`a platform is a lowercase short name, got ${JSON.stringify(platform)}`);
    if (h.length === 0 || /\s|@|:/.test(h))
        throw new RangeError(`a handle has no spaces, no '@' but a leading one, no ':': ${JSON.stringify(handle)}`);
    return bytesToHex(keccak256(new TextEncoder().encode(`${p}:${h}`)));
}
export function claimCall(p: {
    floorAmm: string;
    wallet: string;
    types: number;
    quotes: readonly string[];
    launchIds?: readonly bigint[];
}): EvmCall {
    if ((p.types & ~CLAIM_KNOWN) !== 0 || p.types === 0)
        throw new RangeError("UnknownClaimType: the claim takes bits 1, 2, 4, 8, 16, 32, 64, 128, 256");
    const perLaunch = CLAIM_TEAM_BUY | CLAIM_SHARE_BOUGHT;
    const tokens = (p.types & perLaunch) !== 0;
    if (tokens && (p.launchIds ?? []).length === 0)
        throw new RangeError("bits 128 / 256 (the base token) claim per launch: name the launchIds");
    if (p.quotes.length === 0 && (p.types & ~perLaunch) !== 0)
        throw new RangeError("claim at least one quote");
    return floorAmmCall(p.floorAmm, "claim", { wallet: p.wallet, types: BigInt(p.types), launchIds: [...(p.launchIds ?? [])], quotes_: [...p.quotes] });
}
const eip191 = (digest: Uint8Array): string => bytesToHex(keccak256(Uint8Array.of(...new TextEncoder().encode("\u0019Ethereum Signed Message:\n32"), ...digest)));
export function traderRefDigest(p: {
    chainId: bigint;
    floorAmm: string;
    trader: string;
    tiers: readonly [
        string,
        string,
        string
    ];
}): {
    digest: string;
    message: string;
} {
    const d = keccak256(encodeAbi(["string", "uint256", "address", "address", "address[3]"], ["floor.amm.traderRef.v1", p.chainId, p.floorAmm, p.trader, [...p.tiers]]));
    return { digest: bytesToHex(d), message: eip191(d) };
}
export function bindHandleDigest(p: {
    chainId: bigint;
    floorAmm: string;
    handleId: string;
    wallet: string;
}): {
    digest: string;
    message: string;
} {
    const d = keccak256(encodeAbi(["string", "uint256", "address", "bytes32", "address"], ["floor.amm.bindHandle.v1", p.chainId, p.floorAmm, hexToBytes(p.handleId), p.wallet]));
    return { digest: bytesToHex(d), message: eip191(d) };
}
export function traderRefAuthDigest(p: {
    chainId: bigint;
    floorAmm: string;
    trader: string;
    tiers: readonly [
        string,
        string,
        string
    ];
    deadline: bigint;
}): {
    digest: string;
    message: string;
} {
    const d = keccak256(encodeAbi(["string", "uint256", "address", "address", "address[3]", "uint256"], ["floor.amm.traderRef.auth.v1", p.chainId, p.floorAmm, p.trader, [...p.tiers], p.deadline]));
    return { digest: bytesToHex(d), message: eip191(d) };
}
export function bindHandleAuthDigest(p: {
    chainId: bigint;
    floorAmm: string;
    handleId: string;
    wallet: string;
    quotes: readonly string[];
    deadline: bigint;
}): {
    digest: string;
    message: string;
} {
    const d = keccak256(encodeAbi(["string", "uint256", "address", "bytes32", "address", "address[]", "uint256"], ["floor.amm.bindHandle.auth.v1", p.chainId, p.floorAmm, hexToBytes(p.handleId), p.wallet, [...p.quotes], p.deadline]));
    return { digest: bytesToHex(d), message: eip191(d) };
}
export function setTraderRefCall(p: {
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
    return floorAmmCall(p.floorAmm, "setTraderRef", { trader: p.trader, tiers: [...p.tiers], deadline: p.deadline, authSig: p.authSig, traderSig: p.traderSig ?? "0x" });
}
export function bindHandleCall(p: {
    floorAmm: string;
    handleId: string;
    wallet: string;
    quotes: readonly string[];
    deadline: bigint;
    authSig: string;
    walletSig?: string;
}): EvmCall {
    return floorAmmCall(p.floorAmm, "bindHandle", { handleId: p.handleId, wallet: p.wallet, quotes_: [...p.quotes], deadline: p.deadline, authSig: p.authSig, walletSig: p.walletSig ?? "0x" });
}
export function claimPayoutToCall(p: {
    floorAmm: string;
    quote: string;
    to: string;
}): EvmCall {
    return floorAmmCall(p.floorAmm, "claimPayoutTo", { quote: p.quote, to: p.to });
}
export function buyWithEthCall(p: {
    zap: string;
    launchId: bigint;
    ethIn: bigint;
    swapData: string;
    minQuoteIn: bigint;
    minTokensOut: bigint;
    to: string;
    deadline?: bigint;
}): EvmCall {
    if (p.ethIn <= 0n)
        throw new RangeError("ethIn must be > 0");
    return floorZapCall(p.zap, "buyWithEth", { launchId: p.launchId, swapData: p.swapData, minQuoteIn: minOut(p.minQuoteIn, "minQuoteIn"), minTokensOut: minOut(p.minTokensOut, "minTokensOut"), to: p.to, deadline: deadlineArg(p.deadline) }, p.ethIn);
}
export function buyWithTokenCall(p: {
    zap: string;
    launchId: bigint;
    tokenIn: string;
    amountIn: bigint;
    swapData: string;
    minQuoteIn: bigint;
    minTokensOut: bigint;
    to: string;
    deadline?: bigint;
}): EvmCall {
    if (p.amountIn <= 0n)
        throw new RangeError("amountIn must be > 0");
    return floorZapCall(p.zap, "buyWithToken", {
        launchId: p.launchId,
        tokenIn: p.tokenIn,
        amountIn: p.amountIn,
        swapData: p.swapData,
        minQuoteIn: minOut(p.minQuoteIn, "minQuoteIn"),
        minTokensOut: minOut(p.minTokensOut, "minTokensOut"),
        to: p.to,
        deadline: deadlineArg(p.deadline),
    });
}
