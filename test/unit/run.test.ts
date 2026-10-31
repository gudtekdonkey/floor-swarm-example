import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, type Bands, type Candidate } from "../../src/plan/plan.ts";
import { execute, type Send, type Timing } from "../../src/exec/run.ts";
import { rng } from "../../src/plan/rng.ts";

const cand = (id: number, cap: bigint): Candidate => ({ id, cap, balance: cap, holds: 0n, lastUsed: 0, touched: false });
const bands = (lo: bigint, hi: bigint | null): Bands => ({ perWallet: { min: lo, max: hi }, wallets: { min: 1, max: 1000 } });
const noSleep = async (): Promise<void> => {};

for (const timing of [{ kind: "instant" }, { kind: "random", minMs: 1, maxMs: 5 }] as Timing[]) {
  test(`${timing.kind}: a failed wallet's part is re-routed and the total still lands`, async () => {
    const p = plan({ total: 1000n, candidates: [...Array(20).keys()].map((i) => cand(i, 200n)), count: { kind: "exact", n: 10 }, pick: "ordered", split: { kind: "equal" }, bands: bands(10n, 200n), seed: "r" });
    const per = new Map<number, bigint>();
    const send: Send = async (id, amount) => {
      if (id === 3 || id === 7) return { ok: false, error: "reverted", fatal: true };
      per.set(id, (per.get(id) ?? 0n) + amount);
      return { ok: true, tx: `0x${id}` };
    };
    const rep = await execute(p, send, { timing, retries: 2, rng: rng("t"), sleep: noSleep });
    assert.equal(rep.status, "done");
    assert.equal(rep.landed, 1000n);
    assert.equal([...per.values()].reduce((s, x) => s + x, 0n), 1000n);
    for (const v of per.values()) assert.ok(v <= 200n, `a wallet took ${v} > 200`);
    assert.ok(!per.has(3) && !per.has(7));
  });

  test(`${timing.kind}: reserves join when the picked wallets are full`, async () => {
    const p = plan({ total: 1000n, candidates: [...Array(12).keys()].map((i) => cand(i, 100n)), count: { kind: "exact", n: 10 }, pick: "ordered", split: { kind: "equal" }, bands: bands(10n, 100n), seed: "r" });
    const used = new Set<number>();
    const send: Send = async (id) => (id < 2 ? { ok: false, error: "x", fatal: true } : (used.add(id), { ok: true, tx: "0x" }));
    const rep = await execute(p, send, { timing, retries: 0, rng: rng("t"), sleep: noSleep });
    assert.equal(rep.status, "done");
    assert.ok(used.has(10) && used.has(11));
  });

  test(`${timing.kind}: an unconfirmed send is neither retried nor re-routed (it may still land)`, async () => {
    const p = plan({ total: 1000n, candidates: [...Array(20).keys()].map((i) => cand(i, 200n)), count: { kind: "exact", n: 10 }, pick: "ordered", split: { kind: "equal" }, bands: bands(10n, 200n), seed: "r" });
    const calls = new Map<number, number>();
    const send: Send = async (id) => {
      calls.set(id, (calls.get(id) ?? 0) + 1);
      return id === 4 ? { ok: false, error: "not confirmed", fatal: true, unconfirmed: true } : { ok: true, tx: "0x" };
    };
    const rep = await execute(p, send, { timing, retries: 3, rng: rng("t"), sleep: noSleep });
    assert.equal(calls.get(4), 1, "never retried");
    assert.equal(rep.sends.length, 10, "no extra send carried its part");
    assert.equal(rep.unconfirmed, 100n);
    assert.equal(rep.landed, 900n);
    assert.equal(rep.status, "partial");
  });

  test(`${timing.kind}: no room anywhere → partial, with the shortfall named`, async () => {
    const p = plan({ total: 1000n, candidates: [...Array(10).keys()].map((i) => cand(i, 100n)), count: { kind: "exact", n: 10 }, pick: "ordered", split: { kind: "equal" }, bands: bands(10n, 100n), seed: "r" });
    const rep = await execute(p, async (id) => (id === 0 ? { ok: false, error: "x", fatal: true } : { ok: true, tx: "0x" }), { timing, retries: 0, rng: rng("t"), sleep: noSleep });
    assert.equal(rep.status, "partial");
    assert.equal(rep.shortfall, 100n);
  });
}

test("retries until success, then stops", async () => {
  const p = plan({ total: 10n, candidates: [cand(0, 10n)], count: { kind: "most" }, pick: "ordered", split: { kind: "equal" }, bands: bands(1n, null), seed: "r" });
  let calls = 0;
  const rep = await execute(p, async () => (++calls < 3 ? { ok: false, error: "nonce" } : { ok: true, tx: "0x" }), { timing: { kind: "instant" }, retries: 3, rng: rng("t"), sleep: noSleep });
  assert.equal(calls, 3);
  assert.equal(rep.sends[0]!.attempts, 3);
  assert.equal(rep.status, "done");
});
