export const V2_EVENT_FIELD_NAMES = {
    Trade: ["launchId", "trader", "recipient", "isBuy", "quoteGross", "quoteNet", "refund", "tokens", "fees", "traderRef", "fromResale", "fromFirst", "unfilled", "sqrtBefore", "sqrtAfter", "sqrtF", "floor", "cushion", "sCirc", "steps", "budgetHit", "slot", "ts", "kind", "creatorRef", "bidMoney", "msPaid"],
    HolderIndexRolled: ["launchId", "index", "wMatured", "wPending", "carry"],
    DeadSynced: ["launchId", "added", "deadTokens", "sCirc"],
    BackingCredited: ["launchId", "donor", "amount", "fAfter", "slot"],
    TokensBurnedV2: ["launchId", "wallet", "role", "place", "fromTeamBuy", "fromWallet", "balanceBefore", "owedAfter", "split", "supply", "sOut", "floorAfterX64", "fromShareBought"],
    OptedIn: ["a"],
} as const;
