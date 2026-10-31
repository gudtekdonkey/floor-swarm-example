import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planTeamBuy, rowOf } from "../../src/chains/teambuy.ts";
import { createLaunchV2, teamBuyV2 } from "../../vendor/floor-sdk/math/v2/create.ts";

// Moonshot's encoded preset row (the math crate's preset_v2 golden, row_to_bytes)
const ROW = rowOf(Uint8Array.from(Buffer.from(readFileSync(new URL("../fixtures/moonshot-row.hex", import.meta.url), "utf8").trim(), "hex")));
// USDC at $1: 100 cents × 2⁶⁴
const CTX = { quoteDecimals: 6, quoteUsdCentsX64: 100n << 64n, tokenDecimals: 6 };

test("no --team-buy: no Team Buy, no minimum, the slot at the row's max", () => {
  const p = planTeamBuy(ROW, CTX, 0n, 300);
  assert.equal(p.creatorBuy, 0n);
  assert.equal(p.creatorBuyMinTokens, 0n);
  assert.equal(p.teamSlotBps, ROW.teamSlotMaxBps);
  assert.ok(p.teamBuyMax > 0n);
});

test("--team-buy max: the row's whole share, its minimum the SDK's walk less the slippage", () => {
  const p = planTeamBuy(ROW, CTX, "max", 300);
  const made = createLaunchV2(ROW, CTX);
  assert.equal(p.creatorBuy, made.teamBuyMax);
  const tokens = teamBuyV2(made.book, made.teamBuyMax, made.teamBuyMax).tokens;
  assert.ok(tokens > 0n);
  assert.equal(p.creatorBuyMinTokens, (tokens * 9_700n) / 10_000n);
});

test("on EVM the minimum is in 18-decimal token units (math units × 10¹²)", () => {
  const sol = planTeamBuy(ROW, CTX, "max", 0);
  const evm = planTeamBuy(ROW, { ...CTX, tokenDecimals: 18 }, "max", 0);
  assert.equal(evm.creatorBuyMinTokens, sol.creatorBuyMinTokens * 10n ** 12n);
});

test("a Team Buy over the row's share is refused before anything is sent", () => {
  const max = planTeamBuy(ROW, CTX, "max", 300).teamBuyMax;
  assert.throws(() => planTeamBuy(ROW, CTX, max + 1n, 300), /max is/);
  assert.throws(() => planTeamBuy(ROW, CTX, 1n, 10_000), /--slippage/);
});
