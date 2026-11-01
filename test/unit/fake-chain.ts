// A scripted Chain and a Swarm wired to it, for the command tests (swap, snipe, claim, team-slot). No network.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SendError, type Chain, type ClaimOut, type CreatedLaunch, type LaunchRef, type Owed, type SlotMember, type TradeOut, type WalletOwed } from "../../src/chains/chain.ts";
import type { WalletRow } from "../../src/store/db.ts";
import { Swarm } from "../../src/swarm.ts";

export const NATIVE = "0x0000000000000000000000000000000000000000";
export const TOKEN_A = "0x00000000000000000000000000000000000000a1";
export const TOKEN_B = "0x00000000000000000000000000000000000000b2";
export const TOKEN_C = "0x00000000000000000000000000000000000000c3";
export const QUOTE_X = "0x00000000000000000000000000000000000000d4";
export const QUOTE_Y = "0x00000000000000000000000000000000000000e5";

export const launchRef = (token: string, quote = NATIVE, chain = "fake"): LaunchRef => ({
  chain,
  family: "evm",
  launchId: BigInt(parseInt(token.slice(-2), 16)),
  token,
  tokenDecimals: 18,
  quote: { address: quote, symbol: quote === NATIVE ? "ETH" : quote === QUOTE_X ? "XUSD" : "YUSD", decimals: 18 },
});

export const zeroOwed = (): Owed => ({ creator: 0n, creatorRef: 0n, teamSlot: 0n, holder: 0n, teamBuy: 0n, shareBought: 0n });

/** 1 token step (10¹² units) sells for 1 quote unit × RATE; a buy pays RATE quote units per token step. */
export class FakeChain implements Chain {
  readonly name = "fake";
  readonly family = "evm" as const;
  readonly native = NATIVE;
  readonly nativeSymbol = "ETH";
  readonly nativeDecimals = 18;
  readonly tokenStep = 10n ** 12n;
  /** balances: `${asset}:${address}` */
  bal = new Map<string, bigint>();
  calls: string[] = [];
  /** wallet id → error its buy throws */
  buyFails = new Map<number, SendError>();
  sellFails = new Map<number, SendError>();
  owed = new Map<number, WalletOwed>();
  claimFails = new Set<number>();
  claimed: { id: number; to?: string }[] = [];
  teamOwed = new Map<number, bigint>();
  slotAdds: { id: number; member: SlotMember; shares: bigint }[] = [];
  /** launches `nextLaunch` is fed, in order */
  created: CreatedLaunch[] = [];
  marks = 0;
  ids = new Map<string, number>();

  async verify(): Promise<string> {
    return "fake";
  }
  isAddress(s: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(s);
  }
  addressOf(w: WalletRow): string | null {
    return w.evm;
  }
  async quoteInfo(asset: string) {
    return launchRef(TOKEN_A, asset).quote;
  }
  key(asset: string, a: string): string {
    return `${asset.toLowerCase()}:${a.toLowerCase()}`;
  }
  give(asset: string, a: string, n: bigint): void {
    this.bal.set(this.key(asset, a), (this.bal.get(this.key(asset, a)) ?? 0n) + n);
  }
  async balanceOf(asset: string, owner: string): Promise<bigint> {
    return this.bal.get(this.key(asset, owner)) ?? 0n;
  }
  async gasReserve(): Promise<bigint> {
    return 10n;
  }
  async resolveToken(): Promise<LaunchRef | null> {
    return null;
  }
  private who(w: WalletRow): number {
    return w.id;
  }
  async sell(w: WalletRow, l: LaunchRef, tokensIn: bigint): Promise<TradeOut> {
    this.calls.push(`sell:${w.id}:${l.token}:${tokensIn}`);
    const e = this.sellFails.get(w.id);
    if (e) throw e;
    const a = w.evm!;
    this.give(l.token, a, -tokensIn);
    const quote = tokensIn / 10n ** 12n;
    this.give(l.quote.address, a, quote);
    return { tx: `0xsell${w.id}`, quote, tokens: tokensIn };
  }
  async buy(w: WalletRow, l: LaunchRef, amountIn: bigint): Promise<TradeOut> {
    this.calls.push(`buy:${w.id}:${l.token}:${amountIn}`);
    const e = this.buyFails.get(w.id);
    if (e) throw e;
    const a = w.evm!;
    this.give(l.quote.address, a, -amountIn);
    const tokens = amountIn * 10n ** 12n;
    this.give(l.token, a, tokens);
    return { tx: `0xbuy${w.id}`, quote: amountIn, tokens };
  }
  async transfer(): Promise<string> {
    return "0xt";
  }
  async launcher(): Promise<never> {
    throw new Error("not used");
  }
  async createsMark(): Promise<string> {
    return String(++this.marks);
  }
  async nextLaunch(_since: string, accept: (c: CreatedLaunch) => boolean, _deadline: number): Promise<CreatedLaunch | null> {
    for (const c of this.created) if (accept(c)) return c;
    return null;
  }
  async owedOf(w: WalletRow, launches: readonly LaunchRef[]): Promise<WalletOwed> {
    this.calls.push(`owedOf:${w.id}:${launches.length}`);
    return this.owed.get(w.id) ?? { launches: launches.map((launch) => ({ launch, owed: zeroOwed() })), extra: [], raw: null };
  }
  async claim(w: WalletRow, _o: WalletOwed, to?: string): Promise<ClaimOut> {
    this.calls.push(`claim:${w.id}`);
    if (this.claimFails.has(w.id)) throw new SendError("ClaimsShort", true);
    this.claimed.push({ id: w.id, to });
    return { txs: [`0xclaim${w.id}`], claimed: [{ asset: NATIVE, amount: 5n }], tokens: 0n };
  }
  async teamSlotAdd(w: WalletRow, _l: LaunchRef, member: SlotMember, shares: bigint): Promise<string> {
    if ("platform" in member && member.handle === "boom") throw new SendError("TeamSlotFull", true);
    this.slotAdds.push({ id: w.id, member, shares });
    return `0xslot${this.slotAdds.length}`;
  }
  async teamShareOwed(w: WalletRow): Promise<bigint> {
    return this.teamOwed.get(w.id) ?? 0n;
  }
  async teamShareBuy(w: WalletRow, _l: LaunchRef, amountIn: bigint): Promise<TradeOut> {
    this.calls.push(`teamShareBuy:${w.id}:${amountIn}`);
    return { tx: `0xshare${w.id}`, quote: amountIn, tokens: amountIn * 7n };
  }
}

export interface World {
  s: Swarm;
  c: FakeChain;
  wallets: WalletRow[];
}

/** A swarm whose only chain is `fake`; `n` wallets, ids 1..n, each with 1000 ETH-units of native gas. */
export function world(n: number, groups: string[] = ["g"]): World {
  const s = new Swarm("t", mkdtempSync(join(tmpdir(), "swarm-cmd-")));
  const c = new FakeChain();
  const wallets: WalletRow[] = [];
  for (let i = 1; i <= n; i++) {
    const addr = `0x${i.toString(16).padStart(40, "0")}`;
    const w = s.store.addWallet({ source: "hd", index: i }, { evm: addr, sol: null }, groups);
    wallets.push(w);
    c.give(NATIVE, addr, 1000n);
  }
  const resolve = async (t: string): Promise<LaunchRef> => {
    const token = t.includes(":") ? t.split(":")[1]! : t;
    const quote = token.toLowerCase() === TOKEN_C ? QUOTE_X : NATIVE;
    return launchRef(token.toLowerCase(), quote);
  };
  (s as unknown as { chain: (n: string) => Promise<Chain> }).chain = async () => c;
  (s as unknown as { resolve: typeof resolve }).resolve = resolve;
  return { s, c, wallets };
}
