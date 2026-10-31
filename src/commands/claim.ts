// `claim` (S11): for each selected wallet, read what it is owed on the launch(es) (creator / Team Fees, Team Slot, holder rewards,
// referrals, the unlocked Team Buy and tokens a Team Share buy booked) through the SDK's planners, skip the wallets owed nothing,
// and send the claim transactions of the rest. What a wallet "claimed" is measured: its balance change across the claims.
import { SendError, type Chain, type ClaimOut, type LaunchRef, type Owed, type WalletOwed } from "../chains/chain.ts";
import { PlanError } from "../plan/plan.ts";
import type { WalletRow } from "../store/db.ts";
import { fmt, type Swarm } from "../swarm.ts";
import { pool, targetKey, type Log } from "./trade.ts";

const OWED_KEYS = ["creator", "creatorRef", "teamSlot", "holder", "teamBuy", "shareBought"] as const;

export const owedAny = (o: Owed): boolean => OWED_KEYS.some((k) => o[k] > 0n);

/** Is the wallet owed anything at all? A wallet that is not is skipped: no claim is sent for it. */
export function hasOwed(o: WalletOwed): boolean {
  return o.launches.some((l) => owedAny(l.owed)) || o.extra.some((e) => e.amount > 0n);
}

/** One line per thing owed, e.g. `creator 0.01 ETH on SWE`. */
export function owedLines(o: WalletOwed, symbolOf: (asset: string) => string = (a) => a): string[] {
  const out: string[] = [];
  for (const { launch: l, owed } of o.launches) {
    for (const k of ["creator", "creatorRef", "teamSlot", "holder"] as const) if (owed[k] > 0n) out.push(`${k} ${fmt(owed[k], l.quote.decimals, l.quote.symbol)} on ${l.token}`);
    for (const k of ["teamBuy", "shareBought"] as const) if (owed[k] > 0n) out.push(`${k} ${fmt(owed[k], l.tokenDecimals, "tokens")} on ${l.token}`);
  }
  for (const e of o.extra) out.push(`${e.kind} ${e.amount} (base units) in ${symbolOf(e.quote)}`);
  return out;
}

export interface ClaimWalletResult {
  id: number;
  chain: string;
  address: string;
  /** `skipped`: owed nothing, nothing sent · `claimed` · `failed` (see `error`; `txs` holds what was sent before it) · `owed`: a dry run. */
  status: "skipped" | "claimed" | "failed" | "owed";
  owed: string[];
  txs: string[];
  claimed: { asset: string; symbol: string; amount: bigint }[];
  tokens: bigint;
  error?: string;
}

export interface ClaimResult {
  runId: number | null;
  wallets: ClaimWalletResult[];
  /** The launches read, as `<chain>:<token>`. */
  launches: string[];
}

export interface ClaimArgs {
  /** One launch; absent with `allLaunches`. */
  target?: LaunchRef;
  allLaunches?: boolean;
  /** Where EVM's owed payouts go. Solana refuses it by name. */
  to?: string;
  dryRun?: boolean;
  seed?: string;
}

/** The launches a claim reads: the target, or every launch the swarm has touched, made or joined, grouped by chain. */
export async function claimLaunches(s: Swarm, a: Pick<ClaimArgs, "target" | "allLaunches">, log: Log): Promise<Map<string, LaunchRef[]>> {
  if (!!a.target === !!a.allLaunches) throw new PlanError("claim takes a <target> or --all-launches");
  const by = new Map<string, LaunchRef[]>();
  if (a.target) {
    by.set(a.target.chain, [a.target]);
    return by;
  }
  for (const key of s.store.knownTargets()) {
    try {
      const l = await s.resolve(key);
      by.set(l.chain, [...(by.get(l.chain) ?? []), l]);
    } catch (e) {
      log(`claim: skipping ${key}: ${(e as Error).message}`);
    }
  }
  if (by.size === 0) throw new PlanError("claim --all-launches: the swarm has touched or made no launch yet (no fills, no creates)");
  return by;
}

async function claimOn(s: Swarm, c: Chain, launches: readonly LaunchRef[], wallets: readonly WalletRow[], a: ClaimArgs, log: Log): Promise<ClaimWalletResult[]> {
  const mine = wallets.filter((w) => c.addressOf(w) !== null);
  const symbols = new Map<string, string>([[c.native, c.nativeSymbol]]);
  for (const l of launches) symbols.set(l.quote.address, l.quote.symbol);
  const symbolOf = (asset: string): string => symbols.get(asset) ?? [...symbols].find(([k]) => k.toLowerCase() === asset.toLowerCase())?.[1] ?? asset;
  // read what each wallet is owed (reads only), then claim for the ones owed something
  const read = await pool(mine, 12, async (w) => {
    try {
      return { w, owed: await c.owedOf(w, launches), error: undefined as string | undefined };
    } catch (e) {
      return { w, owed: null, error: (e as Error).message };
    }
  });
  return pool(read, 6, async ({ w, owed, error }): Promise<ClaimWalletResult> => {
    const base = { id: w.id, chain: c.name, address: c.addressOf(w)!, owed: [] as string[], txs: [] as string[], claimed: [], tokens: 0n };
    if (!owed) {
      log(`  ✗ wallet ${w.id}: could not read what it is owed: ${error}`);
      return { ...base, status: "failed", error: `reading what it is owed: ${error}` };
    }
    if (!hasOwed(owed)) return { ...base, status: "skipped" };
    const lines = owedLines(owed, symbolOf);
    if (a.dryRun) {
      log(`  wallet ${w.id} ${base.address} is owed: ${lines.join("; ")}`);
      return { ...base, owed: lines, status: "owed" };
    }
    let out: ClaimOut;
    try {
      out = await c.claim(w, owed, a.to);
    } catch (e) {
      const m = e instanceof SendError ? e.message : (e as Error).message;
      log(`  ✗ wallet ${w.id}: ${m}`);
      return { ...base, owed: lines, status: "failed", error: m };
    }
    const claimed = out.claimed.map((x) => ({ ...x, symbol: symbolOf(x.asset) }));
    const got = claimed.map((x) => fmt(x.amount, x.asset === c.native ? c.nativeDecimals : (launches.find((l) => l.quote.address.toLowerCase() === x.asset.toLowerCase())?.quote.decimals ?? 0), x.symbol));
    if (out.tokens !== 0n) got.push(fmt(out.tokens, launches[0]?.tokenDecimals ?? 0, "tokens"));
    log(`  ${out.error ? "✗" : "✓"} wallet ${w.id} ${base.address}: ${out.error ? `failed after ${out.txs.length} tx: ${out.error}` : `claimed ${got.join(", ") || "nothing that reached the wallet"} in ${out.txs.length} tx`} (${lines.join("; ")})`);
    return { ...base, owed: lines, txs: out.txs, claimed, tokens: out.tokens, status: out.error ? "failed" : "claimed", ...(out.error ? { error: out.error } : {}) };
  });
}

export async function claim(s: Swarm, a: ClaimArgs, wallets: readonly WalletRow[], log: Log): Promise<ClaimResult> {
  const byChain = await claimLaunches(s, a, log);
  const results: ClaimWalletResult[] = [];
  for (const [chain, launches] of byChain) {
    const c = await s.chain(chain);
    if (a.to && !c.isAddress(a.to)) throw new PlanError(`--to "${a.to}" is not an address on ${chain}`);
    log(`claim on ${chain}: ${launches.length} launch${launches.length > 1 ? "es" : ""}, ${wallets.filter((w) => c.addressOf(w) !== null).length} wallets${a.to ? ` · payouts to ${a.to}` : ""}`);
    results.push(...(await claimOn(s, c, launches, wallets, a, log)));
  }
  const skipped = results.filter((r) => r.status === "skipped");
  const failed = results.filter((r) => r.status === "failed");
  const did = results.filter((r) => r.status === "claimed");
  log(`claim: ${did.length} claimed, ${skipped.length} owed nothing (skipped)${failed.length ? `, ${failed.length} failed` : ""}${a.dryRun ? " (dry run: nothing sent)" : ""}`);
  const launches = [...byChain.values()].flat().map(targetKey);
  let runId: number | null = null;
  if (!a.dryRun) {
    runId = s.store.startRun("claim", a.target ? targetKey(a.target) : "all-launches", { launches, to: a.to ?? null }, a.seed ?? Date.now().toString(36));
    const at = Date.now();
    for (const r of results) {
      if (r.status === "skipped") continue;
      // a claim's amount is the number of things it was owed (units differ per asset); the claimed assets are in the report
      s.store.recordSend(runId, { id: r.id, wave: 1, amount: BigInt(r.owed.length), attempts: 1, ok: r.status === "claimed", tx: r.txs[0], error: r.error, at });
    }
    const status = failed.length === 0 ? "done" : did.length === 0 ? "failed" : "partial";
    s.store.finishRun(runId, status, { claimed: did.length, skipped: skipped.length, failed: failed.length, wallets: results });
  }
  return { runId, wallets: results, launches };
}
