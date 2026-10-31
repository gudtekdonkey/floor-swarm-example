// `snipe` (S10): wait for the next launch created on a chain that matches a filter, then run the ordinary `buy` of <total> on it
// at once. Watching only reads; the buy is `buy`'s own, with the knobs given (timing defaults to instant here).
import { parseUnits } from "viem";
import { PlanError } from "../plan/plan.ts";
import type { Chain, CreatedLaunch, LaunchFilter } from "../chains/chain.ts";
import type { WalletRow } from "../store/db.ts";
import type { Swarm } from "../swarm.ts";
import { buy, type CommandResult, type Knobs, type Log } from "./trade.ts";

export const DEFAULT_WITHIN_SECS = 600;

export interface SnipeArgs {
  chain: string;
  /** The total to spend, in whole units of the launch's quote ("0.5"): the quote is known only once the launch is. */
  total: string;
  filter: { creator?: string; symbol?: string; any?: boolean };
  withinSecs: number;
}

export interface SnipeResult {
  runId: number | null;
  matched: boolean;
  filter: LaunchFilter;
  withinSecs: number;
  waitedMs: number;
  launch: { chain: string; token: string; launchId: bigint; creator: string; name: string; symbol: string; quote: string } | null;
  buy: CommandResult | null;
}

/** Exactly one of `--creator`, `--symbol`, `--any`; a creator must be an address of the chain's family. */
export function parseFilter(f: { creator?: string; symbol?: string; any?: boolean }, isAddress: (s: string) => boolean): LaunchFilter {
  const n = (f.creator !== undefined ? 1 : 0) + (f.symbol !== undefined ? 1 : 0) + (f.any ? 1 : 0);
  if (n !== 1) throw new PlanError("snipe takes exactly one of --creator <addr>, --symbol SYM, --any");
  if (f.creator !== undefined) {
    if (!isAddress(f.creator)) throw new PlanError(`--creator "${f.creator}" is not an address on this chain`);
    return { creator: f.creator };
  }
  if (f.symbol !== undefined) {
    if (f.symbol.trim() === "") throw new PlanError("--symbol is empty");
    return { symbol: f.symbol.trim() };
  }
  return { any: true };
}

/** Does a created launch pass the filter? Addresses compare without case on EVM, exactly on Solana; tickers without case. */
export function matchesFilter(f: LaunchFilter, c: Pick<CreatedLaunch, "creator" | "symbol">, family: "evm" | "solana"): boolean {
  if (f.any) return true;
  if (f.creator !== undefined) return family === "evm" ? c.creator.toLowerCase() === f.creator.toLowerCase() : c.creator === f.creator;
  if (f.symbol !== undefined) return c.symbol.toLowerCase() === f.symbol.toLowerCase();
  return false;
}

export function parseWithin(s: string | undefined): number {
  if (s === undefined) return DEFAULT_WITHIN_SECS;
  const n = Number(s);
  if (!(Number.isFinite(n) && n > 0)) throw new PlanError(`--within "${s}": a number of seconds above 0`);
  return n;
}

const describe = (f: LaunchFilter): string => (f.any ? "any launch" : f.creator ? `creator ${f.creator}` : `symbol ${f.symbol}`);

export async function snipe(
  s: Swarm,
  a: SnipeArgs,
  wallets: readonly WalletRow[],
  k: Knobs,
  log: Log,
  deps: { buy: typeof buy; now?: () => number } = { buy },
): Promise<SnipeResult> {
  const now = deps.now ?? Date.now;
  const c: Chain = await s.chain(a.chain);
  const filter = parseFilter(a.filter, (x) => c.isAddress(x));
  if (!/^\d+(\.\d+)?$/.test(a.total)) throw new PlanError(`snipe <total>: an amount of the launch's quote, got "${a.total}"`);
  const usable = wallets.filter((w) => c.addressOf(w) !== null);
  if (usable.length === 0) throw new PlanError(`no selected wallet has ${c.family === "evm" ? "an EVM" : "a Solana"} address for ${a.chain}`);
  const mark = await c.createsMark();
  const started = now();
  log(`snipe: watching ${a.chain} for ${describe(filter)}, up to ${a.withinSecs} s · ${usable.length} wallets${k.dryRun ? " · dry run (watches, sends nothing)" : ""}`);
  const found = await c.nextLaunch(mark, (x) => matchesFilter(filter, x, c.family), started + a.withinSecs * 1000);
  const waitedMs = now() - started;
  const seed = k.seed ?? started.toString(36);
  if (!found) {
    log(`snipe: no launch matched ${describe(filter)} within ${a.withinSecs} s`);
    let runId: number | null = null;
    if (!k.dryRun) {
      runId = s.store.startRun("snipe", a.chain, { filter, withinSecs: a.withinSecs, total: a.total }, seed);
      s.store.finishRun(runId, "failed", { matched: false, waitedMs });
    }
    return { runId, matched: false, filter, withinSecs: a.withinSecs, waitedMs, launch: null, buy: null };
  }
  const l = found.launch;
  log(`snipe: caught ${found.symbol} "${found.name}" ${l.token} (launch ${l.launchId}, creator ${found.creator}, quote ${l.quote.symbol}) after ${(waitedMs / 1000).toFixed(1)} s`);
  const total = parseUnits(a.total, l.quote.decimals);
  let runId: number | null = null;
  if (!k.dryRun) runId = s.store.startRun("snipe", a.chain, { filter, withinSecs: a.withinSecs, total: a.total, token: l.token, launchId: l.launchId }, seed);
  let result: CommandResult;
  try {
    result = await deps.buy(s, l, usable, total, k, log);
  } catch (e) {
    if (runId !== null) s.store.finishRun(runId, "failed", { matched: true, token: l.token, error: (e as Error).message });
    throw e;
  }
  if (runId !== null) s.store.finishRun(runId, result.report?.status ?? "failed", { matched: true, token: l.token, buyRun: result.runId, landed: result.report?.landed, planned: result.report?.planned });
  return {
    runId,
    matched: true,
    filter,
    withinSecs: a.withinSecs,
    waitedMs,
    launch: { chain: l.chain, token: l.token, launchId: l.launchId, creator: found.creator, name: found.name, symbol: found.symbol, quote: l.quote.address },
    buy: result,
  };
}
