// The create's Team Buy, priced from the preset row the same way on both chains: optional (0 = none), at most the row's
// share of the raise, its minimum tokens the SDK's own Team Buy walk on the fresh book less the slippage.
import { decodeRowV2, type RowV2 } from "../../vendor/floor-sdk/math/v2/preset.ts";
import { createLaunchV2, teamBuyV2, type CreateCtx } from "../../vendor/floor-sdk/math/v2/create.ts";
import { tokensToChainV2 } from "../../vendor/floor-sdk/v2/solanaSettle.ts";

/** "max" = the row's whole share; otherwise quote base units. */
export type TeamBuyWant = bigint | "max";

export interface TeamBuyPlan {
  creatorBuy: bigint;
  /** Chain units of the launch token. */
  creatorBuyMinTokens: bigint;
  teamBuyMax: bigint;
  /** The Team Slot's rate: always the row's max (the program refuses any other). */
  teamSlotBps: number;
}

export const rowOf = (bytes: Uint8Array): RowV2 => decodeRowV2(bytes);

export function planTeamBuy(row: RowV2, ctx: CreateCtx, want: TeamBuyWant, slippageBps: number): TeamBuyPlan {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error(`--slippage ${slippageBps}: 0 ..< 10000`);
  const made = createLaunchV2(row, ctx);
  const creatorBuy = want === "max" ? made.teamBuyMax : want;
  if (creatorBuy < 0n) throw new Error("--team-buy must be ≥ 0");
  if (creatorBuy > made.teamBuyMax) throw new Error(`--team-buy ${creatorBuy}: the preset's max is ${made.teamBuyMax} (quote base units)`);
  let creatorBuyMinTokens = 0n;
  if (creatorBuy > 0n) {
    const tokens = tokensToChainV2(teamBuyV2(made.book, creatorBuy, made.teamBuyMax).tokens, ctx.tokenDecimals);
    creatorBuyMinTokens = (tokens * BigInt(10_000 - slippageBps)) / 10_000n;
    if (creatorBuyMinTokens === 0n) creatorBuyMinTokens = 1n;
  }
  return { creatorBuy, creatorBuyMinTokens, teamBuyMax: made.teamBuyMax, teamSlotBps: row.teamSlotMaxBps };
}
