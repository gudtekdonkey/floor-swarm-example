import { addressBytes, base58Encode } from "../../codec.ts";
import { teamSlotHandleKey } from "../../handle.ts";
import { CLAIM_CREATOR, CLAIM_CREATOR_REF, CLAIM_SHARE_BOUGHT, CLAIM_TEAM_BUY, CLAIM_TEAM_SLOT, CLAIM_TRADER_REF, TEAM_SLOT_PENDING_HANDLE, TEAM_SLOT_WALLET, teamSlotAddInstruction } from "../../solana/floor/instructions.ts";
import type { Instruction } from "../../solana/instruction.ts";
import { freshRegistryPrice } from "../../registryPrice.ts";
import type { RegistryPrice } from "../../registryPrice.ts";
import { CLAIM_HOLDER, CLAIM_KNOWN_WIDE_V2, claimInstructionV2, teamShareBuyInstructionV2 } from "../solana.ts";
import type { TeamShareBuyBaseV2 } from "../solana.ts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WSOL_MINT, associatedTokenAddress } from "../../solana/pda.ts";
import { createAssociatedTokenAccountIdempotentInstruction } from "../../solana/tx.ts";
import { configPda as configPdaOf, teamSlotPda as teamSlotPdaOf } from "../../solana/floor/program.ts";
import { MEMBERS_MAX } from "../layouts.ts";
export { createLaunchInstructionV2, teamShareBuyInstructionV2, unlockCreatorBuyInstructionV2, burnTokensInstructionV2, claimInstructionV2, CLAIM_HOLDER, CLAIM_KNOWN_WIDE_V2 } from "../solana.ts";
export type { CreateArgsV2, ClaimLaunchV2 } from "../solana.ts";
export { planCreateWithSlot } from "../../solana/floor/create.ts";
export { createMintAccounts, MAX_NAME_LEN, MAX_SYMBOL_LEN } from "../../solana/floor/instructions.ts";
export { teamSlotAddInstruction, bindHandleInstruction, TEAM_SLOT_WALLET, TEAM_SLOT_PENDING_HANDLE } from "../../solana/floor/instructions.ts";
export { openTraderRefInstruction, openTraderLinkInstruction, openRefOwedInstruction, rollUpRefsInstruction, clearTraderRefInstruction } from "../../solana/floor/instructions.ts";
export { registerRoleInstruction, claimsPagePda, decodeClaimsPage, launchesFromRegistry, nextClaimsPage } from "../../solana/floor/registry.ts";
export { CLAIM_CREATOR, CLAIM_CREATOR_REF, CLAIM_TEAM_SLOT, CLAIM_TRADER_REF, CLAIM_TEAM_BUY, CLAIM_SHARE_BOUGHT } from "../../solana/floor/instructions.ts";
export { configPda, launchPda, teamSlotPda, traderRefPda, traderLinkPda, refOwedPda, quoteEntryPda, presetPda } from "../../solana/floor/program.ts";
export const TEAM_SLOT_MEMBERS_MAX = MEMBERS_MAX;
export const SOLANA_V2_TX = {
    create_launch: { file: "v2/instructions/create.rs", struct: "CreateLaunchV2", args: "args: CreateArgs" },
    team_share_buy: { file: "v2/instructions/team_share.rs", struct: "TeamShareBuyV2", args: "amount: u64, min_tokens_out: u64" },
    unlock_creator_buy: { file: "instructions/platform.rs", struct: "UnlockCreatorBuy", args: "" },
    burn_tokens: { file: "v2/instructions/burn.rs", struct: "BurnTokensV2", args: "place: u8, team_amount: u64, wallet_amount: u64" },
    team_slot_add: { file: "instructions/team_slot.rs", struct: "TeamSlotPayment", args: "key: Pubkey, kind: u8, amount: u64, pay_now: bool" },
    bind_handle: { file: "instructions/team_slot.rs", struct: "BindHandle", args: "index: u8, handle: [u8; 32], wallet: Pubkey" },
    open_trader_ref: { file: "instructions/referrals.rs", struct: "OpenTraderRef", args: "trader: Pubkey, tiers: [Pubkey; 3]" },
    open_trader_link: { file: "instructions/referrals.rs", struct: "OpenTraderLink", args: "trader: Pubkey, tiers: [Pubkey; 3]" },
    open_ref_owed: { file: "instructions/referrals.rs", struct: "OpenRefOwed", args: "referrer: Pubkey" },
    roll_up_refs: { file: "instructions/referrals.rs", struct: "RollUpRefs", args: "trader_refs: u8" },
    clear_trader_ref: { file: "instructions/referrals.rs", struct: "ClearTraderRef", args: "" },
    claim: { file: "instructions/claim.rs", struct: "Claim", args: "wallet: Pubkey, types: u8, launches: u8" },
    claim_wide: { file: "instructions/claim.rs", struct: "Claim", args: "wallet: Pubkey, types: u16, launches: u8" },
} as const;
export interface ClaimWhat {
    teamFees?: boolean;
    creatorReferral?: boolean;
    teamMilestones?: boolean;
    traderReferral?: boolean;
    teamBuy?: boolean;
    teamShareBought?: boolean;
    holder?: boolean;
}
export function claimTypesV2(w: ClaimWhat): number {
    const t = (w.teamFees ? CLAIM_CREATOR : 0) |
        (w.creatorReferral ? CLAIM_CREATOR_REF : 0) |
        (w.teamMilestones ? CLAIM_TEAM_SLOT : 0) |
        (w.traderReferral ? CLAIM_TRADER_REF : 0) |
        (w.teamBuy ? CLAIM_TEAM_BUY : 0) |
        (w.teamShareBought ? CLAIM_SHARE_BOUGHT : 0) |
        (w.holder ? CLAIM_HOLDER : 0);
    if (t === 0)
        throw new RangeError("claimTypesV2: nothing named (NothingToDo)");
    if ((t & ~CLAIM_KNOWN_WIDE_V2) !== 0)
        throw new RangeError("claimTypesV2: a bit outside CLAIM_KNOWN_WIDE_V2");
    return t;
}
export type SlotMemberKey = {
    wallet: string;
} | {
    platform: string;
    handle: string;
};
export function slotMemberKey(m: SlotMemberKey): {
    key: string;
    kind: number;
} {
    if ("wallet" in m) {
        addressBytes(m.wallet);
        return { key: m.wallet, kind: TEAM_SLOT_WALLET };
    }
    return { key: base58Encode(teamSlotHandleKey(m.platform, m.handle)), kind: TEAM_SLOT_PENDING_HANDLE };
}
export function teamSlotAddMemberV2(p: Omit<Parameters<typeof teamSlotAddInstruction>[0], "key" | "kind" | "amount" | "payNow"> & {
    member: SlotMemberKey;
    shares: bigint;
}): Instruction {
    if (p.shares <= 0n || p.shares >> 64n !== 0n)
        throw new RangeError("team_slot_add: shares is a u64 > 0 (NothingToDo)");
    const { key, kind } = slotMemberKey(p.member);
    const { member: _m, shares: _s, ...rest } = p;
    return teamSlotAddInstruction({ ...rest, key, kind, amount: p.shares, payNow: false });
}
export function createFeeV2(p: {
    listed: true;
    createFee: bigint;
    registry?: {
        entry: RegistryPrice;
        now: bigint;
    };
} | {
    listed: false;
    nativeCreateFee: bigint;
}): {
    amount: bigint;
    inQuote: boolean;
} {
    if (p.listed) {
        if (p.registry)
            freshRegistryPrice(p.registry.entry, p.registry.now);
        return { amount: p.createFee, inQuote: true };
    }
    return { amount: p.nativeCreateFee, inQuote: false };
}
export function teamBuyCheck(buy: bigint, max: bigint): {
    buy: bigint;
    locked: boolean;
} {
    if (buy < 0n)
        throw new RangeError("the Team Buy is \u2265 0");
    if (buy > max)
        throw new RangeError(`the Team Buy ${buy} is over the row's share ${max} (CreatorBuyTooLarge)`);
    return { buy, locked: buy > 0n };
}
export const TEAM_SHARE_BUY_AND_CLAIM_TYPES_V2 = CLAIM_TEAM_SLOT | CLAIM_TEAM_BUY | CLAIM_SHARE_BOUGHT;
export function teamShareBuyAndClaimInstructionsV2(p: Omit<TeamShareBuyBaseV2, "memberBase"> & {
    amountIn: bigint;
    minOut: bigint;
    memberBase?: string;
    quoteTokenProgram: string;
    config?: string;
    destination?: string;
    openMemberBase?: boolean;
    unwrapSol?: boolean;
    quoteIsLaunch?: boolean;
}): Instruction[] {
    const amount = p.amountIn;
    if (amount < 0n || amount >> 64n !== 0n)
        throw new RangeError("team_share_buy: amount is a u64 (0 = everything owed)");
    const teamSlot = p.teamSlot ?? teamSlotPdaOf(p.launch, p.programId)[0];
    const memberBase = p.memberBase ?? associatedTokenAddress(p.member, p.baseMint, TOKEN_2022_PROGRAM_ID);
    const open = p.openMemberBase ?? p.memberBase === undefined;
    const { quoteTokenProgram, config, destination, openMemberBase: _o, unwrapSol, quoteIsLaunch, ...buy } = p;
    const claim = claimInstructionV2({
        programId: p.programId,
        hookProgramId: p.hookProgramId,
        sender: p.member,
        wallet: p.member,
        quoteMint: p.quoteMint,
        quoteTokenProgram,
        destination: destination ?? associatedTokenAddress(p.member, p.quoteMint, quoteTokenProgram),
        config: config ?? configPdaOf(p.programId)[0],
        refOwed: null,
        refOwedVault: null,
        types: TEAM_SHARE_BUY_AND_CLAIM_TYPES_V2,
        unwrap: (unwrapSol ?? true) && p.quoteMint === WSOL_MINT && quoteTokenProgram === TOKEN_PROGRAM_ID,
        quoteIsLaunch,
        launches: [{ launch: p.launch, quoteVault: p.quoteVault, teamSlot, teamBuy: { baseMint: p.baseMint, tokenVault: p.tokenVault, walletBase: memberBase } }],
    });
    return [
        ...(open ? [createAssociatedTokenAccountIdempotentInstruction({ payer: p.member, owner: p.member, mint: p.baseMint, tokenProgram: TOKEN_2022_PROGRAM_ID })] : []),
        teamShareBuyInstructionV2({ ...buy, teamSlot, memberBase }),
        claim,
    ];
}
