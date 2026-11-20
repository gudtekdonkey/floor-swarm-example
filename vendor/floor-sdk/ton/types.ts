import type { Address, Cell } from "./cell.ts";
export interface TonMessage {
    to: Address;
    value: bigint;
    bounce: boolean;
    body: Cell;
    stateInit?: {
        code: Cell;
        data: Cell;
    };
}
export interface TonTx {
    family: "ton";
    messages: TonMessage[];
}
export type AddressLike = Address | string;
export type TonQuote = {
    kind: "native";
} | {
    kind: "jetton";
    master: AddressLike;
};
export interface TonCodes {
    launch?: Cell;
    wallet: Cell;
    account: Cell;
    trader: Cell;
    factory?: Cell;
}
export interface TonChain {
    family: "ton";
    factory: AddressLike;
    codes: TonCodes;
    workchain?: 0;
}
export interface TonGasParams {
    buyFwdMin: bigint;
    sellFwdMin: bigint;
    refundFwdMin: bigint;
    reclaimAfter: bigint;
}
export const DEFAULT_GAS: TonGasParams = {
    buyFwdMin: 300000000n,
    sellFwdMin: 300000000n,
    refundFwdMin: 60000000n,
    reclaimAfter: 3600n,
};
export const TON_CLAIM = {
    CREATOR: 1,
    CREATOR_REF: 2,
    TEAM_SLOT: 4,
    TRADER_REF: 8,
    EXTRA_RESERVED: 32,
    PAYOUT: 64,
    TEAM_BUY: 128,
    SHARE_BOUGHT: 256,
    HOLDER: 512,
} as const;
export const TON_CLAIM_KNOWN = 975;
export const TON_WALK_STEPS = 16;
interface Common {
    queryId?: bigint;
}
export interface TonBuyArgs extends Common {
    launch: AddressLike;
    money: bigint;
    minTokens: bigint;
    deadline: number;
    recipient: AddressLike;
    referrer?: AddressLike;
    gas?: bigint;
}
export interface TonBuyJettonArgs extends Omit<TonBuyArgs, "gas"> {
    buyerQuoteWallet: AddressLike;
    buyer: AddressLike;
    forwardTon?: bigint;
    walletGas?: bigint;
}
export const REFERRED_HOP = 60000000n;
export const REFERRED_FWD_MIN = 240000000n;
export const REFERRED_SELL_FWD_MIN = 240000000n;
export const REFERRED_GIFT_FWD_MIN = REFERRED_FWD_MIN + REFERRED_HOP;
export const REFERRED_FWD_DEFAULT = DEFAULT_GAS.buyFwdMin + REFERRED_HOP;
export const REFERRED_SELL_FWD_DEFAULT = DEFAULT_GAS.sellFwdMin + REFERRED_HOP;
export const REFERRED_GIFT_FWD_DEFAULT = REFERRED_FWD_DEFAULT + REFERRED_HOP;
export const REFERRED_SELL_GIFT_FWD_DEFAULT = REFERRED_SELL_FWD_DEFAULT + REFERRED_HOP;
export interface TonBuyReferredJettonArgs extends Omit<TonBuyJettonArgs, "buyer"> {
    trader: AddressLike;
    deployTrader?: boolean;
}
export interface TonBuyReferredArgs extends TonBuyArgs {
    trader: AddressLike;
}
export interface TonSellReferredArgs extends Omit<TonSellArgs, "gasParams"> {
    deployTrader?: boolean;
}
export interface TonSellArgs extends Common {
    launch: AddressLike;
    seller: AddressLike;
    tokens: bigint;
    minOut: bigint;
    deadline: number;
    recipient: AddressLike;
    forwardTon?: bigint;
    walletGas?: bigint;
    sellerWallet?: AddressLike;
    gasParams?: TonGasParams;
}
export interface TonClaimArgs extends Common {
    launch: AddressLike;
    owner: AddressLike;
    types: number;
    to?: AddressLike;
    gas?: bigint;
    deploy?: boolean;
}
export interface TonTeamSpecArg {
    slotBps: number;
    creatorHandle?: bigint;
    creatorRefs?: readonly [
        AddressLike | null,
        AddressLike | null,
        AddressLike | null
    ];
}
export interface TonCreateArgs extends Common {
    creator: AddressLike;
    presetId: number;
    quote: AddressLike | null;
    listed: boolean;
    name: string;
    symbol: string;
    uri: string;
    team: TonTeamSpecArg;
    teamBuyMoney: bigint;
    teamBuyMinTokens: bigint;
    creatorRef?: AddressLike;
    deadline: number;
    createFee: bigint;
    deployGas?: bigint;
    creatorQuoteWallet?: AddressLike;
    forwardTon?: bigint;
    walletGas?: bigint;
}
export interface TonTeamShareBuyArgs {
    launch: AddressLike;
    place: number;
    money: bigint;
    minTokens: bigint;
    deadline: number;
    thenClaim?: boolean;
    queryId?: bigint;
    gas?: bigint;
}
