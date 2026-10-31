// `launch` (v1): one or more launches created by a wallet the user picks (`--from <id | group>`), on any chain. The adapter's
// `launcher` reads the preset row and the quote's registry entry once; the Team Buy is optional (none unless `--team-buy`),
// priced off the row; the Team Slot opens at the row's max. A group's wallets take turns, one launch each, in id order.
import type { WalletRow } from "../store/db.ts";
import { fmt, type Swarm } from "../swarm.ts";
import type { Log } from "./trade.ts";
import { parseUnits } from "viem";

export interface LaunchArgs {
  chain: string;
  preset: number;
  /** The quote: "native" (ETH / SOL as wSOL) or a listed token on the chain's registry. */
  quote: string;
  name: string;
  symbol: string;
  /** The optional Team Buy, in whole quote units ("0.5"), or "max" (the row's share); absent = none. */
  teamBuy?: string;
  /** How many launches; the creators take turns. */
  times: number;
  /** Off the Team Buy's quoted tokens for its minimum, bps. */
  slippageBps: number;
  dryRun?: boolean;
}

export interface LaunchCreated {
  creator: { id: number; address: string };
  launchId: bigint | null;
  token: string | null;
  name: string;
  symbol: string;
  /** The value or quote the create sends: the create fee + the Team Buy. */
  paid: bigint;
  tx: string | null;
}

/** `--from`: a wallet id, or a group (every wallet in it, id order). */
export function creators(s: Swarm, from: string): WalletRow[] {
  const ws = /^\d+$/.test(from) ? [s.store.wallet(Number(from))].filter((w): w is WalletRow => !!w) : s.store.wallets({ group: from });
  if (ws.length === 0) throw new Error(/^\d+$/.test(from) ? `no wallet ${from}` : `no wallet in group ${from}`);
  return ws;
}

export async function launch(s: Swarm, from: readonly WalletRow[], a: LaunchArgs, log: Log): Promise<LaunchCreated[]> {
  if (!(a.times >= 1)) throw new Error("--times ≥ 1");
  const c = await s.chain(a.chain);
  const ws = from.filter((w) => c.addressOf(w) !== null);
  if (ws.length === 0) throw new Error(`no --from wallet has ${c.family === "evm" ? "an EVM" : "a Solana"} address`);
  const quote = a.quote === "native" ? c.native : a.quote;
  let teamBuy: bigint | "max" = 0n;
  if (a.teamBuy === "max") teamBuy = "max";
  else if (a.teamBuy !== undefined) {
    if (!/^\d+(\.\d+)?$/.test(a.teamBuy)) throw new Error(`--team-buy "${a.teamBuy}": an amount of the quote, or max`);
    teamBuy = parseUnits(a.teamBuy, (await c.quoteInfo(quote)).decimals);
  }
  const l = await c.launcher({ preset: a.preset, quote, teamBuy, slippageBps: a.slippageBps });
  const q = l.quote;
  const out: LaunchCreated[] = [];
  for (let i = 0; i < a.times; i++) {
    const w = ws[i % ws.length]!;
    const address = c.addressOf(w)!;
    const name = a.times > 1 ? `${a.name} ${i + 1}` : a.name;
    const symbol = a.times > 1 ? `${a.symbol}${i + 1}`.slice(0, 10) : a.symbol;
    log(`launch ${i + 1}/${a.times}: wallet ${w.id} ${address} · preset ${a.preset} · ${name} (${symbol}) · Team Buy ${l.teamBuy > 0n ? fmt(l.teamBuy, q.decimals, q.symbol) : "none"} (max ${fmt(l.teamBuyMax, q.decimals, q.symbol)}) · Team Slot ${l.teamSlotBps} bps · pays up to ${fmt(l.paysUpTo, q.decimals, q.symbol)}`);
    if (a.dryRun) {
      out.push({ creator: { id: w.id, address }, launchId: null, token: null, name, symbol, paid: l.paysUpTo, tx: null });
      continue;
    }
    // a creator short of the coin is named before the press (the create would fail on chain with a bare program error)
    const isNative = q.address === c.native;
    const need = l.paysUpTo + (isNative ? await c.gasReserve() : 0n);
    const have = await c.balanceOf(q.address, address);
    if (have < need) throw new Error(`wallet ${w.id} ${address} doesn't have enough ${q.symbol} to launch: it holds ${fmt(have, q.decimals, q.symbol)}, the create needs up to ${fmt(need, q.decimals, q.symbol)}${isNative ? " (with its gas reserve)" : ""}`);
    const r = await l.create(w, name, symbol);
    log(`  ✓ launch ${r.launchId} ${r.token} ${r.tx}`);
    out.push({ creator: { id: w.id, address }, launchId: r.launchId, token: r.token, name, symbol, paid: r.paid, tx: r.tx });
  }
  return out;
}
