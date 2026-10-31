// claim: who is owed, who is skipped, what is reported, and how --all-launches finds launches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PlanError } from "../../src/plan/plan.ts";
import { claim, hasOwed, owedAny, owedLines } from "../../src/commands/claim.ts";
import type { WalletOwed } from "../../src/chains/chain.ts";
import { NATIVE, TOKEN_A, TOKEN_B, launchRef, world, zeroOwed } from "./fake-chain.ts";

const A = launchRef(TOKEN_A);
const owedOf = (o: Partial<ReturnType<typeof zeroOwed>>, extra: WalletOwed["extra"] = []): WalletOwed => ({ launches: [{ launch: A, owed: { ...zeroOwed(), ...o } }], extra, raw: null });

test("hasOwed: zero everywhere is not owed; any leg or extra is", () => {
  assert.ok(!hasOwed(owedOf({})));
  assert.ok(!owedAny(zeroOwed()));
  for (const k of ["creator", "creatorRef", "teamSlot", "holder", "teamBuy", "shareBought"] as const) assert.ok(hasOwed(owedOf({ [k]: 1n })), k);
  assert.ok(hasOwed(owedOf({}, [{ quote: NATIVE, kind: "traderRef", amount: 1n }])));
  assert.ok(!hasOwed(owedOf({}, [{ quote: NATIVE, kind: "payout", amount: 0n }])));
});

test("owedLines: one line per thing owed, quote legs in the quote and token legs in tokens", () => {
  const lines = owedLines(owedOf({ creator: 10n ** 16n, teamBuy: 5n * 10n ** 18n }, [{ quote: NATIVE, kind: "traderRef", amount: 7n }]), () => "ETH");
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^creator .*ETH/);
  assert.match(lines[1]!, /^teamBuy .*tokens/);
  assert.match(lines[2]!, /^traderRef 7 .* in ETH/);
});

test("claim: owed wallets claim, wallets owed nothing are skipped and send nothing", async () => {
  const { s, c, wallets } = world(4);
  c.owed.set(1, owedOf({ creator: 5n }));
  c.owed.set(3, owedOf({ holder: 2n, teamBuy: 9n }));
  const r = await claim(s, { target: A }, wallets, () => {});
  const by = new Map(r.wallets.map((w) => [w.id, w]));
  assert.equal(by.get(1)!.status, "claimed");
  assert.equal(by.get(2)!.status, "skipped");
  assert.equal(by.get(3)!.status, "claimed");
  assert.equal(by.get(4)!.status, "skipped");
  assert.deepEqual(c.claimed.map((x) => x.id).sort(), [1, 3]);
  assert.deepEqual(by.get(2)!.txs, []);
  assert.equal(by.get(1)!.claimed[0]!.amount, 5n);
  assert.equal(by.get(1)!.claimed[0]!.symbol, "ETH");
  const run = s.store.run(r.runId!) as { status: string };
  assert.equal(run.status, "done");
});

test("claim: a failed wallet is reported, the others still claim, the run is partial", async () => {
  const { s, c, wallets } = world(3);
  for (const id of [1, 2, 3]) c.owed.set(id, owedOf({ creator: 1n }));
  c.claimFails.add(2);
  const r = await claim(s, { target: A }, wallets, () => {});
  assert.deepEqual(r.wallets.map((w) => w.status), ["claimed", "failed", "claimed"]);
  assert.match(r.wallets[1]!.error!, /ClaimsShort/);
  assert.equal((s.store.run(r.runId!) as { status: string }).status, "partial");
});

test("claim: an unreadable wallet is failed, not skipped", async () => {
  const { s, c, wallets } = world(2);
  c.owed.set(1, owedOf({ creator: 1n }));
  const read = c.owedOf.bind(c);
  c.owedOf = async (w, l) => {
    if (w.id === 2) throw new Error("rpc down");
    return read(w, l);
  };
  const r = await claim(s, { target: A }, wallets, () => {});
  assert.equal(r.wallets.find((w) => w.id === 2)!.status, "failed");
  assert.match(r.wallets.find((w) => w.id === 2)!.error!, /rpc down/);
});

test("claim --dry-run reads and reports what is owed, sends nothing, records no run", async () => {
  const { s, c, wallets } = world(2);
  c.owed.set(1, owedOf({ creator: 5n }));
  const r = await claim(s, { target: A, dryRun: true }, wallets, () => {});
  assert.equal(r.runId, null);
  assert.equal(r.wallets[0]!.status, "owed");
  assert.equal(r.wallets[1]!.status, "skipped");
  assert.equal(c.claimed.length, 0);
});

test("claim --to is passed through to the adapter and checked as an address", async () => {
  const { s, c, wallets } = world(1);
  c.owed.set(1, owedOf({ creator: 5n }));
  const to = "0x00000000000000000000000000000000000000f1";
  await claim(s, { target: A, to }, wallets, () => {});
  assert.equal(c.claimed[0]!.to, to);
  await assert.rejects(claim(s, { target: A, to: "nope" }, wallets, () => {}), /not an address/);
});

test("claim: a target xor --all-launches", async () => {
  const { s, wallets } = world(1);
  await assert.rejects(claim(s, {}, wallets, () => {}), PlanError);
  await assert.rejects(claim(s, { target: A, allLaunches: true }, wallets, () => {}), PlanError);
});

test("claim --all-launches reads every launch the swarm touched or made, once", async () => {
  const { s, c, wallets } = world(2);
  await assert.rejects(claim(s, { allLaunches: true }, wallets, () => {}), /no launch yet/);
  s.store.noteLaunch(`fake:${TOKEN_A}`, 1, "created");
  s.store.noteLaunch(`fake:${TOKEN_A}`, 2, "slot");
  s.store.noteLaunch(`fake:${TOKEN_B}`, 2, "slot");
  const r = await claim(s, { allLaunches: true }, wallets, () => {});
  assert.deepEqual([...r.launches].sort(), [`fake:${TOKEN_A}`, `fake:${TOKEN_B}`]);
  assert.ok(c.calls.includes("owedOf:1:2"), "both launches are read in one call per wallet");
});
