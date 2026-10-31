// The trading commands: buy, sell, fund. Each one plans (Count · Pick · Split), then executes (timing,
// retries, re-route) and keeps a per-wallet ledger in the store.
import { plan as makePlan, quantize, type Candidate, type Count, type Pick, type Plan, type Split, PlanError } from "../plan/plan.ts";
import { rng } from "../plan/rng.ts";
import { execute, type RunReport, type Send, type Timing } from "../exec/run.ts";
import { SendError, type Chain, type LaunchRef } from "../chains/chain.ts";
import type { WalletRow } from "../store/db.ts";
import { fmt, type Swarm } from "../swarm.ts";

export interface Knobs {
  count: Count;
  pick?: Pick;
  split?: Split;
  timing: Timing;
  retries: number;
  slippageBps: number;
  seed?: string;
  dryRun?: boolean;
}

export interface CommandResult {
  runId: number | null;
  plan: Plan;
  report: RunReport | null;
  unit: { symbol: string; decimals: number };
}

export type Log = (line: string) => void;

/** Runs `f` over `xs` with at most `n` in flight (RPC-friendly reads over hundreds of wallets). */
export async function pool<T, R>(xs: readonly T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let i = 0;
  await Promise.all(
    [...Array(Math.min(n, xs.length)).keys()].map(async () => {
      while (i < xs.length) {
        const k = i++;
        out[k] = await f(xs[k]!);
      }
    }),
  );
  return out;
}

const targetKey = (l: LaunchRef): string => `${l.chain}:${l.family === "evm" ? l.token.toLowerCase() : l.token}`;

/** The wallets with an address in this chain's family (an imported key is one family's). */
const onChain = (c: Chain, ws: readonly WalletRow[]): WalletRow[] => ws.filter((w) => c.addressOf(w) !== null);

async function run(
  s: Swarm,
  kind: string,
  target: string | null,
  p: Plan,
  knobs: Knobs,
  unit: { symbol: string; decimals: number },
  send: Send,
  log: Log,
): Promise<CommandResult> {
  const lo = p.parts.reduce((m, x) => (x.amount < m ? x.amount : m), p.parts[0]!.amount);
  const hi = p.parts.reduce((m, x) => (x.amount > m ? x.amount : m), 0n);
  log(`${kind}: ${p.parts.length} wallets · parts ${fmt(lo, unit.decimals)}–${fmt(hi, unit.decimals)} · total ${fmt(p.total, unit.decimals, unit.symbol)} · ${p.reserves.length} reserves · seed ${p.seed}`);
  if (knobs.dryRun) return { runId: null, plan: p, report: null, unit };
  const runId = s.store.startRun(kind, target, { knobs, parts: p.parts }, p.seed);
  const report = await execute(p, send, {
    timing: knobs.timing,
    retries: knobs.retries,
    rng: rng(`${p.seed}:timing`),
    onSend: (r) => {
      s.store.recordSend(runId, { id: r.id, wave: r.wave, amount: r.amount, attempts: r.attempts, ok: r.result.ok, tx: r.result.ok ? r.result.tx : undefined, error: r.errors.length ? r.errors.join(" | ") : undefined, at: r.at });
      log(`  ${r.result.ok ? "✓" : "✗"} wallet ${r.id}${r.wave > 1 ? ` (wave ${r.wave})` : ""} ${fmt(r.amount, unit.decimals, unit.symbol)} ${r.result.ok ? r.result.tx : r.result.error}${r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}`);
    },
  });
  s.store.finishRun(runId, report.status, report);
  log(`${kind} ${report.status}: landed ${fmt(report.landed, unit.decimals, unit.symbol)} of ${fmt(report.planned, unit.decimals)}${report.shortfall > 0n ? ` · shortfall ${fmt(report.shortfall, unit.decimals)}` : ""}${report.unconfirmed > 0n ? ` · ${fmt(report.unconfirmed, unit.decimals)} unconfirmed (may still land; not re-routed)` : ""} · run ${runId}`);
  return { runId, plan: p, report, unit };
}

const asSend = (f: (id: number, amount: bigint) => Promise<string>): Send => async (id, amount) => {
  try {
    return { ok: true, tx: await f(id, amount) };
  } catch (e) {
    const err = e instanceof SendError ? e : new SendError((e as Error).message ?? String(e), false);
    return { ok: false, error: err.message, fatal: err.fatal, unconfirmed: err.unconfirmed };
  }
};

async function candidates(s: Swarm, c: Chain, l: LaunchRef, wallets: readonly WalletRow[], side: "buy" | "sell"): Promise<Candidate[]> {
  const reserve = await c.gasReserve();
  const key = targetKey(l);
  return pool(onChain(c, wallets), 16, async (w) => {
    const a = c.addressOf(w)!;
    const [native, quoteBal, holds] = await Promise.all([
      c.balanceOf(c.native, a),
      l.quote.address === c.native ? Promise.resolve(0n) : c.balanceOf(l.quote.address, a),
      c.balanceOf(l.token, a),
    ]);
    const gasOk = native >= reserve;
    let cap: bigint;
    if (side === "sell") cap = gasOk ? holds : 0n;
    else if (l.quote.address === c.native) cap = native > reserve ? native - reserve : 0n;
    else cap = gasOk ? quoteBal : 0n;
    return { id: w.id, cap, balance: cap, holds, lastUsed: s.store.lastUsed(w.id), touched: s.store.touched(w.id, key) };
  });
}

/** Only wallets that can take part are eligible (a wallet with no room would only fail its part). */
const eligible = (cs: Candidate[]): Candidate[] => cs.filter((c) => c.cap > 0n);

export async function buy(s: Swarm, l: LaunchRef, wallets: readonly WalletRow[], total: bigint, k: Knobs, log: Log): Promise<CommandResult> {
  const c = await s.chain(l.chain);
  const cs = eligible(await candidates(s, c, l, wallets, "buy"));
  const p = makePlan({ total, candidates: cs, count: k.count, pick: k.pick ?? "random", split: k.split ?? { kind: "weights", min: 0, max: 1 }, bands: s.bands(l.chain, l.quote.address, l.quote.decimals), seed: k.seed }, (x) => fmt(x, l.quote.decimals, l.quote.symbol));
  const byId = new Map(wallets.map((w) => [w.id, w]));
  return run(s, "buy", targetKey(l), p, k, l.quote, asSend(async (id, amount) => {
    const r = await c.buy(byId.get(id)!, l, amount, k.slippageBps, k.timing.kind === "instant" ? p.total - amount : 0n);
    s.store.recordFill({ walletId: id, target: targetKey(l), side: "buy", quote: r.quote, tokens: r.tokens, tx: r.tx, at: Date.now() });
    return r.tx;
  }), log);
}

/** `amount` is a token total, or `{ pct }`: each picked wallet sells that share of its own holding. */
export async function sell(s: Swarm, l: LaunchRef, wallets: readonly WalletRow[], amount: bigint | { pct: number }, k: Knobs, log: Log): Promise<CommandResult> {
  const c = await s.chain(l.chain);
  const cs = eligible(await candidates(s, c, l, wallets, "sell"));
  const td = l.tokenDecimals;
  const tokenUnit = { symbol: "tokens", decimals: td };
  const show = (x: bigint): string => fmt(x, td, "tokens");
  const pick = k.pick ?? "holders";
  let p: Plan;
  if (typeof amount === "bigint") {
    p = makePlan({ total: amount, candidates: cs, count: k.count, pick, split: k.split ?? { kind: "by_balance" }, bands: s.bands(l.chain, l.token, td), seed: k.seed }, show);
  } else {
    if (!(amount.pct > 0 && amount.pct <= 100)) throw new PlanError("a sell's % must be in (0, 100]");
    if (cs.length === 0) throw new PlanError("no selected wallet holds the token");
    // Count and Pick choose the wallets (a stand-in total of one unit per eligible wallet), then each sells pct of its own
    const picked = makePlan({ total: BigInt(cs.length), candidates: cs, count: k.count, pick, split: { kind: "by_balance" }, bands: { ...s.bands(l.chain, l.token, td), perWallet: { min: 1n, max: null } }, seed: k.seed }, show);
    const bps = BigInt(Math.round(amount.pct * 100));
    const parts = picked.parts.map((x) => ({ ...x, amount: (x.hi * bps) / 10_000n })).filter((x) => x.amount > 0n);
    p = { ...picked, parts, total: parts.reduce((t, x) => t + x.amount, 0n), reserves: [] };
  }
  // a sell takes whole steps only (EVM: the contract refuses a tokensIn that is not a multiple of 10¹²)
  p = quantize(p, c.tokenStep);
  if (p.parts.length === 0) throw new PlanError(`nothing to sell: every part is under the chain's smallest amount (${show(c.tokenStep)})`);
  const byId = new Map(wallets.map((w) => [w.id, w]));
  return run(s, "sell", targetKey(l), p, k, tokenUnit, asSend(async (id, tokensIn) => {
    const r = await c.sell(byId.get(id)!, l, tokensIn, k.slippageBps, k.timing.kind === "instant" ? p.total - tokensIn : 0n);
    s.store.recordFill({ walletId: id, target: targetKey(l), side: "sell", quote: r.quote, tokens: r.tokens, tx: r.tx, at: Date.now() });
    return r.tx;
  }), log);
}

/**
 * `fund` (S6): spreads native gas or a quote token from ONE treasury wallet to the selected wallets, with the same knobs.
 * `each` sets an equal part per wallet (the total is each × the count). The per-wallet trading band does not apply.
 */
export async function fund(
  s: Swarm,
  chainName: string,
  asset: string,
  from: WalletRow,
  to: readonly WalletRow[],
  amount: { total: bigint } | { each: bigint },
  k: Knobs,
  log: Log,
): Promise<CommandResult> {
  const c = await s.chain(chainName);
  const q = await c.quoteInfo(asset);
  const big = 1n << 200n;
  if (!c.addressOf(from)) throw new Error(`the treasury (wallet ${from.id}) has no ${c.family === "evm" ? "EVM" : "Solana"} address`);
  const cs: Candidate[] = onChain(c, to).filter((w) => w.id !== from.id).map((w) => ({ id: w.id, cap: big, balance: 1n, holds: 0n, lastUsed: s.store.lastUsed(w.id), touched: false }));
  const wb = s.store.getSetting<{ min: number; max: number }>("wallets_per_command") ?? { min: 1, max: 1000 };
  const bands = { perWallet: { min: 1n, max: null }, wallets: wb };
  let total: bigint;
  let split: Split = k.split ?? { kind: "weights", min: 0, max: 1 };
  if ("each" in amount) {
    const n = k.count.kind === "most" ? Math.min(k.count.max ?? wb.max, cs.length, wb.max) : k.count.kind === "exact" ? k.count.n : cs.length;
    total = amount.each * BigInt(n);
    split = { kind: "equal" };
  } else total = amount.total;
  const treasury = await c.balanceOf(q.address, c.addressOf(from)!);
  if (treasury < total) throw new PlanError(`the treasury (wallet ${from.id}) holds ${fmt(treasury, q.decimals, q.symbol)}, under the ${fmt(total, q.decimals, q.symbol)} to fund`);
  const p = makePlan({ total, candidates: cs, count: k.count, pick: k.pick ?? "ordered", split, bands, seed: k.seed }, (x) => fmt(x, q.decimals, q.symbol));
  const byId = new Map(to.map((w) => [w.id, w]));
  return run(s, "fund", `${chainName}:${q.address}`, p, k, q, asSend(async (id, amt) => c.transfer(from, q.address, c.addressOf(byId.get(id)!)!, amt)), log);
}
