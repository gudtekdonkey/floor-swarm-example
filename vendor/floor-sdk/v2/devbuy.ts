import { base58Encode } from "../codec.ts";
import { SLOT_ACTIVE } from "../solana/floor/accounts.ts";
import { TEAM_SLOT_WALLET } from "../solana/floor/instructions.ts";
import { priceX64 } from "../math/v2/sqrt.ts";
import { TRADE_KIND_TEAM_BUY, TRADE_KIND_TEAM_SHARE_BUY } from "./events.ts";
import type { TradeEventV2 } from "./types.ts";
export type DevBuyRole = "creator" | "team_member" | "team_share_buy" | "team_buy";
export interface DevBuy {
    launch: string;
    trader: string;
    role: DevBuyRole;
    quoteIn: bigint;
    tokens: bigint;
    priceBeforeX64: bigint;
    priceAfterX64: bigint;
    impactBps: bigint;
    slot: bigint;
}
export interface DevTeam {
    creator: string;
    teamSlot?: {
        members: {
            key: Uint8Array;
            kind: number;
            state: number;
        }[];
    } | null;
}
export function teamSlotWallets(slot: DevTeam["teamSlot"]): string[] {
    return (slot?.members ?? []).filter((m) => m.kind === TEAM_SLOT_WALLET && m.state === SLOT_ACTIVE).map((m) => base58Encode(m.key));
}
export const impactBps = (before: bigint, after: bigint): bigint => (before === 0n ? 0n : ((after - before) * 10000n) / before);
export function devBuyFromTrade(t: TradeEventV2, team: DevTeam, ctx: {
    teamBuy?: boolean;
    teamShareBuy?: boolean;
} = {}): DevBuy | null {
    if (!t.isBuy)
        return null;
    let role: DevBuyRole | null = null;
    if (t.kind === TRADE_KIND_TEAM_BUY || ctx.teamBuy)
        role = "team_buy";
    else if (t.kind === TRADE_KIND_TEAM_SHARE_BUY || ctx.teamShareBuy)
        role = "team_share_buy";
    else if (t.trader === team.creator)
        role = "creator";
    else if (teamSlotWallets(team.teamSlot).includes(t.trader))
        role = "team_member";
    if (role === null)
        return null;
    const priceBeforeX64 = priceX64(t.sqrtBefore);
    const priceAfterX64 = priceX64(t.sqrtAfter);
    return {
        launch: t.launch,
        trader: t.trader,
        role,
        quoteIn: t.quoteGross - t.refund,
        tokens: t.tokens,
        priceBeforeX64,
        priceAfterX64,
        impactBps: impactBps(priceBeforeX64, priceAfterX64),
        slot: t.slot,
    };
}
export const devBuyChangeSinceBps = (d: DevBuy, sqrtNow: bigint): bigint => impactBps(d.priceAfterX64, priceX64(sqrtNow));
