// `team-slot add` and `team-slot buy` (S12). `add`: the launch's creator wallet puts members into the Team Slot (a wallet address, a
// swarm wallet by id, or a social handle bound to a wallet later) with a number of share units each. `buy`: Team Slot members spend
// the Team Share they are owed on the launch's token across wallets (planned like `buy`; the tokens are booked and arrive with `claim`).
import { handleKeyPreimage } from "../../vendor/floor-sdk/handle.ts";
import { SendError, type Chain, type LaunchRef, type SlotMember } from "../chains/chain.ts";
import { plan as makePlan, PlanError } from "../plan/plan.ts";
import type { WalletRow } from "../store/db.ts";
import { fmt, type Swarm } from "../swarm.ts";
import { asSend, pool, run, targetKey, type CommandResult, type Knobs, type Log } from "./trade.ts";

/** A member as asked for: its slot form, and the swarm wallet it is when it is one. */
export interface MemberSpec {
  member: SlotMember;
  walletId?: number;
  label: string;
}

const U64 = (1n << 64n) - 1n;

/** `--shares N`: a whole number of share units, 1 ..= u64. */
export function parseShares(s: string | undefined): bigint {
  if (s === undefined || !/^\d+$/.test(s)) throw new PlanError("team-slot add needs --shares N, a whole number of share units");
  const n = BigInt(s);
  if (n <= 0n || n > U64) throw new PlanError(`--shares ${s}: 1 ..= ${U64}`);
  return n;
}

/** `3,5-7` → wallet ids (a list may mix with addresses in --member). */
function idList(t: string): number[] {
  const m = /^(\d+)-(\d+)$/.exec(t);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (b < a) throw new PlanError(`bad id range "${t}"`);
    return [...Array(b - a + 1).keys()].map((k) => a + k);
  }
  return [Number(t)];
}

/**
 * `--member` (addresses and swarm wallet ids / ranges, comma separated) and `--handle` (`platform:handle`, comma separated);
 * exactly one of the two. A wallet id takes the wallet's address on the chain's family.
 */
export function parseMembers(
  a: { member?: string; handle?: string },
  addressOfId: (id: number) => string | null,
  isAddress: (s: string) => boolean,
): MemberSpec[] {
  if ((a.member === undefined) === (a.handle === undefined)) throw new PlanError("team-slot add takes exactly one of --member <0xaddr | wallet id> or --handle <platform>:<handle>");
  const out: MemberSpec[] = [];
  if (a.member !== undefined) {
    for (const raw of a.member.split(",").map((x) => x.trim()).filter(Boolean)) {
      if (/^\d+(-\d+)?$/.test(raw)) {
        for (const id of idList(raw)) {
          const addr = addressOfId(id);
          if (!addr) throw new PlanError(`--member ${id}: no such wallet, or it has no address on this chain`);
          out.push({ member: { wallet: addr }, walletId: id, label: `wallet ${id} ${addr}` });
        }
      } else if (isAddress(raw)) out.push({ member: { wallet: raw }, label: raw });
      else throw new PlanError(`--member "${raw}" is neither a wallet id nor an address on this chain`);
    }
  } else {
    for (const raw of a.handle!.split(",").map((x) => x.trim()).filter(Boolean)) {
      const i = raw.indexOf(":");
      if (i <= 0 || i === raw.length - 1) throw new PlanError(`--handle "${raw}": platform:handle, e.g. x:alice`);
      const [platform, handle] = [raw.slice(0, i), raw.slice(i + 1)];
      try {
        handleKeyPreimage(platform, handle);
      } catch (e) {
        throw new PlanError(`--handle "${raw}": ${(e as Error).message}`);
      }
      out.push({ member: { platform, handle }, label: `handle ${raw}` });
    }
  }
  if (out.length === 0) throw new PlanError("team-slot add: no member named");
  const keys = out.map((m) => ("wallet" in m.member ? m.member.wallet.toLowerCase() : `${m.member.platform.toLowerCase()}:${m.member.handle.toLowerCase()}`));
  if (new Set(keys).size !== keys.length) throw new PlanError("team-slot add: a member is named twice");
  return out;
}

export interface TeamSlotAddResult {
  runId: number | null;
  launch: string;
  creator: number;
  shares: bigint;
  members: { label: string; ok: boolean; tx?: string; error?: string }[];
}

export async function teamSlotAdd(s: Swarm, l: LaunchRef, creator: WalletRow, specs: readonly MemberSpec[], shares: bigint, dryRun: boolean, log: Log): Promise<TeamSlotAddResult> {
  const c: Chain = await s.chain(l.chain);
  if (!c.addressOf(creator)) throw new PlanError(`--from: wallet ${creator.id} has no ${c.family === "evm" ? "EVM" : "Solana"} address`);
  log(`team-slot add: ${specs.length} member${specs.length > 1 ? "s" : ""} × ${shares} shares on ${targetKey(l)} from creator wallet ${creator.id} ${c.addressOf(creator)}`);
  const members: TeamSlotAddResult["members"] = [];
  const runId = dryRun ? null : s.store.startRun("team-slot-add", targetKey(l), { creator: creator.id, shares, members: specs.map((m) => m.label) }, Date.now().toString(36));
  for (const m of specs) {
    if (dryRun) {
      members.push({ label: m.label, ok: true });
      log(`  would add ${m.label}`);
      continue;
    }
    try {
      const tx = await c.teamSlotAdd(creator, l, m.member, shares);
      if (m.walletId !== undefined) s.store.noteLaunch(targetKey(l), m.walletId, "slot");
      members.push({ label: m.label, ok: true, tx });
      s.store.recordSend(runId!, { id: creator.id, wave: members.length, amount: shares, attempts: 1, ok: true, tx, at: Date.now() });
      log(`  ✓ ${m.label} ${tx}`);
    } catch (e) {
      const error = e instanceof SendError ? e.message : (e as Error).message;
      members.push({ label: m.label, ok: false, error });
      s.store.recordSend(runId!, { id: creator.id, wave: members.length, amount: shares, attempts: 1, ok: false, error, at: Date.now() });
      log(`  ✗ ${m.label}: ${error}`);
    }
  }
  if (runId !== null) {
    const ok = members.filter((m) => m.ok).length;
    s.store.finishRun(runId, ok === members.length ? "done" : ok === 0 ? "failed" : "partial", { members });
  }
  return { runId, launch: targetKey(l), creator: creator.id, shares, members };
}

/** `team-slot buy`: the amount is spent across the member wallets, each capped at the Team Share it is owed. */
export async function teamSlotBuy(s: Swarm, l: LaunchRef, wallets: readonly WalletRow[], total: bigint, k: Knobs, log: Log): Promise<CommandResult> {
  const c: Chain = await s.chain(l.chain);
  const mine = wallets.filter((w) => c.addressOf(w) !== null);
  const reserve = await c.gasReserve();
  const cands = (
    await pool(mine, 16, async (w) => {
      const [owed, native] = await Promise.all([c.teamShareOwed(w, l), c.balanceOf(c.native, c.addressOf(w)!)]);
      const cap = native >= reserve ? owed : 0n;
      return { id: w.id, cap, balance: cap, holds: 0n, lastUsed: s.store.lastUsed(w.id), touched: s.store.touched(w.id, targetKey(l)) };
    })
  ).filter((x) => x.cap > 0n);
  if (cands.length === 0) throw new PlanError(`no selected wallet is owed a Team Share on ${targetKey(l)} (a wallet needs a place in the Team Slot, a Team Share to spend, and gas)`);
  const p = makePlan({ total, candidates: cands, count: k.count, pick: k.pick ?? "random", split: k.split ?? { kind: "weights", min: 0, max: 1 }, bands: s.bands(l.chain, l.quote.address, l.quote.decimals), seed: k.seed }, (x) => fmt(x, l.quote.decimals, l.quote.symbol));
  const byId = new Map(mine.map((w) => [w.id, w]));
  return run(s, "team-slot-buy", targetKey(l), p, k, l.quote, asSend(async (id, amount) => {
    const r = await c.teamShareBuy(byId.get(id)!, l, amount, k.slippageBps);
    s.store.recordFill({ walletId: id, target: targetKey(l), side: "buy", quote: r.quote, tokens: r.tokens, tx: r.tx, at: Date.now() });
    return r.tx;
  }), log);
}
