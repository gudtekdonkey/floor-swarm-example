// `swap` (S9): across wallets, each picked wallet sells its part of launch A and buys launch B with what the sell returned.
// Planned like `sell` (the parts are token amounts of A, whole steps of the chain), executed by the same executor: the sell is
// the send the executor retries and re-routes, and the buy rides inside it. ⛔ A sell that landed is never repeated: if its buy
// fails, the send still counts as landed (the sell did) and the wallet is reported with the quote it holds.
import { PlanError } from "../plan/plan.ts";
import { SendError, type Chain, type LaunchRef } from "../chains/chain.ts";
import type { WalletRow } from "../store/db.ts";
import { fmt, type Swarm } from "../swarm.ts";
import { asSend, planSell, run, targetKey, type CommandResult, type Knobs, type Log } from "./trade.ts";

export interface SwapLeg {
  id: number;
  /** `swapped`: both landed · `sold-only`: the sell landed, the buy did not (the quote stays in the wallet). */
  status: "swapped" | "sold-only";
  sold: { tx: string; tokens: bigint; quote: bigint };
  bought?: { tx: string; tokens: bigint; quote: bigint };
  buyError?: string;
  /** The quote the sell returned that no buy used (the whole of it on `sold-only`). */
  quoteLeft: bigint;
}

export interface SwapResult extends CommandResult {
  swaps: SwapLeg[];
}

const same = (c: { family: string }, a: string, b: string): boolean => (c.family === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Both launches on one chain and one quote asset, and not the same launch; else a refusal that names which. */
export function checkPair(a: LaunchRef, b: LaunchRef): void {
  if (a.chain !== b.chain) throw new PlanError(`swap needs both launches on one chain: ${a.token} is on ${a.chain}, ${b.token} on ${b.chain}`);
  if (same(a, a.token, b.token)) throw new PlanError(`swap: ${a.token} is both the launch sold and the launch bought`);
  if (!same(a, a.quote.address, b.quote.address)) {
    throw new PlanError(`swap needs both launches in one quote asset: ${a.token} is quoted in ${a.quote.symbol} (${a.quote.address}), ${b.token} in ${b.quote.symbol} (${b.quote.address})`);
  }
}

/**
 * What the buy puts in: the sell's whole quote; when the quote is the gas coin, no more than the wallet holds above its gas
 * reserve. 0 = nothing to buy with.
 */
export function buyBudget(sellQuote: bigint, quoteIsNative: boolean, nativeBalance: bigint, reserve: bigint): bigint {
  if (sellQuote <= 0n) return 0n;
  if (!quoteIsNative) return sellQuote;
  const room = nativeBalance > reserve ? nativeBalance - reserve : 0n;
  return sellQuote < room ? sellQuote : room;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function swap(s: Swarm, from: LaunchRef, to: LaunchRef, wallets: readonly WalletRow[], amount: bigint | { pct: number }, k: Knobs, log: Log): Promise<SwapResult> {
  checkPair(from, to);
  const c: Chain = await s.chain(from.chain);
  const p = await planSell(s, c, from, wallets, amount, k);
  const reserve = await c.gasReserve();
  const quoteIsNative = from.quote.address === c.native;
  const byId = new Map(wallets.map((w) => [w.id, w]));
  const legs: SwapLeg[] = [];
  const instant = k.timing.kind === "instant";
  // quote that wallets are spending on their buys right now: what an instant batch's buys put in ahead of the next one
  let inflight = 0n;
  log(`swap ${from.chain}:${from.token} → ${to.token}, each wallet sells then buys with the ${from.quote.symbol} it got`);
  const res = await run(s, "swap", `${targetKey(from)}>${targetKey(to)}`, p, k, { symbol: "tokens", decimals: from.tokenDecimals }, asSend(async (id, tokensIn) => {
    const w = byId.get(id)!;
    // the sell is the retried send: a throw here means nothing landed
    const sold = await c.sell(w, from, tokensIn, k.slippageBps, instant ? p.total - tokensIn : 0n);
    s.store.recordFill({ walletId: id, target: targetKey(from), side: "sell", quote: sold.quote, tokens: sold.tokens, tx: sold.tx, at: Date.now() });
    const leg: SwapLeg = { id, status: "sold-only", sold: { tx: sold.tx, tokens: sold.tokens, quote: sold.quote }, quoteLeft: sold.quote };
    legs.push(leg);
    const spend = buyBudget(sold.quote, quoteIsNative, quoteIsNative ? await c.balanceOf(c.native, c.addressOf(w)!) : 0n, reserve);
    if (spend <= 0n) {
      leg.buyError = sold.quote <= 0n ? "the sell returned no quote" : "nothing above the gas reserve to buy with";
    } else {
      const ahead = instant ? inflight : 0n;
      inflight += spend;
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            const b = await c.buy(w, to, spend, k.slippageBps, ahead);
            s.store.recordFill({ walletId: id, target: targetKey(to), side: "buy", quote: b.quote, tokens: b.tokens, tx: b.tx, at: Date.now() });
            leg.bought = { tx: b.tx, tokens: b.tokens, quote: b.quote };
            leg.status = "swapped";
            leg.quoteLeft = sold.quote > b.quote ? sold.quote - b.quote : 0n;
            break;
          } catch (e) {
            const err = e instanceof SendError ? e : new SendError((e as Error).message ?? String(e), false);
            leg.buyError = err.unconfirmed ? `${err.message} (the buy may still land)` : err.message;
            // only a buy that provably did not land is tried again; the sell is never repeated
            if (err.fatal || err.unconfirmed || attempt > k.retries) break;
            await sleep(400 * 2 ** (attempt - 1));
          }
        }
      } finally {
        inflight -= spend;
      }
    }
    if (leg.status === "swapped") log(`    ↳ wallet ${id} bought ${fmt(leg.bought!.tokens, to.tokenDecimals, "tokens")} for ${fmt(leg.bought!.quote, to.quote.decimals, to.quote.symbol)} ${leg.bought!.tx}`);
    else log(`    ↳ wallet ${id} sold but did not buy: ${leg.buyError} · ${fmt(leg.quoteLeft, to.quote.decimals, to.quote.symbol)} left in the wallet`);
    return sold.tx;
  }), log);
  const stuck = legs.filter((l) => l.status === "sold-only");
  if (res.runId !== null) {
    // the executor counted the sells; the run's status is only done when the buys landed too
    s.store.finishRun(res.runId, stuck.length > 0 && res.report!.status === "done" ? "partial" : res.report!.status, { ...res.report, swaps: legs });
  }
  if (stuck.length > 0) log(`swap: ${stuck.length} wallet${stuck.length > 1 ? "s" : ""} sold without buying (their ${from.quote.symbol} is in the wallet, not re-spent): ${stuck.map((l) => l.id).join(", ")}`);
  else if (legs.length > 0) log(`swap: ${legs.length} wallet${legs.length > 1 ? "s" : ""} swapped`);
  return { ...res, swaps: legs };
}
