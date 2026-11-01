// The store: one SQLite file per swarm (node:sqlite). Wallets (addresses and where their key lives, never
// the key), groups, settings, runs, sends and fills. Cost basis and "touched" come from the swarm's own fills.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { KeyRef } from "../vault/vault.ts";

export interface WalletRow {
  id: number;
  ref: KeyRef;
  /** The wallet's address per family; null where its key has none (an imported key is one family's). */
  evm: string | null;
  sol: string | null;
  groups: string[];
}

export interface FillRow {
  walletId: number;
  target: string;
  side: "buy" | "sell";
  quote: bigint;
  tokens: bigint;
  tx: string;
  at: number;
}

const SCHEMA = `
create table if not exists wallets (id integer primary key, source text not null, hd_index integer, key_id integer, evm text unique, sol text unique, groups text not null default '[]', created integer not null);
create table if not exists settings (key text primary key, value text not null);
create table if not exists runs (id integer primary key, kind text not null, target text, spec text not null, seed text not null, status text not null, created integer not null, finished integer, report text);
create table if not exists sends (run_id integer not null, wallet_id integer not null, wave integer not null, amount text not null, ok integer not null, tx text, error text, attempts integer not null, at integer not null);
create table if not exists fills (wallet_id integer not null, target text not null, side text not null, quote text not null, tokens text not null, tx text not null, at integer not null);
create table if not exists known_launches (target text not null, wallet_id integer not null, role text not null, at integer not null, primary key (target, wallet_id, role));
create index if not exists fills_target on fills (target, wallet_id);
create index if not exists sends_wallet on sends (wallet_id, at);
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** A store from before the Solana adapter (`evm not null`, no `sol`): the wallets table rebuilt, rows and ids kept. */
  private migrate(): void {
    const cols = this.db.prepare("pragma table_info(wallets)").all() as { name: string }[];
    if (cols.some((c) => c.name === "sol")) return;
    this.db.exec(`begin;
create table wallets_v2 (id integer primary key, source text not null, hd_index integer, key_id integer, evm text unique, sol text unique, groups text not null default '[]', created integer not null);
insert into wallets_v2 (id, source, hd_index, key_id, evm, groups, created) select id, source, hd_index, key_id, evm, groups, created from wallets;
drop table wallets;
alter table wallets_v2 rename to wallets;
commit;`);
  }

  addWallet(ref: KeyRef, addr: { evm: string | null; sol: string | null }, groups: string[] = []): WalletRow {
    const had = this.db.prepare("select id from wallets where evm = ? or sol = ?").get(addr.evm, addr.sol) as { id: number } | undefined;
    if (had) return this.wallet(had.id)!;
    const r = this.db
      .prepare("insert into wallets (source, hd_index, key_id, evm, sol, groups, created) values (?, ?, ?, ?, ?, ?, ?)")
      .run(ref.source, ref.source === "hd" ? ref.index : null, ref.source === "key" ? ref.keyId : null, addr.evm, addr.sol, JSON.stringify(groups), Date.now());
    return this.wallet(Number(r.lastInsertRowid))!;
  }

  /** Fills in an HD wallet's Solana address (a store made before the Solana adapter). */
  setSol(id: number, sol: string): void {
    this.db.prepare("update wallets set sol = ? where id = ?").run(sol, id);
  }

  private row(r: Record<string, unknown>): WalletRow {
    const ref: KeyRef = r.source === "hd" ? { source: "hd", index: Number(r.hd_index) } : { source: "key", keyId: Number(r.key_id) };
    return { id: Number(r.id), ref, evm: r.evm == null ? null : String(r.evm), sol: r.sol == null ? null : String(r.sol), groups: JSON.parse(String(r.groups)) as string[] };
  }

  wallet(id: number): WalletRow | null {
    const r = this.db.prepare("select * from wallets where id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? this.row(r) : null;
  }

  wallets(sel: { group?: string; ids?: number[] } = {}): WalletRow[] {
    const all = (this.db.prepare("select * from wallets order by id").all() as Record<string, unknown>[]).map((r) => this.row(r));
    return all.filter((w) => (sel.group === undefined || w.groups.includes(sel.group)) && (sel.ids === undefined || sel.ids.includes(w.id)));
  }

  nextHdIndex(): number {
    const r = this.db.prepare("select max(hd_index) as m from wallets where source = 'hd'").get() as { m: number | null };
    return r.m === null ? 0 : r.m + 1;
  }

  tag(ids: number[], group: string, on = true): void {
    for (const id of ids) {
      const w = this.wallet(id);
      if (!w) throw new Error(`no wallet ${id}`);
      const g = on ? [...new Set([...w.groups, group])] : w.groups.filter((x) => x !== group);
      this.db.prepare("update wallets set groups = ? where id = ?").run(JSON.stringify(g), id);
    }
  }

  getSetting<T>(key: string): T | undefined {
    const r = this.db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, JSON.stringify(value));
  }

  settings(): Record<string, unknown> {
    return Object.fromEntries((this.db.prepare("select key, value from settings order by key").all() as { key: string; value: string }[]).map((r) => [r.key, JSON.parse(r.value)]));
  }

  startRun(kind: string, target: string | null, spec: unknown, seed: string): number {
    const r = this.db.prepare("insert into runs (kind, target, spec, seed, status, created) values (?, ?, ?, ?, 'running', ?)").run(kind, target, json(spec), seed, Date.now());
    return Number(r.lastInsertRowid);
  }

  finishRun(id: number, status: string, report: unknown): void {
    this.db.prepare("update runs set status = ?, finished = ?, report = ? where id = ?").run(status, Date.now(), json(report), id);
  }

  runs(limit = 20): Record<string, unknown>[] {
    return this.db.prepare("select id, kind, target, seed, status, created, finished from runs order by id desc limit ?").all(limit) as Record<string, unknown>[];
  }

  run(id: number): Record<string, unknown> | null {
    const r = this.db.prepare("select * from runs where id = ?").get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return { ...r, sends: this.db.prepare("select * from sends where run_id = ? order by at").all(id) };
  }

  recordSend(runId: number, s: { id: number; wave: number; amount: bigint; attempts: number; ok: boolean; tx?: string; error?: string; at: number }): void {
    this.db
      .prepare("insert into sends (run_id, wallet_id, wave, amount, ok, tx, error, attempts, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(runId, s.id, s.wave, s.amount.toString(), s.ok ? 1 : 0, s.tx ?? null, s.error ?? null, s.attempts, s.at);
  }

  lastUsed(walletId: number): number {
    const r = this.db.prepare("select max(at) as m from sends where wallet_id = ?").get(walletId) as { m: number | null };
    return r.m ?? 0;
  }

  recordFill(f: FillRow): void {
    this.db.prepare("insert into fills (wallet_id, target, side, quote, tokens, tx, at) values (?, ?, ?, ?, ?, ?, ?)").run(f.walletId, f.target, f.side, f.quote.toString(), f.tokens.toString(), f.tx, f.at);
  }

  touched(walletId: number, target: string): boolean {
    return this.db.prepare("select 1 from fills where wallet_id = ? and target = ? limit 1").get(walletId, target) !== undefined;
  }

  /** A launch the swarm made or put a wallet into the Team Slot of (`created` | `slot`), for `claim --all-launches`. */
  noteLaunch(target: string, walletId: number, role: "created" | "slot"): void {
    this.db.prepare("insert or ignore into known_launches (target, wallet_id, role, at) values (?, ?, ?, ?)").run(target, walletId, role, Date.now());
  }

  /** Every launch the swarm has touched (a fill) or made or joined, as `<chain>:<token>`, oldest first. */
  knownTargets(): string[] {
    const rows = this.db
      .prepare("select target, min(at) as at from (select target, at from fills union all select target, at from known_launches) group by target order by at, target")
      .all() as { target: string }[];
    return rows.map((r) => r.target);
  }

  /** A wallet's position on a target from its own fills: tokens bought − sold, and the quote cost of what it still holds (average cost). */
  position(walletId: number, target: string): { tokens: bigint; cost: bigint } {
    const fills = this.db.prepare("select side, quote, tokens from fills where wallet_id = ? and target = ? order by at").all(walletId, target) as { side: string; quote: string; tokens: string }[];
    let tokens = 0n;
    let cost = 0n;
    for (const f of fills) {
      const q = BigInt(f.quote), t = BigInt(f.tokens);
      if (f.side === "buy") {
        tokens += t;
        cost += q;
      } else if (tokens > 0n) {
        const sold = t > tokens ? tokens : t;
        cost -= (cost * sold) / tokens;
        tokens -= sold;
      }
    }
    return { tokens, cost };
  }
}

const json = (x: unknown): string => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));
