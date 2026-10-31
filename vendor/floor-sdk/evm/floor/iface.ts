import type { MathErrorCode } from "../../math/index.ts";
import { CLAIM_BITS, CLAIM_RESERVED, CLAIM_CREATOR, CLAIM_CREATOR_REF, CLAIM_TEAM_SLOT, CLAIM_TRADER_REF, CLAIM_RESERVED_HOLDER, CLAIM_EXTRA, CLAIM_TEAM_BUY, CLAIM_SHARE_BOUGHT } from "../../generated/index.ts";
export { FLOOR_AMM_ABI, FLOOR_AMM_UNFROZEN_EVENTS, FLOOR_TOKEN_ABI, FLOOR_ZAP_ABI } from "./abi.gen.ts";
export { CLAIM_CREATOR, CLAIM_CREATOR_REF, CLAIM_TEAM_SLOT, CLAIM_TRADER_REF, CLAIM_RESERVED_HOLDER, CLAIM_EXTRA, CLAIM_TEAM_BUY, CLAIM_SHARE_BOUGHT };
export const CLAIM_PAYOUT = CLAIM_BITS.evm.payout;
export const CLAIM_KNOWN = CLAIM_CREATOR | CLAIM_CREATOR_REF | CLAIM_TEAM_SLOT | CLAIM_TRADER_REF | CLAIM_EXTRA | CLAIM_PAYOUT | CLAIM_TEAM_BUY | CLAIM_SHARE_BOUGHT;
export const OWED_BITS = [
    ["creator", CLAIM_CREATOR],
    ["creatorRef", CLAIM_CREATOR_REF],
    ["teamSlot", CLAIM_TEAM_SLOT],
    ["traderRef", CLAIM_TRADER_REF],
    ["extra", CLAIM_EXTRA],
] as const;
export const TRADE_CREDIT_PAYEES = [
    "creator",
    "creatorRef1",
    "creatorRef2",
    "creatorRef3",
    "member0",
    "member1",
    "member2",
    "member3",
    "member4",
    "member5",
    "member6",
    "member7",
    "member8",
    "member9",
    "traderRef1",
    "traderRef2",
    "traderRef3",
    "holder",
    "extra0",
    "extra1",
    "extra2",
    "extra3",
] as const;
export const NATIVE_QUOTE = "0x0000000000000000000000000000000000000000";
export const MEMBER_WALLET = 0;
export const MEMBER_HANDLE = 1;
export const MEMBER_EMPTY = 0;
export const MEMBER_REQUESTED = 1;
export const MEMBER_PAID = 2;
export const MEMBER_CANCELLED = 3;
export const EVM_TOKEN_DECIMALS = 18;
export { SWEPT_BURN, SWEPT_DUST, SWEPT_EXIT } from "../../solana/floor/events.ts";
export const MATH_ERROR_CODES: readonly MathErrorCode[] = ["VaultShareOutOfRange", "Zero", "Overflow", "NotDue", "NothingToDo", "BookEmpty", "StepBudget", "SqrtRange", "RowTooManyRanges", "RowBands", "RowShares", "RowNotFeasible", "TeamBuyOverShare", "LotsFull", "IndexGuard", "NothingToSettle", "SlippageExceeded", "QuoteRowCannotOpen", "RangeCover", "RowLength", "RowVersion", "RowEdges", "RowTail", "RowBounds", "RowFees", "RowTeam", "RowFlags", "RowMsClass", "RowNonCanonical"];
