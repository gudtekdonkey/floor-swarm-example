export interface SolLaunchCreatedFields {
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
}
export interface SolGraduatedFields {
    launch: string;
    priceX64: bigint;
    windowRaised: bigint;
    windowTokens: bigint;
    slot: bigint;
    ts: bigint;
}
export interface SolPotsSweptFields {
    launch: string;
    amount: bigint;
    reason: number;
}
export interface SolClaimedFields {
    wallet: string;
    sender: string;
    launch: string;
    quoteMint: string;
    types: number;
    creator: bigint;
    creatorRef: bigint;
    teamSlot: bigint;
    traderRef: bigint;
    extra: bigint;
    amount: bigint;
    teamBuy: bigint | null;
    shareBought: bigint | null;
    typesHi: number | null;
}
export interface SolTeamShareBoughtFields {
    launch: string;
    member: string;
    place: number;
    spent: bigint;
    refund: bigint;
    tokens: bigint;
    shareLeft: bigint;
    boughtOwed: bigint;
    day: bigint;
    firstToday: boolean;
    ts: bigint;
}
export interface SolPlatformWithdrawnFields {
    launch: string;
    quoteMint: string;
    destination: string;
    amount: bigint;
    owedAfter: bigint;
}
export interface SolHolderWithdrawnFields {
    launch: string;
    quoteMint: string;
    destination: string;
    amount: bigint;
    owedAfter: bigint;
}
export interface SolPresetWrittenFields {
    id: number;
    rowVersion: number;
    enabled: boolean;
    deleted: boolean;
}
export interface SolQuoteWrittenFields {
    mint: string;
    enabled: boolean;
    createFee: bigint;
    usdCentsX64: bigint;
    admittedCaps: number;
}
export interface SolConfigWrittenFields {
    authority: string;
    pendingAuthority: string;
    timelock: string;
    referralAuthority: string;
    createPaused: boolean;
    holderDest: string;
    nativeCreateFee: bigint;
    treasury: string | null;
    priceUpdater: string | null;
}
export interface SolMetadataBaseSetFields {
    base: Uint8Array;
    len: number;
}
export interface SolTeamSlotOpenedFields {
    launch: string;
    rateBps: number;
    price: bigint;
}
export interface SolTeamSlotMemberFields {
    launch: string;
    index: number;
    key: Uint8Array;
    kind: number;
    state: number;
    paid: bigint;
    requested: bigint;
    bought: bigint;
    boughtPpm: number;
}
export interface SolTraderRefOpenedFields {
    trader: string;
    quoteMint: string;
    tiers: string[];
}
export interface SolTraderLinkOpenedFields {
    trader: string;
    tiers: string[];
}
export interface SolTraderRefClearedFields {
    trader: string;
    records: number;
}
export interface SolCreatorBuyUnlockedFields {
    launch: string;
    creator: string;
    tokens: bigint;
    members: bigint[] | null;
    paid: bigint | null;
}
export interface SolRefOwedOpenedFields {
    referrer: string;
    quoteMint: string;
}
export interface SolRefsRolledFields {
    quoteMint: string;
    traderRefs: number;
    amount: bigint;
}
export interface SolGenesisAcceptedFields {
    oldSale: string;
    count: number;
    totalMigrated: bigint;
    donation: bigint;
}
export interface SolHandleBoundFields {
    launch: string;
    index: number;
    handle: Uint8Array;
    wallet: string;
}
export interface SolQuoteShortFields {
    launch: string;
    quoteVault: bigint;
    quoteBooked: bigint;
    short: bigint;
    slot: bigint;
}
export interface SolBackingCreditedFields {
    launch: string;
    donor: string;
    amount: bigint;
    fAfter: bigint;
    slot: bigint;
}
export interface SolCutWithdrawnFields {
    launch: string;
    amount: bigint;
    cutOwedAfter: bigint;
}
export interface SolRoleRegisteredFields {
    wallet: string;
    page: number;
    launch: string;
    roles: number;
}
export interface SolClaimsLutSetFields {
    wallet: string;
    lookupTable: string;
}
export interface SolNativeFeesWithdrawnFields {
    destination: string;
    amount: bigint;
    owedAfter: bigint;
}
export interface SolGenesisContributedFields {
    wallet: string;
    amount: bigint;
    walletTotal: bigint;
    liveTotal: bigint;
}
export interface SolGenesisMigratedRefundedFields {
    wallet: string;
    amount: bigint;
    liveTotal: bigint;
}
export interface SolGenesisOpenedFields {
    launch: string;
    mint: string;
    raised: bigint;
    tokens: bigint;
    donation: bigint;
    p0X64: bigint;
    weightTotal: bigint;
    slotRateBps: number;
    quoteMint: string | null;
    floorUsdcIn: bigint | null;
    refund: bigint | null;
    usdcExcess: bigint | null;
    solConverted: bigint | null;
    usdcConverted: bigint | null;
    solUnconverted: bigint | null;
    usdcRefund: bigint | null;
}
export interface SolGenesisClaimedFields {
    wallet: string;
    migratedCredit: bigint;
    phase3Credit: bigint;
    tokens: bigint;
    refund: bigint | null;
    listedCredit: bigint | null;
    usdcRefund: bigint | null;
}
export interface SolGenesisRefundOwedFields {
    wallet: string;
    amount: bigint;
    usdc: bigint | null;
}
export interface SolGenesisRefundPaidFields {
    wallet: string;
    to: string;
    amount: bigint;
    usdc: bigint | null;
    usdcTo: string | null;
}
export interface SolGenesisDustSweptFields {
    launch: string;
    amount: bigint;
    usdc: bigint | null;
}
export interface SolGenesisSolConvertedFields {
    caller: string;
    lamports: bigint;
    usdc: bigint;
    solUsdCentsX64: bigint;
    usdcUsdCentsX64: bigint;
    discountBps: number;
    solConverted: bigint;
    usdcConverted: bigint;
    usdcCaps: bigint;
}
export interface SolGenesisWagmiBoughtFields {
    floorLaunch: string;
    usdcIn: bigint;
    floorOut: bigint;
}
export interface SolGenesisWagmiOpenedFields {
    launch: string;
    mint: string;
    floorIn: bigint;
    tokens: bigint;
    floorRefund: bigint;
    p0X64: bigint;
    quoteUsdCentsX64: bigint | null;
    capTokens: bigint | null;
    overCapFloor: bigint | null;
    overCapTokens: bigint | null;
}
export interface SolGenesisWagmiClaimedFields {
    wallet: string;
    tokens: bigint;
    floorBack: bigint;
}
export interface SolGenesisWagmiDustSweptFields {
    launch: string;
    floor: bigint;
}
export interface SolGenesisListedContributedFields {
    wallet: string;
    amount: bigint;
    walletListed: bigint;
    allowanceLeft: bigint;
    liveTotal: bigint;
}
export interface SolGenesisListRootSetFields {
    signer: string;
    oldRoot: Uint8Array;
    newRoot: Uint8Array;
}
export interface SolBurnsSyncedFields {
    launch: string;
    incinerated: bigint;
    supply: bigint;
    sOut: bigint;
    floorAfterX64: bigint;
    slot: bigint;
}
export interface SolTokensBurnedFields {
    launch: string;
    wallet: string;
    role: number;
    place: number;
    fromTeamBuy: bigint;
    fromWallet: bigint;
    balanceBefore: bigint;
    owedAfter: bigint;
    split: bigint[];
    supply: bigint;
    sOut: bigint;
    floorAfterX64: bigint;
    slot: bigint;
    fromShareBought: bigint | null;
}
export interface SolLaunchCreatedV2Fields {
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
export interface SolTradeFields {
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
export interface SolHolderPositionOpenedFields {
    launch: string;
    owner: string;
    amount: bigint;
}
export interface SolHolderPositionClosedFields {
    launch: string;
    owner: string;
    amount: bigint;
    paid: bigint;
}
export interface SolHolderIndexRolledFields {
    launch: string;
    index: bigint;
    wMatured: bigint;
    wPending: bigint;
    carry: bigint;
}
export interface SolDeadSyncedFields {
    launch: string;
    added: bigint;
    deadTokens: bigint;
    sCirc: bigint;
}
export interface SolGenesisRaiseBoughtFields {
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
export type SolanaEventMap = {
    LaunchCreated: SolLaunchCreatedFields;
    Graduated: SolGraduatedFields;
    PotsSwept: SolPotsSweptFields;
    Claimed: SolClaimedFields;
    TeamShareBought: SolTeamShareBoughtFields;
    PlatformWithdrawn: SolPlatformWithdrawnFields;
    HolderWithdrawn: SolHolderWithdrawnFields;
    PresetWritten: SolPresetWrittenFields;
    QuoteWritten: SolQuoteWrittenFields;
    ConfigWritten: SolConfigWrittenFields;
    MetadataBaseSet: SolMetadataBaseSetFields;
    TeamSlotOpened: SolTeamSlotOpenedFields;
    TeamSlotMember: SolTeamSlotMemberFields;
    TraderRefOpened: SolTraderRefOpenedFields;
    TraderLinkOpened: SolTraderLinkOpenedFields;
    TraderRefCleared: SolTraderRefClearedFields;
    CreatorBuyUnlocked: SolCreatorBuyUnlockedFields;
    RefOwedOpened: SolRefOwedOpenedFields;
    RefsRolled: SolRefsRolledFields;
    GenesisAccepted: SolGenesisAcceptedFields;
    HandleBound: SolHandleBoundFields;
    QuoteShort: SolQuoteShortFields;
    BackingCredited: SolBackingCreditedFields;
    CutWithdrawn: SolCutWithdrawnFields;
    RoleRegistered: SolRoleRegisteredFields;
    ClaimsLutSet: SolClaimsLutSetFields;
    NativeFeesWithdrawn: SolNativeFeesWithdrawnFields;
    GenesisContributed: SolGenesisContributedFields;
    GenesisMigratedRefunded: SolGenesisMigratedRefundedFields;
    GenesisOpened: SolGenesisOpenedFields;
    GenesisClaimed: SolGenesisClaimedFields;
    GenesisRefundOwed: SolGenesisRefundOwedFields;
    GenesisRefundPaid: SolGenesisRefundPaidFields;
    GenesisDustSwept: SolGenesisDustSweptFields;
    GenesisSolConverted: SolGenesisSolConvertedFields;
    GenesisWagmiBought: SolGenesisWagmiBoughtFields;
    GenesisWagmiOpened: SolGenesisWagmiOpenedFields;
    GenesisWagmiClaimed: SolGenesisWagmiClaimedFields;
    GenesisWagmiDustSwept: SolGenesisWagmiDustSweptFields;
    GenesisListedContributed: SolGenesisListedContributedFields;
    GenesisListRootSet: SolGenesisListRootSetFields;
    BurnsSynced: SolBurnsSyncedFields;
    TokensBurned: SolTokensBurnedFields;
    LaunchCreatedV2: SolLaunchCreatedV2Fields;
    Trade: SolTradeFields;
    HolderPositionOpened: SolHolderPositionOpenedFields;
    HolderPositionClosed: SolHolderPositionClosedFields;
    HolderIndexRolled: SolHolderIndexRolledFields;
    DeadSynced: SolDeadSyncedFields;
    GenesisRaiseBought: SolGenesisRaiseBoughtFields;
};
export type SolanaEvent = {
    [N in keyof SolanaEventMap]: {
        chain: "solana";
        name: N;
        fields: SolanaEventMap[N];
    };
}[keyof SolanaEventMap];
export interface EvmTradeFields {
    launchId: bigint;
    trader: string;
    recipient: string;
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
    steps: bigint;
    budgetHit: boolean;
    slot: bigint;
    ts: bigint;
    kind: bigint;
    creatorRef: bigint;
    bidMoney: bigint;
    msPaid: bigint[];
}
export interface EvmHolderIndexRolledFields {
    launchId: bigint;
    index: bigint;
    wMatured: bigint;
    wPending: bigint;
    carry: bigint;
}
export interface EvmDeadSyncedFields {
    launchId: bigint;
    added: bigint;
    deadTokens: bigint;
    sCirc: bigint;
}
export interface EvmBackingCreditedFields {
    launchId: bigint;
    donor: string;
    amount: bigint;
    fAfter: bigint;
    slot: bigint;
}
export interface EvmTokensBurnedV2Fields {
    launchId: bigint;
    wallet: string;
    role: bigint;
    place: bigint;
    fromTeamBuy: bigint;
    fromWallet: bigint;
    balanceBefore: bigint;
    owedAfter: bigint;
    split: bigint[];
    supply: bigint;
    sOut: bigint;
    floorAfterX64: bigint;
    fromShareBought: bigint;
}
export interface EvmOptedInFields {
    a: string;
}
export interface EvmClaimSkippedFields {
    wallet: string;
    quote: string;
    amount: bigint;
}
export interface EvmClaimedFields {
    wallet: string;
    sender: string;
    quote: string;
    types: bigint;
    creator: bigint;
    creatorRef: bigint;
    teamSlot: bigint;
    traderRef: bigint;
    holder: bigint;
    extra: bigint;
    amount: bigint;
}
export interface EvmConfigWrittenFields {
    authority: string;
    pendingAuthority: string;
    timelock: string;
    referralAuthority: string;
    createPaused: boolean;
    holderDest: string;
}
export interface EvmCreatorBuyUnlockedFields {
    launchId: bigint;
    creator: string;
    tokens: bigint;
    members: bigint[];
    paid: bigint;
}
export interface EvmGraduatedFields {
    launchId: bigint;
    windowPriceX64: bigint;
    priceX64: bigint;
    windowRaised: bigint;
    windowTokens: bigint;
}
export interface EvmHandleBoundFields {
    handleId: string;
    wallet: string;
    moved: bigint;
}
export interface EvmHandleOwedMovedFields {
    handleId: string;
    wallet: string;
    moved: bigint;
}
export interface EvmHolderWithdrawnFields {
    quote: string;
    to: string;
    amount: bigint;
    owedAfter: bigint;
}
export interface EvmLaunchCreatedFields {
    launchId: bigint;
    token: string;
    quote: string;
    creator: string;
    presetId: bigint;
    presetVersion: bigint;
    presetHash: string;
    p0X64: bigint;
    raise: bigint;
    windowTokens: bigint;
    creatorBuyTokens: bigint;
    createFee: bigint;
    name: string;
    symbol: string;
    uri: string;
    listed: boolean;
    quoteUsdCentsX64: bigint;
    nativeCreateFee: bigint;
}
export interface EvmMetadataBaseSetFields {
    base: string;
}
export interface EvmNativeCreateFeeSetFields {
    fee: bigint;
}
export interface EvmPayoutClaimedFields {
    wallet: string;
    sender: string;
    quote: string;
    to: string;
    amount: bigint;
}
export interface EvmPayoutOwedFields {
    wallet: string;
    quote: string;
    amount: bigint;
}
export interface EvmPlatformWithdrawnFields {
    quote: string;
    to: string;
    amount: bigint;
    owedAfter: bigint;
}
export interface EvmPotsSweptFields {
    launchId: bigint;
    amount: bigint;
    reason: bigint;
}
export interface EvmPresetWrittenFields {
    id: bigint;
    rowVersion: bigint;
    enabled: boolean;
    deleted: boolean;
}
export interface EvmPriceUpdaterSetFields {
    previous: string;
    updater: string;
}
export interface EvmQuoteCapSetFields {
    token: string;
    cap: bigint;
}
export interface EvmQuoteWrittenFields {
    token: string;
    enabled: boolean;
    createFee: bigint;
    usdCentsX64: bigint;
}
export interface EvmTeamBuyClaimedFields {
    launchId: bigint;
    wallet: string;
    place: bigint;
    tokens: bigint;
}
export interface EvmTeamShareBoughtFields {
    launchId: bigint;
    member: string;
    place: bigint;
    spent: bigint;
    refund: bigint;
    tokens: bigint;
    shareLeft: bigint;
    boughtOwed: bigint;
    day: bigint;
    firstToday: boolean;
}
export interface EvmTeamShareBoughtClaimedFields {
    launchId: bigint;
    wallet: string;
    tokens: bigint;
}
export interface EvmTeamSlotMemberFields {
    launchId: bigint;
    index: bigint;
    key: string;
    kind: bigint;
    state: bigint;
    paid: bigint;
    requested: bigint;
    bought: bigint;
    boughtPpm: bigint;
}
export interface EvmTeamSlotOpenedFields {
    launchId: bigint;
    rateBps: bigint;
    price: bigint;
}
export interface EvmTradeV1Fields {
    launchId: bigint;
    trader: string;
    recipient: string;
    isBuy: boolean;
    quoteGross: bigint;
    quoteNet: bigint;
    refund: bigint;
    tokens: bigint;
    fees: bigint[];
    traderRef: bigint;
    split: bigint[];
    credits: bigint[];
    priceBeforeX64: bigint;
    priceAfterX64: bigint;
    floorAfterX64: bigint;
    floor: bigint;
    cushion: bigint;
    reserveTokens: bigint;
    sOut: bigint;
    floorToken: bigint;
    msPlatform: bigint;
    msFloor: bigint;
    tailPay: bigint;
    tailToFloor: bigint;
    tailTokens: bigint;
    tailFromFloor: bigint;
    tailFromMoney: bigint;
    msHolder: bigint;
    polOut: bigint;
    polPay: bigint;
    polTokens: bigint;
    polGross: bigint;
    holderFee: bigint;
    liveBuyPriceX64: bigint;
    polMoney: bigint;
}
export interface EvmTraderRefClearedFields {
    trader: string;
}
export interface EvmTraderRefOpenedFields {
    trader: string;
    tiers: string[];
}
export interface EvmTreasurySetFields {
    previous: string;
    treasury: string;
}
export interface EvmZappedFields {
    sender: string;
    to: string;
    launchId: bigint;
    tokenIn: string;
    amountIn: bigint;
    quoteIn: bigint;
    tokensOut: bigint;
    refundIn: bigint;
    refundQuote: bigint;
}
export interface EvmApprovalFields {
    owner: string;
    spender: string;
    value: bigint;
}
export interface EvmTransferFields {
    from: string;
    to: string;
    value: bigint;
}
export type EvmEventMap = {
    Trade: EvmTradeFields;
    HolderIndexRolled: EvmHolderIndexRolledFields;
    DeadSynced: EvmDeadSyncedFields;
    BackingCredited: EvmBackingCreditedFields;
    TokensBurnedV2: EvmTokensBurnedV2Fields;
    OptedIn: EvmOptedInFields;
    ClaimSkipped: EvmClaimSkippedFields;
    Claimed: EvmClaimedFields;
    ConfigWritten: EvmConfigWrittenFields;
    CreatorBuyUnlocked: EvmCreatorBuyUnlockedFields;
    Graduated: EvmGraduatedFields;
    HandleBound: EvmHandleBoundFields;
    HandleOwedMoved: EvmHandleOwedMovedFields;
    HolderWithdrawn: EvmHolderWithdrawnFields;
    LaunchCreated: EvmLaunchCreatedFields;
    MetadataBaseSet: EvmMetadataBaseSetFields;
    NativeCreateFeeSet: EvmNativeCreateFeeSetFields;
    PayoutClaimed: EvmPayoutClaimedFields;
    PayoutOwed: EvmPayoutOwedFields;
    PlatformWithdrawn: EvmPlatformWithdrawnFields;
    PotsSwept: EvmPotsSweptFields;
    PresetWritten: EvmPresetWrittenFields;
    PriceUpdaterSet: EvmPriceUpdaterSetFields;
    QuoteCapSet: EvmQuoteCapSetFields;
    QuoteWritten: EvmQuoteWrittenFields;
    TeamBuyClaimed: EvmTeamBuyClaimedFields;
    TeamShareBought: EvmTeamShareBoughtFields;
    TeamShareBoughtClaimed: EvmTeamShareBoughtClaimedFields;
    TeamSlotMember: EvmTeamSlotMemberFields;
    TeamSlotOpened: EvmTeamSlotOpenedFields;
    TradeV1: EvmTradeV1Fields;
    TraderRefCleared: EvmTraderRefClearedFields;
    TraderRefOpened: EvmTraderRefOpenedFields;
    TreasurySet: EvmTreasurySetFields;
    Zapped: EvmZappedFields;
    Approval: EvmApprovalFields;
    Transfer: EvmTransferFields;
};
export type EvmEvent = {
    [N in keyof EvmEventMap]: {
        chain: "evm";
        name: N;
        fields: EvmEventMap[N];
        address?: string;
    };
}[keyof EvmEventMap];
export const SHARED_EVENT_NAMES = ["BackingCredited", "Claimed", "ConfigWritten", "CreatorBuyUnlocked", "DeadSynced", "Graduated", "HandleBound", "HolderIndexRolled", "HolderWithdrawn", "LaunchCreated", "MetadataBaseSet", "PlatformWithdrawn", "PotsSwept", "PresetWritten", "QuoteWritten", "TeamShareBought", "TeamSlotMember", "TeamSlotOpened", "Trade", "TraderRefCleared", "TraderRefOpened"] as const;
