import { decodeAccountV2 } from "./layouts.ts";
import { decodeEventDataV2 } from "./events.ts";
export interface PresetRowV2Account {
    id: number;
    bump: number;
    enabled: number;
    deleted: number;
    checked: number;
    genesisRow: number;
    padVersion: Uint8Array;
    version: number;
    rowHash: Uint8Array;
    row: Uint8Array;
    padEnd: Uint8Array;
}
export interface LaunchV2Account {
    version: number;
    bump: number;
    status: number;
    graduated: number;
    decimals: number;
    quoteDecimals: number;
    presetId: number;
    ownFees: number;
    msClass: number;
    flags: number;
    nRanges: number;
    nBands: number;
    nC: number;
    teamBuyRule: number;
    listed: number;
    padSlotRate: Uint8Array;
    slotRateBps: number;
    padPresetVersion: Uint8Array;
    presetVersion: number;
    id: bigint;
    createdAt: bigint;
    createdSlot: bigint;
    creatorUnlockAt: bigint;
    baseMint: string;
    quoteMint: string;
    creator: string;
    quoteTokenProgram: string;
    tokenVault: string;
    quoteVault: string;
    presetHash: Uint8Array;
    phiBps: number;
    wcBps: number;
    psiTailBps: number;
    teamBuyShareBps: number;
    teamSlotMaxBps: number;
    platformMsBps: number;
    floorMsBps: number;
    ckBps: number;
    feePpm: number[];
    feeStartPpm: number[];
    bandWidthBps: number[];
    bandShareBps: number[];
    sqrtP0: bigint;
    sqrtP: bigint;
    sqrtF: bigint;
    sqrtLMax: bigint;
    sqrtFeeA: bigint;
    sqrtFeeB: bigint;
    quoteUsdCentsX64: bigint;
    bandEdge: bigint[];
    rngSqrtA: bigint[];
    rngSqrtB: bigint[];
    rngTokens: bigint[];
    rngAskLeft: bigint[];
    rngBack: bigint[];
    rngPlace: bigint[];
    rngMsCapPpm: number[];
    rngThetaBps: number[];
    rngPsiBps: number[];
    rngKind: number[];
    rngClass: number[];
    supply: bigint;
    deadTokens: bigint;
    floor: bigint;
    floorTokens: bigint;
    bandMoney: bigint[];
    bandTokens: bigint[];
    bandF: bigint[];
    bandFClaim: bigint[];
    ckAtF: bigint;
    ckFloorTokens: bigint;
    msBooked: bigint[];
    msPaid: bigint[];
    creatorOwed: bigint;
    platformOwed: bigint;
    cutOwed: bigint;
    holderOwed: bigint;
    slotOwedTotal: bigint;
    slotOwed: bigint[];
    slotWeightPpb: number[];
    creatorRef: string[];
    creatorRefOwed: bigint[];
    teamBuyOwed: bigint[];
    teamBuyClaimed: bigint[];
    slotBoughtOwed: bigint[];
    slotBoughtClaimed: bigint[];
    teamShareBuyDay: bigint;
    windowRaised: bigint;
    raise: bigint;
    volumeBuy: bigint;
    volumeSell: bigint;
    trades: bigint;
    graduatedSlot: bigint;
    creatorLocked: bigint;
    backingCredited: bigint;
    incinerated: bigint;
    lastTs: bigint;
    bookHash: Uint8Array;
}
export interface HolderPositionAccount {
    version: number;
    bump: number;
    ataBump: number;
    pad: Uint8Array;
    launch: string;
    owner: string;
    amount: bigint;
    indexSnap: bigint;
    owed: bigint;
    padEnd: Uint8Array;
}
export interface HolderBookAccount {
    version: number;
    bump: number;
    pad: Uint8Array;
    launch: string;
    mint: string;
    w: bigint;
    index: bigint;
    carry: bigint;
    bookedTotal: bigint;
    paidTotal: bigint;
    padEnd: Uint8Array;
}
export interface DeadMarkAccount {
    version: number;
    bump: number;
    pad: Uint8Array;
    counted: bigint;
}
export interface LaunchCreatedV2EventV2 {
    launch: string;
    mint: string;
    quoteMint: string;
    creator: string;
    id: bigint;
    presetId: number;
    presetVersion: number;
    presetHash: Uint8Array;
    p0X64: bigint;
    raise: bigint;
    windowTokens: bigint;
    creatorBuyTokens: bigint;
    createFee: bigint;
    name: Uint8Array;
    symbol: Uint8Array;
    slot: bigint;
    ts: bigint;
    listed: boolean;
    quoteUsdCentsX64: bigint;
    nativeCreateFee: bigint;
    rowVersion: number;
    sqrtP0: bigint;
}
export interface TradeEventV2 {
    launch: string;
    trader: string;
    isBuy: boolean;
    quoteGross: bigint;
    quoteNet: bigint;
    refund: bigint;
    tokens: bigint;
    fees: bigint[];
    traderRef: bigint;
    fromResale: bigint;
    fromFirst: bigint;
    unfilled: bigint;
    sqrtBefore: bigint;
    sqrtAfter: bigint;
    sqrtF: bigint;
    floor: bigint;
    cushion: bigint;
    sCirc: bigint;
    steps: number;
    budgetHit: boolean;
    slot: bigint;
    ts: bigint;
    kind: number;
    creatorRef: bigint;
    recipient: string;
    bidMoney: bigint;
    msPaid: bigint[];
}
export interface HolderPositionOpenedEventV2 {
    launch: string;
    owner: string;
    amount: bigint;
}
export interface HolderPositionClosedEventV2 {
    launch: string;
    owner: string;
    amount: bigint;
    paid: bigint;
}
export interface HolderIndexRolledEventV2 {
    launch: string;
    index: bigint;
    wMatured: bigint;
    wPending: bigint;
    carry: bigint;
}
export interface DeadSyncedEventV2 {
    launch: string;
    added: bigint;
    deadTokens: bigint;
    sCirc: bigint;
}
export interface GenesisRaiseBoughtEventV2 {
    launch: string;
    trader: string;
    isBuy: boolean;
    quoteGross: bigint;
    quoteNet: bigint;
    refund: bigint;
    tokens: bigint;
    fees: bigint[];
    traderRef: bigint;
    fromResale: bigint;
    fromFirst: bigint;
    unfilled: bigint;
    sqrtBefore: bigint;
    sqrtAfter: bigint;
    sqrtF: bigint;
    floor: bigint;
    cushion: bigint;
    sCirc: bigint;
    steps: number;
    budgetHit: boolean;
    slot: bigint;
    ts: bigint;
    kind: number;
    creatorRef: bigint;
    recipient: string;
    bidMoney: bigint;
    msPaid: bigint[];
}
export type FloorEventV2Typed = {
    name: "LaunchCreatedV2";
    fields: LaunchCreatedV2EventV2;
} | {
    name: "Trade";
    fields: TradeEventV2;
} | {
    name: "HolderPositionOpened";
    fields: HolderPositionOpenedEventV2;
} | {
    name: "HolderPositionClosed";
    fields: HolderPositionClosedEventV2;
} | {
    name: "HolderIndexRolled";
    fields: HolderIndexRolledEventV2;
} | {
    name: "DeadSynced";
    fields: DeadSyncedEventV2;
} | {
    name: "GenesisRaiseBought";
    fields: GenesisRaiseBoughtEventV2;
};
export const decodePresetRowV2Typed = (d: Uint8Array): PresetRowV2Account => decodeAccountV2("PresetRowV2", d) as PresetRowV2Account;
export const decodeLaunchV2Typed = (d: Uint8Array): LaunchV2Account => decodeAccountV2("LaunchV2", d) as LaunchV2Account;
export const decodeHolderPositionTyped = (d: Uint8Array): HolderPositionAccount => decodeAccountV2("HolderPosition", d) as HolderPositionAccount;
export const decodeHolderBookTyped = (d: Uint8Array): HolderBookAccount => decodeAccountV2("HolderBook", d) as HolderBookAccount;
export const decodeDeadMarkTyped = (d: Uint8Array): DeadMarkAccount => decodeAccountV2("DeadMark", d) as DeadMarkAccount;
export const decodeEventV2Typed = (d: Uint8Array): FloorEventV2Typed | null => decodeEventDataV2(d) as FloorEventV2Typed | null;
export type { DevBuy, DevBuyRole } from "./devbuy.ts";
