import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedSplit, plan, PlanError, quantize, type Bands, type Candidate, type Count, type Pick, type Split } from "../../src/plan/plan.ts";
import { rng } from "../../src/plan/rng.ts";

const E = 10n ** 18n;
const cand = (id: number, cap: bigint, extra: Partial<Candidate> = {}): Candidate => ({ id, cap, balance: cap, holds: 0n, lastUsed: 0, touched: false, ...extra });
const many = (n: number, cap: bigint): Candidate[] => [...Array(n).keys()].map((i) => cand(i, cap));
const bands = (lo: bigint, hi: bigint | null, nMin = 1, nMax = 1000): Bands => ({ perWallet: { min: lo, max: hi }, wallets: { min: nMin, max: nMax } });

test("the design's example: 10 ETH, band 0.1–1, 5–50 wallets, 200 assigned", () => {
  const b = bands(E / 10n, E, 5, 50);
  const most = plan({ total: 10n * E, candidates: many(200, 100n * E), count: { kind: "most", max: 40 }, pick: "random", split: { kind: "weights", min: 0.2, max: 1 }, bands: b, seed: "x" });
  assert.equal(most.parts.length, 40);
  const min = plan({ total: 10n * E, candidates: many(200, 100n * E), count: { kind: "min" }, pick: "random", split: { kind: "weights", min: 0.2, max: 1 }, bands: b, seed: "x" });
  assert.equal(min.parts.length, 10);
  // Min at 1 ETH max over 10 wallets forces every part to exactly 1 ETH
  assert.ok(min.parts.every((p) => p.amount === E));
});

test("infeasible commands fail before anything is sent, naming the bound", () => {
  const b = bands(E / 10n, E, 5, 50);
  assert.throws(() => plan({ total: 10n * E, candidates: many(6, 100n * E), count: { kind: "min" }, pick: "random", split: { kind: "equal" }, bands: b }), (e: Error) => e instanceof PlanError && /needs 10 wallets; 6 eligible/.test(e.message));
  assert.throws(() => plan({ total: E / 10n, candidates: many(20, 100n * E), count: { kind: "exact", n: 5 }, pick: "random", split: { kind: "equal" }, bands: b }), /under the per-wallet minimum/);
  assert.throws(() => plan({ total: 10n * E, candidates: many(20, E / 5n), count: { kind: "exact", n: 20 }, pick: "random", split: { kind: "equal" }, bands: b }), /needs more room/);
  assert.throws(() => plan({ total: 10n * E, candidates: many(20, 100n * E), count: { kind: "exact", n: 3 }, pick: "random", split: { kind: "equal" }, bands: b }), /under the wallets-per-command minimum 5/);
});

test("unclamped weights split exactly total·w/Σw (±1 unit of dust)", () => {
  const w = [3n, 1n, 6n];
  const parts = boundedSplit(1000n, w, 0n, [10_000n, 10_000n, 10_000n]);
  assert.deepEqual(parts, [300n, 100n, 600n]);
  const odd = boundedSplit(1001n, w, 0n, [10_000n, 10_000n, 10_000n]);
  assert.equal(odd.reduce((s, x) => s + x, 0n), 1001n);
});

test("property: Σ parts = total, every part in [lo, hiᵢ], over 2,000 random commands", () => {
  const r = rng("property");
  const counts: Count[] = [{ kind: "most" }, { kind: "min" }, { kind: "exact", n: 7 }, { kind: "random", min: 3, max: 30 }, { kind: "pct", pct: 40 }];
  const picks: Pick[] = ["random", "least_used", "fresh", "holders", "richest", "ordered"];
  const splits: Split[] = [{ kind: "weights", min: 0, max: 1 }, { kind: "weights", min: 0.2, max: 1 }, { kind: "weights", min: 0.5, max: 0.5 }, { kind: "by_balance" }, { kind: "equal" }];
  let ran = 0;
  for (let k = 0; k < 2000; k++) {
    const n = 1 + r.int(300);
    const cands = [...Array(n).keys()].map((i) =>
      cand(i, BigInt(1 + r.int(1_000_000)) * 10n ** 12n, { holds: r.next() < 0.5 ? 1n : 0n, touched: r.next() < 0.3, lastUsed: r.int(1000), balance: BigInt(r.int(1e9)) }),
    );
    const lo = BigInt(r.int(1000)) * 10n ** 12n;
    const hi = r.next() < 0.3 ? null : lo + BigInt(1 + r.int(2_000_000)) * 10n ** 12n;
    const total = BigInt(1 + r.int(50_000_000)) * 10n ** 12n + BigInt(r.int(1000));
    const b = bands(lo, hi, 1 + r.int(3), 5 + r.int(400));
    try {
      const p = plan({ total, candidates: cands, count: counts[r.int(counts.length)]!, pick: picks[r.int(picks.length)]!, split: splits[r.int(splits.length)]!, bands: b, seed: String(k) });
      ran++;
      assert.equal(p.parts.reduce((s, x) => s + x.amount, 0n), total);
      for (const x of p.parts) {
        assert.ok(x.amount >= lo, `part ${x.amount} < lo ${lo}`);
        assert.ok(x.amount <= x.hi, `part ${x.amount} > hi ${x.hi}`);
        if (hi !== null) assert.ok(x.hi <= hi);
      }
      assert.ok(p.parts.length >= b.wallets.min && p.parts.length <= b.wallets.max);
      assert.equal(new Set(p.parts.map((x) => x.id)).size, p.parts.length);
    } catch (e) {
      if (!(e instanceof PlanError)) throw e;
    }
  }
  assert.ok(ran > 300, `only ${ran} feasible cases`);
});

test("the same seed replays the same plan", () => {
  const input = { total: 7n * E, candidates: many(50, 10n * E), count: { kind: "random", min: 5, max: 20 } as Count, pick: "random" as Pick, split: { kind: "weights", min: 0, max: 1 } as Split, bands: bands(1n, null), seed: "replay" };
  assert.deepEqual(plan(input), plan(input));
});

test("pick rules: holders, fresh, least_used, richest", () => {
  const cs = [cand(0, E, { holds: 5n, lastUsed: 30, touched: true }), cand(1, 3n * E, { lastUsed: 10 }), cand(2, 2n * E, { holds: 1n, lastUsed: 20 })];
  const ids = (pick: Pick): number[] => plan({ total: 3n, candidates: cs, count: { kind: "most" }, pick, split: { kind: "equal" }, bands: bands(1n, null), seed: "p" }).parts.map((p) => p.id);
  assert.deepEqual(ids("holders").sort(), [0, 2]);
  assert.deepEqual(ids("fresh").sort(), [1, 2]);
  assert.deepEqual(ids("least_used"), [1, 2, 0]);
  assert.deepEqual(ids("richest"), [1, 2, 0]);
  assert.deepEqual(ids("ordered"), [0, 1, 2]);
});

test("by_balance sells pro rata to what each holds", () => {
  const cs = [cand(0, 100n), cand(1, 300n), cand(2, 600n)];
  const p = plan({ total: 500n, candidates: cs, count: { kind: "most" }, pick: "ordered", split: { kind: "by_balance" }, bands: bands(1n, null), seed: "b" });
  assert.deepEqual(p.parts.map((x) => x.amount), [50n, 150n, 300n]);
});

test("quantize: EVM sell parts become whole 10¹² steps, the total their sum, dust parts dropped", () => {
  const S = 10n ** 12n;
  const q = quantize({ seed: "s", total: 0n, lo: 0n, parts: [{ id: 1, amount: 3n * S + 5n, hi: 6n * S + 1n }, { id: 2, amount: S - 1n, hi: S - 1n }], reserves: [{ id: 3, amount: 0n, hi: 2n * S + 7n }] }, S);
  assert.deepEqual(q.parts, [{ id: 1, amount: 3n * S, hi: 6n * S }]);
  assert.deepEqual(q.reserves, [{ id: 3, amount: 0n, hi: 2n * S }]);
  assert.equal(q.total, 3n * S);
  const same = { seed: "s", total: 7n, lo: 0n, parts: [{ id: 1, amount: 7n, hi: 9n }], reserves: [] };
  assert.equal(quantize(same, 1n), same);
});
