import { beginCell, Builder, snakeCell } from "./cell.ts";
import type { Cell } from "./cell.ts";
import { accountAddress, accountData, addr, traderAddress, traderData, launchWalletAddress } from "./addresses.ts";
import { op, STD_OP } from "./ops.ts";
import { getGasParams } from "./reader.ts";
import { tonLaunchIdsCell } from "./governance.ts";
import { defaultClaimValue, defaultReclaimValue, defaultTeamShareBuyValue, fallbackMinValue, traderDeployValue, pushChildMin } from "./gas.ts";
import type { TonRpc } from "./reader.ts";
import { TON_CLAIM_KNOWN, DEFAULT_GAS, REFERRED_HOP, REFERRED_FWD_MIN, REFERRED_SELL_FWD_MIN, REFERRED_GIFT_FWD_MIN, REFERRED_FWD_DEFAULT, REFERRED_SELL_FWD_DEFAULT, REFERRED_GIFT_FWD_DEFAULT, REFERRED_SELL_GIFT_FWD_DEFAULT } from "./types.ts";
import type { AddressLike, TonBuyArgs, TonBuyJettonArgs, TonTeamShareBuyArgs, TonBuyReferredArgs, TonBuyReferredJettonArgs, TonClaimArgs, TonCreateArgs, TonSellArgs, TonSellReferredArgs, TonChain, TonMessage, TonTx, } from "./types.ts";
const U32 = 4294967295;
const U16 = 65535;
const BUY_FWD_FLOOR = 120000000n;
const GAS_WALLET_HOP = 50000000n;
const GAS_CLAIM = 150000000n;
const GAS_DEPLOY = 500000000n;
const GAS_SMALL = 50000000n;
const GAS_CHECK_PRESET = 200000000n;
function u32(v: number, what: string): number {
    if (!Number.isInteger(v) || v < 0 || v > U32)
        throw new RangeError(`${what} out of uint32 range`);
    return v;
}
function pos(v: bigint, what: string): bigint {
    if (v < 0n)
        throw new RangeError(`${what} is negative`);
    return v;
}
export function bodyOf(name: string, queryId: bigint = 0n): Builder {
    return beginCell().storeUint(op(name), 32).storeUint(queryId, 64);
}
const msg = (to: AddressLike, value: bigint, body: Cell, bounce = true): TonMessage => ({ to: addr(to), value, bounce, body });
const tx = (...messages: TonMessage[]): TonTx => ({ family: "ton", messages });
export function buyBody(a: Pick<TonBuyArgs, "queryId" | "money" | "minTokens" | "deadline" | "recipient" | "referrer">): Cell {
    return bodyOf("buy", a.queryId)
        .storeCoins(pos(a.money, "money"))
        .storeCoins(pos(a.minTokens, "minTokens"))
        .storeUint(u32(a.deadline, "deadline"), 32)
        .storeAddress(addr(a.recipient))
        .storeMaybeAddress(a.referrer ? addr(a.referrer) : null)
        .endCell();
}
export function floorBuyPayload(a: Pick<TonBuyArgs, "minTokens" | "deadline" | "recipient" | "referrer">): Cell {
    return beginCell()
        .storeUint(op("floor_buy"), 32)
        .storeCoins(pos(a.minTokens, "minTokens"))
        .storeUint(u32(a.deadline, "deadline"), 32)
        .storeAddress(addr(a.recipient))
        .storeMaybeAddress(a.referrer ? addr(a.referrer) : null)
        .endCell();
}
export function floorSellPayload(a: Pick<TonSellArgs, "minOut" | "deadline" | "recipient">): Cell {
    return beginCell()
        .storeUint(op("floor_sell"), 32)
        .storeCoins(pos(a.minOut, "minOut"))
        .storeUint(u32(a.deadline, "deadline"), 32)
        .storeAddress(addr(a.recipient))
        .endCell();
}
export function jettonTransferBody(a: {
    queryId?: bigint;
    amount: bigint;
    destination: AddressLike;
    responseDestination: AddressLike;
    forwardTon: bigint;
    payload: Cell | null;
}): Cell {
    const b = beginCell()
        .storeUint(STD_OP.transfer, 32)
        .storeUint(a.queryId ?? 0n, 64)
        .storeCoins(pos(a.amount, "amount"))
        .storeAddress(addr(a.destination))
        .storeAddress(addr(a.responseDestination))
        .storeBit(0)
        .storeCoins(pos(a.forwardTon, "forwardTon"));
    if (a.payload)
        b.storeBit(1).storeRef(a.payload);
    else
        b.storeBit(0);
    return b.endCell();
}
export function buildBuyGram(a: TonBuyArgs): TonTx {
    const gas = a.gas ?? DEFAULT_GAS.buyFwdMin;
    return tx(msg(a.launch, pos(a.money, "money") + gas, buyBody(a)));
}
const sameAddr = (a: AddressLike, b: AddressLike): boolean => addr(a).equals(addr(b));
function doorDeploy(chain: Pick<TonChain, "codes" | "factory">, who: AddressLike): TonMessage {
    return { to: traderAddress(chain, who), value: traderDeployValue(), bounce: false, body: bodyOf("top_up").endCell(), stateInit: { code: chain.codes.trader, data: traderData(chain.factory, who) } };
}
export function buildBuyReferred(chain: Pick<TonChain, "codes" | "factory">, a: TonBuyReferredArgs, deployTrader = false): TonTx {
    const gas = a.gas ?? DEFAULT_GAS.buyFwdMin;
    const door = a.recipient;
    const gift = sameAddr(door, a.trader) ? 0n : fallbackMinValue();
    const body = bodyOf("buy_referred", a.queryId).storeAddress(addr(a.launch)).storeRef(buyBody(a)).endCell();
    const m: TonMessage = { to: traderAddress(chain, door), value: pos(a.money, "money") + gas + GAS_SMALL + gift, bounce: !deployTrader, body };
    if (deployTrader)
        m.stateInit = { code: chain.codes.trader, data: traderData(chain.factory, door) };
    return tx(m);
}
export function buildBuyJetton(a: TonBuyJettonArgs): TonTx {
    const fwd = a.forwardTon ?? DEFAULT_GAS.buyFwdMin;
    if (fwd < BUY_FWD_FLOOR && a.forwardTon !== undefined)
        throw new RangeError("forwardTon under buy_fwd_min");
    const body = jettonTransferBody({
        queryId: a.queryId,
        amount: a.money,
        destination: a.launch,
        responseDestination: a.buyer,
        forwardTon: fwd,
        payload: floorBuyPayload(a),
    });
    return tx(msg(a.buyerQuoteWallet, fwd + (a.walletGas ?? GAS_WALLET_HOP), body));
}
export function buildBuyReferredJetton(chain: Pick<TonChain, "codes" | "factory">, a: TonBuyReferredJettonArgs): TonTx {
    const own = sameAddr(a.recipient, a.trader);
    const min = own ? REFERRED_FWD_MIN : REFERRED_GIFT_FWD_MIN;
    const fwd = a.forwardTon ?? (own ? REFERRED_FWD_DEFAULT : REFERRED_GIFT_FWD_DEFAULT);
    if (fwd < min)
        throw new RangeError("forwardTon under referred_fwd_min");
    const payload = bodyOf("buy_referred", a.queryId).storeAddress(addr(a.launch)).storeRef(floorBuyPayload(a)).endCell();
    const body = jettonTransferBody({
        queryId: a.queryId,
        amount: a.money,
        destination: traderAddress(chain, a.recipient),
        responseDestination: a.trader,
        forwardTon: fwd,
        payload,
    });
    const m = msg(a.buyerQuoteWallet, fwd + (a.walletGas ?? GAS_WALLET_HOP), body);
    return a.deployTrader ? { family: "ton", messages: [doorDeploy(chain, a.recipient), m] } : tx(m);
}
export function buildSellReferred(chain: Pick<TonChain, "codes" | "factory">, a: TonSellReferredArgs): TonTx {
    if (a.tokens <= 0n)
        throw new RangeError("tokens must be positive");
    const own = sameAddr(a.recipient, a.seller);
    const min = own ? REFERRED_SELL_FWD_MIN : REFERRED_GIFT_FWD_MIN;
    const fwd = a.forwardTon ?? (own ? REFERRED_SELL_FWD_DEFAULT : REFERRED_SELL_GIFT_FWD_DEFAULT);
    if (fwd < min)
        throw new RangeError("forwardTon under referred_sell_fwd_min");
    const wallet = a.sellerWallet ?? launchWalletAddress(chain, a.launch, a.seller);
    const payload = bodyOf("sell_referred", a.queryId).storeAddress(addr(a.launch)).storeRef(floorSellPayload(a)).endCell();
    const body = jettonTransferBody({
        queryId: a.queryId,
        amount: a.tokens,
        destination: traderAddress(chain, a.recipient),
        responseDestination: a.seller,
        forwardTon: fwd,
        payload,
    });
    const m = msg(wallet, fwd + (a.walletGas ?? GAS_WALLET_HOP), body);
    return a.deployTrader ? { family: "ton", messages: [doorDeploy(chain, a.recipient), m] } : tx(m);
}
export function buildSell(chain: Pick<TonChain, "codes">, a: TonSellArgs): TonTx {
    const floor = a.gasParams?.sellFwdMin;
    const fwd = a.forwardTon ?? floor ?? DEFAULT_GAS.sellFwdMin;
    if (floor !== undefined && fwd < floor)
        throw new RangeError("forwardTon under sell_fwd_min");
    if (a.tokens <= 0n)
        throw new RangeError("tokens must be positive");
    const wallet = a.sellerWallet ?? launchWalletAddress(chain, a.launch, a.seller);
    const body = jettonTransferBody({
        queryId: a.queryId,
        amount: a.tokens,
        destination: a.launch,
        responseDestination: a.seller,
        forwardTon: fwd,
        payload: floorSellPayload(a),
    });
    return tx(msg(wallet, fwd + (a.walletGas ?? GAS_WALLET_HOP), body));
}
export async function buildSellFromLaunch(rpc: TonRpc, chain: Pick<TonChain, "codes">, a: TonSellArgs): Promise<TonTx> {
    return buildSell(chain, { ...a, gasParams: a.gasParams ?? (await getGasParams(rpc, a.launch)) });
}
export function buildClaim(chain: Pick<TonChain, "codes">, a: TonClaimArgs): TonTx {
    if (!Number.isInteger(a.types) || a.types <= 0 || a.types > U16)
        throw new RangeError("claim types out of uint16 range");
    if ((a.types & ~TON_CLAIM_KNOWN) !== 0)
        throw new RangeError("unknown claim bit (32 is reserved and refused)");
    const body = bodyOf("claim", a.queryId).storeUint(a.types, 16).storeAddress(a.to ? addr(a.to) : null).endCell();
    const m = msg(accountAddress(chain, a.launch, a.owner), a.gas ?? defaultClaimValue(a.types), body);
    if (a.deploy !== false)
        m.stateInit = { code: chain.codes.account, data: accountData(a.launch, a.owner) };
    return tx(m);
}
function launchMeta(a: Pick<TonCreateArgs, "name" | "symbol" | "uri">): Cell {
    if (!a.name || !a.symbol)
        throw new RangeError("name and symbol are required");
    return beginCell().storeRef(snakeCell(a.name)).storeRef(snakeCell(a.symbol)).storeRef(snakeCell(a.uri)).endCell();
}
function teamSpec(t: TonCreateArgs["team"]): Cell {
    if (!Number.isInteger(t.slotBps) || t.slotBps < 0 || t.slotBps > U16)
        throw new RangeError("slotBps out of uint16 range");
    const refs = beginCell();
    for (let i = 0; i < 3; i++)
        refs.storeMaybeAddress(t.creatorRefs?.[i] ? addr(t.creatorRefs[i]!) : null);
    const b = beginCell().storeUint(t.slotBps, 16);
    if (t.creatorHandle !== undefined)
        b.storeBit(1).storeUint(t.creatorHandle, 256);
    else
        b.storeBit(0);
    return b.storeRef(refs.endCell()).endCell();
}
export function createBody(a: TonCreateArgs): Cell {
    return bodyOf("create_launch", a.queryId)
        .storeUint(u32(a.presetId, "presetId"), 32)
        .storeAddress(a.quote ? addr(a.quote) : null)
        .storeBit(a.listed)
        .storeRef(launchMeta(a))
        .storeRef(teamSpec(a.team))
        .storeCoins(pos(a.teamBuyMoney, "teamBuyMoney"))
        .storeCoins(pos(a.teamBuyMinTokens, "teamBuyMinTokens"))
        .storeMaybeAddress(a.creatorRef ? addr(a.creatorRef) : null)
        .storeUint(u32(a.deadline, "deadline"), 32)
        .endCell();
}
export function buildCreate(chain: Pick<TonChain, "factory">, a: TonCreateArgs): TonTx {
    const total = pos(a.createFee, "createFee") + pos(a.teamBuyMoney, "teamBuyMoney");
    const body = createBody(a);
    if (!a.quote)
        return tx(msg(chain.factory, total + (a.deployGas ?? GAS_DEPLOY), body));
    if (!a.creatorQuoteWallet)
        throw new RangeError("a jetton-quoted create needs the creator's quote wallet");
    const fwd = a.forwardTon ?? GAS_DEPLOY;
    const t = jettonTransferBody({
        queryId: a.queryId,
        amount: total,
        destination: chain.factory,
        responseDestination: a.creator,
        forwardTon: fwd,
        payload: body,
    });
    return tx(msg(a.creatorQuoteWallet, fwd + (a.walletGas ?? GAS_WALLET_HOP), t));
}
export function buildOptIn(chain: Pick<TonChain, "codes">, a: {
    launch: AddressLike;
    owner: AddressLike;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    return tx(msg(launchWalletAddress(chain, a.launch, a.owner), a.gas ?? GAS_SMALL, bodyOf("opt_in", a.queryId).endCell()));
}
export function buildUnlockCreatorBuy(a: {
    launch: AddressLike;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    return tx(msg(a.launch, a.gas ?? GAS_CLAIM, bodyOf("unlock_creator_buy", a.queryId).endCell()));
}
export function creditBackingBody(a: {
    money: bigint;
    queryId?: bigint;
}): Cell {
    return bodyOf("credit_backing", a.queryId).storeCoins(pos(a.money, "money")).endCell();
}
export function buildCreditBacking(a: {
    launch: AddressLike;
    money: bigint;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    return tx(msg(a.launch, a.money + (a.gas ?? GAS_SMALL), creditBackingBody(a)));
}
export function teamShareBuyBody(a: TonTeamShareBuyArgs): Cell {
    if (!Number.isInteger(a.place) || a.place < 0 || a.place > 9)
        throw new RangeError("place out of 0..9");
    return bodyOf("team_share_buy", a.queryId).storeUint(a.place, 8).storeCoins(pos(a.money, "money")).storeCoins(pos(a.minTokens, "minTokens"))
        .storeUint(u32(a.deadline, "deadline"), 32).storeBit(a.thenClaim ?? false).endCell();
}
export function buildTeamShareBuy(a: TonTeamShareBuyArgs): TonTx {
    return tx(msg(a.launch, a.gas ?? defaultTeamShareBuyValue(false, a.thenClaim ?? false), teamShareBuyBody(a)));
}
export function buildTeamShareBuyReferred(chain: Pick<TonChain, "codes" | "factory">, a: TonTeamShareBuyArgs & {
    member: AddressLike;
}): TonTx {
    const body = bodyOf("team_share_buy_referred", a.queryId).storeAddress(addr(a.launch)).storeRef(teamShareBuyBody(a)).endCell();
    return tx({ to: traderAddress(chain, a.member), value: a.gas === undefined ? defaultTeamShareBuyValue(true, a.thenClaim ?? false) : a.gas + REFERRED_HOP, bounce: true, body });
}
export function buildTeamSlotAdd(a: {
    launch: AddressLike;
    member?: AddressLike;
    handle?: bigint;
    shares: bigint;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    if ((a.member === undefined) === (a.handle === undefined))
        throw new RangeError("team_slot_add takes a member or a handle, not both or neither");
    if (a.shares <= 0n || a.shares >= 1n << 64n)
        throw new RangeError("shares out of 1..2^64-1");
    const b = bodyOf("team_slot_add", a.queryId).storeAddress(a.member === undefined ? null : addr(a.member));
    if (a.handle !== undefined) {
        if (a.handle < 0n || a.handle >= 1n << 256n)
            throw new RangeError("handle out of uint256 range");
        b.storeBit(1).storeUint(a.handle, 256);
    }
    else
        b.storeBit(0);
    b.storeUint(a.shares, 64);
    return tx(msg(a.launch, a.gas ?? GAS_SMALL, b.endCell()));
}
export function buildBurnTeam(a: {
    launch: AddressLike;
    tokens: bigint;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    return tx(msg(a.launch, a.gas ?? GAS_SMALL, bodyOf("burn_team", a.queryId).storeCoins(pos(a.tokens, "tokens")).endCell()));
}
export function buildSetTraderRef(chain: Pick<TonChain, "codes" | "factory">, a: {
    trader: AddressLike;
    referrer: AddressLike;
    deploy?: boolean;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    const m: TonMessage = {
        to: traderAddress(chain, a.trader),
        value: a.gas ?? GAS_SMALL,
        bounce: !a.deploy,
        body: bodyOf("set_trader_ref", a.queryId).storeAddress(addr(a.referrer)).endCell(),
    };
    if (a.deploy)
        m.stateInit = { code: chain.codes.trader, data: traderData(chain.factory, a.trader) };
    return tx(m);
}
export function buildSyncQuote(a: {
    launch: AddressLike;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    return tx(msg(a.launch, a.gas ?? GAS_SMALL, bodyOf("sync_quote", a.queryId).endCell()));
}
export function buildReclaimPayout(chain: Pick<TonChain, "codes">, a: {
    launch: AddressLike;
    payee: AddressLike;
    payoutId: bigint;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    const body = bodyOf("reclaim_payout", a.queryId).storeUint(a.payoutId, 64).endCell();
    return tx(msg(accountAddress(chain, a.launch, a.payee), a.gas ?? defaultReclaimValue(), body));
}
export function buildTopUp(a: {
    to: AddressLike;
    value: bigint;
    queryId?: bigint;
}): TonTx {
    return tx(msg(a.to, pos(a.value, "value"), bodyOf("top_up", a.queryId).endCell()));
}
const ADDR_LIST_MAX = 32;
export function addrListCell(owners: AddressLike[]): Cell {
    if (owners.length === 0 || owners.length > ADDR_LIST_MAX)
        throw new RangeError(`owners: 1..${ADDR_LIST_MAX}`);
    let next: Cell | null = null;
    for (let i = Math.floor((owners.length - 1) / 3) * 3; i >= 0; i -= 3) {
        const part = owners.slice(i, i + 3).map(addr);
        const b = beginCell().storeUint(part.length, 2).storeAddress(part[0]!).storeMaybeAddress(part[1] ?? null).storeMaybeAddress(part[2] ?? null);
        next = b.storeMaybeRef(next).endCell();
    }
    return next!;
}
export function sig512Cell(sig: Uint8Array): Cell {
    if (sig.length !== 64)
        throw new RangeError("sig: 64 bytes");
    return beginCell().storeBytes(sig).endCell();
}
export function buildClearTraderRefSigned(chain: Pick<TonChain, "factory">, a: {
    trader: AddressLike;
    nonce: bigint;
    expires: number;
    sig: Uint8Array;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    if (a.nonce <= 0n || a.nonce >= 1n << 64n)
        throw new RangeError("nonce out of 1..2^64-1");
    const body = bodyOf("clear_trader_ref_signed", a.queryId).storeAddress(addr(a.trader)).storeUint(a.nonce, 64)
        .storeUint(u32(a.expires, "expires"), 32).storeRef(sig512Cell(a.sig)).endCell();
    return tx(msg(chain.factory, a.gas ?? GAS_SMALL, body));
}
export function clearRefSignedCell(chain: Pick<TonChain, "factory">, a: {
    globalId: number;
    trader: AddressLike;
    nonce: bigint;
    expires: number;
}): Cell {
    if (!Number.isInteger(a.globalId) || a.globalId < -(2 ** 31) || a.globalId >= 2 ** 31)
        throw new RangeError("globalId out of int32 range");
    return beginCell().storeInt(a.globalId, 32).storeAddress(addr(chain.factory)).storeAddress(addr(a.trader))
        .storeUint(a.nonce, 64).storeUint(u32(a.expires, "expires"), 32).endCell();
}
export function buildReclaimCreateRefund(chain: Pick<TonChain, "factory">, a: {
    refundId: bigint;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    return tx(msg(chain.factory, a.gas ?? GAS_SMALL, bodyOf("reclaim_create_refund", a.queryId).storeUint(a.refundId, 64).endCell()));
}
export function buildClaimCreateOwed(chain: Pick<TonChain, "factory">, a: {
    refundId: bigint;
    to?: AddressLike | null;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    const body = bodyOf("claim_create_owed", a.queryId).storeUint(a.refundId, 64).storeAddress(a.to ? addr(a.to) : null).endCell();
    return tx(msg(chain.factory, a.gas ?? GAS_CLAIM, body));
}
export function buildPushChildCode(chain: Pick<TonChain, "factory">, a: {
    family: 3 | 4;
    launchId?: bigint;
    owners: AddressLike[];
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    if (a.family !== 3 && a.family !== 4)
        throw new RangeError("family: 3 (account) or 4 (trader)");
    const body = bodyOf("push_child_code", a.queryId).storeUint(a.family, 8).storeUint(a.launchId ?? 0n, 64).storeRef(addrListCell(a.owners)).endCell();
    return tx(msg(chain.factory, a.gas ?? (pushChildMin(a.family, a.owners.length) * 11n) / 10n, body));
}
export function buildCheckPreset(chain: Pick<TonChain, "factory">, a: {
    id: number;
    queryId?: bigint;
    gas?: bigint;
}): TonTx {
    return tx(msg(chain.factory, a.gas ?? GAS_CHECK_PRESET, bodyOf("check_preset", a.queryId).storeUint(u32(a.id, "id"), 32).endCell()));
}
export function buildBindHandle(chain: Pick<TonChain, "factory">, a: {
    handleId: bigint;
    wallet: AddressLike;
    sig: Uint8Array;
    launches: readonly bigint[];
    value: bigint;
    queryId?: bigint;
}): TonTx {
    if (a.value === undefined || a.value === null)
        throw new RangeError("bind_handle value is required: launches \u00D7 fan_each + factory_gas, priced from the chain config");
    if (a.handleId < 0n || a.handleId >= 1n << 256n)
        throw new RangeError("handle out of uint256 range");
    if (a.launches.some((id) => id < 1n))
        throw new RangeError("launches: every id is 1 or more");
    const launches = tonLaunchIdsCell(a.launches);
    const body = bodyOf("bind_handle", a.queryId).storeUint(a.handleId, 256).storeAddress(addr(a.wallet))
        .storeRef(sig512Cell(a.sig)).storeRef(launches).endCell();
    return tx(msg(chain.factory, pos(a.value, "value"), body));
}
