// snipe: the filter, the window, and the hand-off to `buy` (stubbed, and the real one on the fake chain).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PlanError } from "../../src/plan/plan.ts";
import { matchesFilter, parseFilter, parseWithin, snipe, DEFAULT_WITHIN_SECS } from "../../src/commands/snipe.ts";
import { buy, type Knobs } from "../../src/commands/trade.ts";
import type { CreatedLaunch } from "../../src/chains/chain.ts";
import { NATIVE, TOKEN_B, launchRef, world } from "./fake-chain.ts";

const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const CREATOR = "0x00000000000000000000000000000000000000Ab";
const knobs = (o: Partial<Knobs> = {}): Knobs => ({ count: { kind: "most" }, timing: { kind: "instant" }, retries: 1, slippageBps: 300, seed: "s", ...o });
const made = (symbol: string, creator = CREATOR): CreatedLaunch => ({ launch: launchRef(TOKEN_B), creator, name: `${symbol} coin`, symbol });

test("parseFilter: exactly one of creator, symbol, any", () => {
  assert.deepEqual(parseFilter({ any: true }, isAddr), { any: true });
  assert.deepEqual(parseFilter({ symbol: " PEPE " }, isAddr), { symbol: "PEPE" });
  assert.deepEqual(parseFilter({ creator: CREATOR }, isAddr), { creator: CREATOR });
  assert.throws(() => parseFilter({}, isAddr), PlanError);
  assert.throws(() => parseFilter({ any: true, symbol: "X" }, isAddr), /exactly one/);
  assert.throws(() => parseFilter({ creator: "nope" }, isAddr), /not an address/);
  assert.throws(() => parseFilter({ symbol: "  " }, isAddr), /empty/);
});

test("matchesFilter: creator without case on EVM and exactly on Solana, ticker without case", () => {
  assert.ok(matchesFilter({ any: true }, made("A"), "evm"));
  assert.ok(matchesFilter({ creator: CREATOR.toLowerCase() }, made("A"), "evm"));
  assert.ok(!matchesFilter({ creator: CREATOR.toLowerCase() }, made("A"), "solana"));
  assert.ok(!matchesFilter({ creator: "0x00000000000000000000000000000000000000ff" }, made("A"), "evm"));
  assert.ok(matchesFilter({ symbol: "pepe" }, made("PEPE"), "evm"));
  assert.ok(matchesFilter({ symbol: "pepe" }, made("PEPE"), "solana"));
  assert.ok(!matchesFilter({ symbol: "pepe" }, made("PEPES"), "evm"));
  assert.ok(!matchesFilter({}, made("A"), "evm"));
});

test("parseWithin: default 600, a positive number otherwise", () => {
  assert.equal(parseWithin(undefined), DEFAULT_WITHIN_SECS);
  assert.equal(DEFAULT_WITHIN_SECS, 600);
  assert.equal(parseWithin("2.5"), 2.5);
  assert.throws(() => parseWithin("0"), PlanError);
  assert.throws(() => parseWithin("abc"), PlanError);
});

test("snipe: a match runs buy on the launch with the total in the launch's quote", async () => {
  const { s, c, wallets } = world(3);
  c.created = [made("NOPE"), made("PEPE")];
  const seen: { token: string; total: bigint; n: number }[] = [];
  const r = await snipe(s, { chain: "fake", total: "1.5", filter: { symbol: "pepe" }, withinSecs: 5 }, wallets, knobs(), () => {}, {
    buy: async (_s, l, ws, total) => {
      seen.push({ token: l.token, total, n: ws.length });
      return { runId: 99, plan: null, report: { status: "done", landed: 3, planned: 3 } } as never;
    },
  });
  assert.ok(r.matched);
  assert.deepEqual(seen, [{ token: TOKEN_B, total: 1_500_000_000_000_000_000n, n: 3 }]);
  assert.equal(r.launch!.symbol, "PEPE");
  assert.equal(r.buy!.runId, 99);
  assert.equal((s.store.run(r.runId!) as { status: string }).status, "done");
});

test("snipe: no match inside the window is a clear result, no buy, and the run is recorded", async () => {
  const { s, c, wallets } = world(2);
  c.created = [made("NOPE")];
  let bought = false;
  const logs: string[] = [];
  const r = await snipe(s, { chain: "fake", total: "1", filter: { symbol: "pepe" }, withinSecs: 1 }, wallets, knobs(), (l) => logs.push(l), { buy: async () => ((bought = true), null as never) });
  assert.equal(r.matched, false);
  assert.equal(r.launch, null);
  assert.equal(bought, false);
  assert.ok(logs.some((l) => /no launch matched symbol pepe within 1 s/.test(l)));
  assert.equal((s.store.run(r.runId!) as { status: string }).status, "failed");
});

test("snipe --dry-run watches but records nothing", async () => {
  const { s, c, wallets } = world(1);
  c.created = [made("PEPE")];
  const r = await snipe(s, { chain: "fake", total: "1", filter: { any: true }, withinSecs: 5 }, wallets, knobs({ dryRun: true }), () => {}, { buy: async () => ({ runId: null, plan: null, report: null }) as never });
  assert.ok(r.matched);
  assert.equal(r.runId, null);
});

test("snipe: a bad total or no usable wallet is refused before watching", async () => {
  const { s, c, wallets } = world(1);
  await assert.rejects(snipe(s, { chain: "fake", total: "1e3", filter: { any: true }, withinSecs: 5 }, wallets, knobs(), () => {}), /an amount/);
  await assert.rejects(snipe(s, { chain: "fake", total: "1", filter: { any: true }, withinSecs: 5 }, [{ ...wallets[0]!, evm: null }], knobs(), () => {}), /no selected wallet/);
  assert.equal(c.marks, 0);
});

test("snipe: with the real buy, every wallet buys the new launch at once", async () => {
  const { s, c, wallets } = world(3);
  c.created = [made("PEPE")];
  for (const w of wallets) c.give(NATIVE, w.evm!, 10n ** 18n);
  const r = await snipe(s, { chain: "fake", total: "0.3", filter: { creator: CREATOR }, withinSecs: 5 }, wallets, knobs(), () => {}, { buy });
  assert.ok(r.matched);
  assert.equal(c.calls.filter((x) => x.startsWith("buy:")).length, 3);
  assert.equal(r.buy!.report!.status, "done");
});
