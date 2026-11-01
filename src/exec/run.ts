// The executor: timing, retries, and a failed wallet's part re-routed to the rest. Chain-agnostic: the
// chain adapter supplies `send`.
import type { Rng } from "../plan/rng.ts";
import type { Part, Plan } from "../plan/plan.ts";

export type Timing = { kind: "instant" } | { kind: "random"; minMs: number; maxMs: number };

export type SendResult = { ok: true; tx: string; detail?: Record<string, unknown> } | { ok: false; error: string; fatal?: boolean; unconfirmed?: boolean };

/** One send of `amount` from wallet `id`. `attempt` counts from 1; the adapter re-quotes on every attempt. */
/**
 * `unconfirmed`: sent, but its outcome is not known (it may still land). Never retried and never re-routed (that could spend
 * twice); the run reports it apart, out of both `landed` and the shortfall's re-route.
 */
export type Send = (id: number, amount: bigint, attempt: number) => Promise<SendResult>;

export interface SendRecord {
  id: number;
  wave: number;
  amount: bigint;
  attempts: number;
  result: SendResult;
  /** Every failed attempt's error, in order (the last one is `result`'s when it failed). */
  errors: string[];
  at: number;
}

export interface RunReport {
  status: "done" | "partial" | "failed";
  planned: bigint;
  landed: bigint;
  shortfall: bigint;
  /** Sent but not confirmed (`unconfirmed`): may still land. Counted in the shortfall, never re-routed. */
  unconfirmed: bigint;
  sends: SendRecord[];
}

export interface RunOptions {
  timing: Timing;
  retries: number;
  rng: Rng;
  /** Backoff before retry k (ms). */
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  onSend?: (r: SendRecord) => void;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Slot {
  part: Part;
  /** Assigned in total (sent, in flight, or pending). */
  assigned: bigint;
  /** Not yet sent. */
  pending: bigint;
  state: "waiting" | "inflight" | "sent" | "failed";
}

export async function execute(plan: Plan, send: Send, o: RunOptions): Promise<RunReport> {
  const sleep = o.sleep ?? realSleep;
  const backoff = o.backoffMs ?? ((k: number) => 400 * 2 ** (k - 1));
  const slots = new Map<number, Slot>();
  for (const p of plan.parts) slots.set(p.id, { part: p, assigned: p.amount, pending: p.amount, state: "waiting" });
  const reserves = [...plan.reserves];
  const sends: SendRecord[] = [];
  let landed = 0n;
  let unconfirmed = 0n;

  const attempt = async (id: number, amount: bigint, wave: number): Promise<SendRecord> => {
    let k = 0;
    let result: SendResult = { ok: false, error: "not sent" };
    const errors: string[] = [];
    while (k <= o.retries) {
      k++;
      try {
        result = await send(id, amount, k);
      } catch (e) {
        result = { ok: false, error: (e as Error).message ?? String(e) };
      }
      if (!result.ok) errors.push(result.error);
      if (result.ok || result.fatal || result.unconfirmed || k > o.retries) break;
      await sleep(backoff(k));
    }
    const rec: SendRecord = { id, wave, amount, attempts: k, result, errors, at: Date.now() };
    sends.push(rec);
    o.onSend?.(rec);
    return rec;
  };

  /**
   * Moves `x` off a failed wallet: first onto wallets not yet sent, then as an extra send from wallets that landed, then
   * onto reserves. Never past a wallet's `hi`, never a reserve under `lo`. Returns the extra sends to make; what fits nowhere is the shortfall.
   */
  const reroute = (x: bigint): { extra: { id: number; amount: bigint }[] } => {
    const extra: { id: number; amount: bigint }[] = [];
    let left = x;
    const room = (s: Slot): bigint => s.part.hi - s.assigned;
    for (const s of slots.values()) {
      if (left === 0n) break;
      if (s.state !== "waiting") continue;
      const take = room(s) < left ? room(s) : left;
      if (take <= 0n) continue;
      s.assigned += take;
      s.pending += take;
      left -= take;
    }
    for (const s of slots.values()) {
      if (left === 0n) break;
      if (s.state !== "sent") continue;
      const take = room(s) < left ? room(s) : left;
      if (take <= 0n) continue;
      s.assigned += take;
      extra.push({ id: s.part.id, amount: take });
      left -= take;
    }
    while (left > 0n && reserves.length > 0) {
      if (left < plan.lo) break;
      const r = reserves.shift()!;
      if (r.hi < plan.lo) continue;
      const take = r.hi < left ? r.hi : left;
      slots.set(r.id, { part: r, assigned: take, pending: 0n, state: "sent" });
      extra.push({ id: r.id, amount: take });
      left -= take;
    }
    return { extra };
  };

  const settle = (rec: SendRecord): { id: number; amount: bigint }[] => {
    const s = slots.get(rec.id)!;
    if (rec.result.ok) {
      landed += rec.amount;
      if (s.state !== "failed") s.state = "sent";
      return [];
    }
    s.state = "failed";
    if (rec.result.unconfirmed) {
      unconfirmed += rec.amount;
      return [];
    }
    s.assigned -= rec.amount;
    return reroute(rec.amount).extra;
  };

  let wave = 1;
  let extra: { id: number; amount: bigint }[] = [];
  if (o.timing.kind === "instant") {
    const first = [...slots.values()].map((s) => {
      const amt = s.pending;
      s.pending = 0n;
      s.state = "inflight";
      return attempt(s.part.id, amt, wave);
    });
    for (const rec of await Promise.all(first)) extra.push(...settle(rec));
  } else {
    const timing = o.timing;
    for (const s of [...slots.values()]) {
      if (s.state !== "waiting") continue;
      if (s.pending === 0n) continue;
      const amt = s.pending;
      s.pending = 0n;
      s.state = "inflight";
      extra.push(...settle(await attempt(s.part.id, amt, wave)));
      await sleep(Math.round(o.rng.between(timing.minMs, timing.maxMs)));
    }
  }
  // the later waves: re-routed parts that could not ride a wallet still waiting
  while (extra.length > 0) {
    wave++;
    const batch = extra;
    extra = [];
    if (o.timing.kind === "instant") {
      for (const rec of await Promise.all(batch.map((e) => attempt(e.id, e.amount, wave)))) extra.push(...settle(rec));
    } else {
      for (const e of batch) {
        extra.push(...settle(await attempt(e.id, e.amount, wave)));
        await sleep(Math.round(o.rng.between(o.timing.minMs, o.timing.maxMs)));
      }
    }
  }
  const status = landed === plan.total ? "done" : landed === 0n ? "failed" : "partial";
  return { status, planned: plan.total, landed, shortfall: plan.total - landed, unconfirmed, sends };
}
