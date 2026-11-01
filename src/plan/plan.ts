// The planner: Count · Pick · Split. Pure: candidates and settings in, parts out, nothing sent.
import { rng as makeRng, type Rng } from "./rng.ts";

export type Count =
  | { kind: "most"; max?: number }
  | { kind: "min" }
  | { kind: "exact"; n: number }
  | { kind: "random"; min: number; max: number }
  | { kind: "pct"; pct: number };

export type Pick = "random" | "least_used" | "fresh" | "holders" | "richest" | "ordered";

export type Split = { kind: "weights"; min: number; max: number } | { kind: "by_balance" } | { kind: "equal" };

/** The general settings (S13): the per-wallet amount band in the command's unit, and the wallet-count band. */
export interface Bands {
  perWallet: { min: bigint; max: bigint | null };
  wallets: { min: number; max: number };
}

export interface Candidate {
  id: number;
  /** What this wallet can put in, in the command's unit: spendable quote for a buy, its holding for a sell. */
  cap: bigint;
  /** What `by_balance` and `richest` weigh by (usually = cap). */
  balance: bigint;
  /** The target's token held (for `holders`). */
  holds: bigint;
  /** ms since epoch of its last send, 0 = never (for `least_used`). */
  lastUsed: number;
  /** Has it ever traded the target (for `fresh`). */
  touched: boolean;
}

export interface PlanInput {
  total: bigint;
  candidates: readonly Candidate[];
  count: Count;
  pick: Pick;
  split: Split;
  bands: Bands;
  seed?: string;
}

export interface Part {
  id: number;
  amount: bigint;
  /** The most this wallet may end up with, re-routed parts included. */
  hi: bigint;
}

export interface Plan {
  seed: string;
  total: bigint;
  parts: Part[];
  /** Eligible wallets not picked, in pick order: where re-routed parts go once the picked ones are full. */
  reserves: Part[];
  lo: bigint;
}

export class PlanError extends Error {
  override name = "PlanError";
}

const minB = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Each wallet's upper bound: the band's max and what it holds or can spend. */
const hiOf = (c: Candidate, b: Bands): bigint => (b.perWallet.max === null ? c.cap : minB(c.cap, b.perWallet.max));

export function order(cands: readonly Candidate[], pick: Pick, r: Rng): Candidate[] {
  // ties always break randomly, so two equal wallets don't always go in id order
  const shuffled = r.shuffle(cands);
  switch (pick) {
    case "random":
      return shuffled;
    case "ordered":
      return [...cands].sort((a, b) => a.id - b.id);
    case "least_used":
      return shuffled.sort((a, b) => a.lastUsed - b.lastUsed);
    case "fresh":
      return shuffled.filter((c) => !c.touched);
    case "holders":
      return shuffled.filter((c) => c.holds > 0n);
    case "richest":
      return shuffled.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
  }
}

/** How many wallets, over the ordered eligible list. */
export function countOf(total: bigint, ordered: readonly Candidate[], count: Count, bands: Bands, r: Rng): number {
  const lo = bands.perWallet.min;
  const cap = Math.min(ordered.length, bands.wallets.max);
  const his = ordered.map((c) => hiOf(c, bands));
  let n: number;
  switch (count.kind) {
    case "most": {
      const byMin = lo > 0n ? Number(minB(total / lo, BigInt(Number.MAX_SAFE_INTEGER))) : Number.MAX_SAFE_INTEGER;
      n = Math.min(count.max ?? bands.wallets.max, cap, byMin);
      break;
    }
    case "min": {
      // the fewest, in pick order, whose room covers the total
      n = Math.max(bands.wallets.min, 1);
      let room = his.slice(0, n).reduce((s, h) => s + h, 0n);
      while (room < total && n < cap) room += his[n++]!;
      if (bands.perWallet.max !== null) n = Math.max(n, Number(ceilDiv(total, bands.perWallet.max)));
      break;
    }
    case "exact":
      n = count.n;
      break;
    case "random":
      n = count.min + r.int(count.max - count.min + 1);
      break;
    case "pct":
      n = Math.ceil((ordered.length * count.pct) / 100);
      break;
  }
  return n;
}

/** Fails before anything is sent, naming the bound that broke. */
function feasible(total: bigint, n: number, picked: readonly Part[], eligible: number, bands: Bands, unit: (x: bigint) => string): void {
  if (eligible === 0) throw new PlanError("no eligible wallet (assigned, funded, and matching the pick rule)");
  if (n < bands.wallets.min) throw new PlanError(`${n} wallets is under the wallets-per-command minimum ${bands.wallets.min}`);
  if (n > bands.wallets.max) throw new PlanError(`${n} wallets is over the wallets-per-command maximum ${bands.wallets.max}`);
  if (n > eligible) throw new PlanError(`needs ${n} wallets; ${eligible} eligible`);
  const lo = bands.perWallet.min;
  if (BigInt(n) * lo > total) throw new PlanError(`${unit(total)} across ${n} wallets is under the per-wallet minimum ${unit(lo)}`);
  const room = picked.reduce((s, p) => s + p.hi, 0n);
  if (room < total) {
    const why = bands.perWallet.max !== null && picked.every((p) => p.hi === bands.perWallet.max) ? `at ${unit(bands.perWallet.max)} max` : "at what they hold or can spend";
    throw new PlanError(`${unit(total)} needs more room than ${n} wallets have ${why} (${unit(room)})`);
  }
  for (const p of picked) if (p.hi < lo) throw new PlanError(`wallet ${p.id} can put in only ${unit(p.hi)}, under the per-wallet minimum ${unit(lo)}`);
}

const SCALE = 1n << 64n;
const WEIGHT_BITS = 1n << 40n;

/** Raw weights for the split, scaled so the largest is 2⁴⁰ (keeps the rounding dust under n units). */
function weightsOf(cands: readonly Candidate[], split: Split, r: Rng): bigint[] {
  let raw: bigint[];
  switch (split.kind) {
    case "equal":
      raw = cands.map(() => 1n);
      break;
    case "by_balance":
      raw = cands.map((c) => (c.balance > 0n ? c.balance : 1n));
      break;
    case "weights": {
      if (!(split.min >= 0 && split.max <= 1 && split.min <= split.max)) throw new PlanError("weights need 0 ≤ min ≤ max ≤ 1");
      raw = cands.map(() => BigInt(Math.max(1, Math.round(r.between(split.min, split.max) * 1e12))));
      break;
    }
  }
  const top = raw.reduce((m, w) => (w > m ? w : m), 1n);
  return raw.map((w) => {
    const s = (w * WEIGHT_BITS) / top;
    return s > 0n ? s : 1n;
  });
}

/**
 * The bounded proportional split: partᵢ = clamp(λ·wᵢ, lo, hiᵢ) with λ chosen so Σ partᵢ = total. With no clamp this is
 * exactly total·wᵢ/Σw. Σ is non-decreasing in λ, so λ is found by bisection; the < n units of rounding dust go one unit at a
 * time to the heaviest wallets with room.
 */
export function boundedSplit(total: bigint, weights: readonly bigint[], lo: bigint, his: readonly bigint[]): bigint[] {
  const n = weights.length;
  const at = (lam: bigint): bigint[] =>
    weights.map((w, i) => {
      const p = (lam * w) / SCALE;
      return p < lo ? lo : p > his[i]! ? his[i]! : p;
    });
  const sum = (xs: readonly bigint[]): bigint => xs.reduce((s, x) => s + x, 0n);
  const maxHi = his.reduce((m, h) => (h > m ? h : m), 0n);
  let a = 0n;
  let b = ((maxHi + 1n) * SCALE) / weights.reduce((m, w) => (w < m ? w : m), weights[0]!) + 1n;
  while (b - a > 1n) {
    const m = (a + b) / 2n;
    if (sum(at(m)) <= total) a = m;
    else b = m;
  }
  const parts = at(a);
  let dust = total - sum(parts);
  const byWeight = [...Array(n).keys()].sort((i, j) => (weights[j]! > weights[i]! ? 1 : weights[j]! < weights[i]! ? -1 : i - j));
  while (dust > 0n) {
    let moved = false;
    for (const i of byWeight) {
      if (dust === 0n) break;
      if (parts[i]! < his[i]!) {
        parts[i] = parts[i]! + 1n;
        dust -= 1n;
        moved = true;
      }
    }
    if (!moved) throw new PlanError("no room left for the rounding dust");
  }
  return parts;
}

export function plan(input: PlanInput, unit: (x: bigint) => string = String): Plan {
  const r = makeRng(input.seed);
  if (input.total <= 0n) throw new PlanError("the total must be > 0");
  // a wallet that can't reach the per-wallet minimum can't take part: it is not eligible (rather than failing the command)
  const ordered = order(input.candidates.filter((c) => hiOf(c, input.bands) >= input.bands.perWallet.min && hiOf(c, input.bands) > 0n), input.pick, r);
  const n = countOf(input.total, ordered, input.count, input.bands, r);
  const toPart = (c: Candidate): Part => ({ id: c.id, amount: 0n, hi: hiOf(c, input.bands) });
  const picked = ordered.slice(0, Math.max(0, n)).map(toPart);
  feasible(input.total, n, picked, ordered.length, input.bands, unit);
  const amounts = boundedSplit(input.total, weightsOf(ordered.slice(0, n), input.split, r), input.bands.perWallet.min, picked.map((p) => p.hi));
  picked.forEach((p, i) => (p.amount = amounts[i]!));
  return { seed: r.seed, total: input.total, parts: picked, reserves: ordered.slice(n).map(toPart), lo: input.bands.perWallet.min };
}

/** Every part's amount and room rounded down to a multiple of `step` (zero parts dropped); the total is their sum. */
export function quantize(p: Plan, step: bigint): Plan {
  if (step <= 1n) return p;
  const down = (x: bigint): bigint => x - (x % step);
  const each = (xs: readonly Part[]): Part[] => xs.map((x) => ({ ...x, amount: down(x.amount), hi: down(x.hi) })).filter((x) => x.hi > 0n);
  const parts = each(p.parts).filter((x) => x.amount > 0n);
  return { ...p, parts, reserves: each(p.reserves), total: parts.reduce((t, x) => t + x.amount, 0n) };
}
