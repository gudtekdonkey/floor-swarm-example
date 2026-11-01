// swap: the pairing rules, the buy's budget, and a sell that lands with a buy that fails (reported, never repeated).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SendError } from "../../src/chains/chain.ts";
import { PlanError } from "../../src/plan/plan.ts";
import { buyBudget, checkPair, swap } from "../../src/commands/swap.ts";
import type { Knobs } from "../../src/commands/trade.ts";
import { NATIVE, QUOTE_X, TOKEN_A, TOKEN_B, TOKEN_C, launchRef, world } from "./fake-chain.ts";

const knobs = (o: Partial<Knobs> = {}): Knobs => ({ count: { kind: "most" }, timing: { kind: "random", minMs: 0, maxMs: 0 }, retries: 1, slippageBps: 300, seed: "s", ...o });

test("swap pairing: the same chain and quote pass", () => {
  checkPair(launchRef(TOKEN_A), launchRef(TOKEN_B));
});

test("swap pairing: two chains are refused by name", () => {
  assert.throws(() => checkPair(launchRef(TOKEN_A, NATIVE, "one"), launchRef(TOKEN_B, NATIVE, "two")), (e: Error) => e instanceof PlanError && /on one chain.*is on one.*on two/s.test(e.message));
});

test("swap pairing: two quote assets are refused, naming both", () => {
  assert.throws(() => checkPair(launchRef(TOKEN_A, NATIVE), launchRef(TOKEN_C, QUOTE_X)), (e: Error) => e instanceof PlanError && /one quote asset/.test(e.message) && /ETH/.test(e.message) && /XUSD/.test(e.message));
});

test("swap pairing: a launch with itself is refused (EVM compares without case)", () => {
  assert.throws(() => checkPair(launchRef(TOKEN_A), launchRef(TOKEN_A.toUpperCase().replace("0X", "0x"))), PlanError);
});

test("buyBudget: the whole sell quote, but the gas coin keeps its reserve", () => {
  assert.equal(buyBudget(100n, false, 0n, 50n), 100n);
  assert.equal(buyBudget(100n, true, 1000n, 50n), 100n);
  assert.equal(buyBudget(100n, true, 120n, 50n), 70n);
  assert.equal(buyBudget(100n, true, 40n, 50n), 0n);
  assert.equal(buyBudget(0n, false, 0n, 0n), 0n);
});

test("swap: each wallet sells A and buys B with what the sell returned; both fills are recorded", async () => {
  const { s, c, wallets } = world(3);
  for (const w of wallets) c.give(TOKEN_A, w.evm!, 5n * 10n ** 15n);
  const from = launchRef(TOKEN_A);
  const to = launchRef(TOKEN_B);
  const logs: string[] = [];
  const r = await swap(s, from, to, wallets, { pct: 100 }, knobs(), (l) => logs.push(l));
  assert.equal(r.swaps.length, 3);
  assert.ok(r.swaps.every((l) => l.status === "swapped" && l.quoteLeft === 0n));
  for (const w of wallets) {
    const sold = c.calls.find((x) => x.startsWith(`sell:${w.id}:`))!.split(":");
    const bought = c.calls.find((x) => x.startsWith(`buy:${w.id}:`))!.split(":");
    // the buy spends exactly the sell's quote: 10¹² token units per quote unit
    assert.equal(BigInt(bought[3]!), BigInt(sold[3]!) / 10n ** 12n);
    assert.equal(bought[2], TOKEN_B);
    assert.equal(await c.balanceOf(TOKEN_A, w.evm!), 0n);
    assert.ok((await c.balanceOf(TOKEN_B, w.evm!)) > 0n);
    assert.ok(s.store.touched(w.id, `fake:${TOKEN_A}`) && s.store.touched(w.id, `fake:${TOKEN_B}`));
    assert.equal(s.store.position(w.id, `fake:${TOKEN_A}`).tokens, 0n, "the sell fill nets the position to zero... ");
  }
  assert.equal((s.store.run(r.runId!) as { status: string }).status, "done");
});

test("swap: a sell that lands with a buy that fails is reported per wallet and the sell is never repeated", async () => {
  const { s, c, wallets } = world(3);
  for (const w of wallets) c.give(TOKEN_A, w.evm!, 5n * 10n ** 15n);
  c.buyFails.set(2, new SendError("SlippageExceeded", true));
  const logs: string[] = [];
  const r = await swap(s, launchRef(TOKEN_A), launchRef(TOKEN_B), wallets, { pct: 100 }, knobs({ retries: 3 }), (l) => logs.push(l));
  const stuck = r.swaps.filter((l) => l.status === "sold-only");
  assert.deepEqual(stuck.map((l) => l.id), [2]);
  assert.match(stuck[0]!.buyError!, /SlippageExceeded/);
  assert.equal(stuck[0]!.quoteLeft, stuck[0]!.sold.quote, "the whole quote is left in the wallet");
  assert.equal(c.calls.filter((x) => x.startsWith("sell:2:")).length, 1, "wallet 2 sold once");
  assert.equal(c.calls.filter((x) => x.startsWith("buy:2:")).length, 1, "a fatal buy is not retried");
  assert.equal(await c.balanceOf(NATIVE, wallets[1]!.evm!), 1000n + stuck[0]!.sold.quote, "the quote it got is in the wallet");
  assert.equal(r.report!.status, "done", "the sells all landed");
  assert.equal((s.store.run(r.runId!) as { status: string }).status, "partial", "but the run is partial");
  assert.ok(logs.some((l) => /wallet 2 sold but did not buy/.test(l)));
  assert.ok(logs.some((l) => /1 wallet sold without buying/.test(l)));
});

test("swap: a retryable buy failure is tried again, a sell is not", async () => {
  const { s, c, wallets } = world(1);
  c.give(TOKEN_A, wallets[0]!.evm!, 5n * 10n ** 15n);
  let n = 0;
  const buy = c.buy.bind(c);
  c.buy = async (...a: Parameters<typeof buy>) => {
    if (n++ === 0) throw new SendError("slippage", false);
    return buy(...a);
  };
  const r = await swap(s, launchRef(TOKEN_A), launchRef(TOKEN_B), wallets, { pct: 100 }, knobs({ retries: 2 }), () => {});
  assert.equal(r.swaps[0]!.status, "swapped");
  assert.equal(c.calls.filter((x) => x.startsWith("sell:")).length, 1);
});

test("swap: a failed sell is the executor's to retry or re-route; no buy happens for it", async () => {
  const { s, c, wallets } = world(2);
  for (const w of wallets) c.give(TOKEN_A, w.evm!, 5n * 10n ** 15n);
  c.sellFails.set(1, new SendError("reverted", true));
  const r = await swap(s, launchRef(TOKEN_A), launchRef(TOKEN_B), wallets, { pct: 100 }, knobs(), () => {});
  assert.ok(!r.swaps.some((l) => l.id === 1));
  assert.equal(c.calls.filter((x) => x.startsWith("buy:1:")).length, 0);
});

test("swap: refused before anything is sent when the quotes differ", async () => {
  const { s, c, wallets } = world(1);
  await assert.rejects(swap(s, launchRef(TOKEN_A), launchRef(TOKEN_C, QUOTE_X), wallets, { pct: 100 }, knobs(), () => {}), /one quote asset/);
  assert.equal(c.calls.length, 0);
});

test("swap --dry-run plans and sends nothing", async () => {
  const { s, c, wallets } = world(2);
  for (const w of wallets) c.give(TOKEN_A, w.evm!, 5n * 10n ** 15n);
  const r = await swap(s, launchRef(TOKEN_A), launchRef(TOKEN_B), wallets, { pct: 50 }, knobs({ dryRun: true }), () => {});
  assert.equal(r.runId, null);
  assert.equal(r.swaps.length, 0);
  assert.equal(c.calls.length, 0);
  assert.ok(r.plan.parts.length === 2);
});
