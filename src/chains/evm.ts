// The EVM adapter: reads through the vendored @floor/sdk's call builders and decoders, signs with the vault's accounts, sends
// through a per-address nonce lane, and decodes FloorAmm's reverts by name.
import { createPublicClient, http, type PublicClient, type Hex, type TransactionReceipt } from "viem";
import type { LocalAccount } from "viem/accounts";
import { allow, type EvmChainConfig } from "./config.ts";
import { approveCall, buyCall, createLaunchCall, createQuoteTotal, decodeFloorAmmResult, decodeFloorError, decodeQuoteEntry, floorAmmCall, floorTokenCall, quoteEntryCall, sellCall, type EvmCall } from "../../vendor/floor-sdk/evm/floor/calls.ts";
import { decodePresetRowEvmV2, presetRowCallV2 } from "../../vendor/floor-sdk/v2/presetRowEvm.ts";
import { planTeamBuy, rowOf } from "./teambuy.ts";
import { RETRYABLE, SendError, type Chain, type ClaimOut, type CreatedLaunch, type ExtraOwed, type Keys, type LaunchArgsOnChain, type Launcher, type LaunchRef, type OwedLaunch, type QuoteInfo, type SlotMember, type TradeOut, type WalletOwed } from "./chain.ts";
import type { WalletRow } from "../store/db.ts";
import { FLOOR_EVENT_TOPICS, decodeFloorLogs } from "../../vendor/floor-sdk/evm/floor/events.ts";
import { evmOwedReaderOfClaimsViewV2 } from "../../vendor/floor-sdk/v2/claimAllEvm.ts";
import { planEvmClaimAllV2 } from "../../vendor/floor-sdk/v2/claims-evm.ts";
import { teamShareBuyCallV2, teamSlotAddCallV2 } from "../../vendor/floor-sdk/v2/tx/evm.ts";
import { EVM_TOKEN_SCALE } from "../../vendor/floor-sdk/v2/market-evm.ts";
import { decodeTeamShareOf, viewCall } from "../../vendor/floor-sdk/v2/evm.ts";
import { decodeFunctionResult } from "../../vendor/floor-sdk/evm/items.ts";
import { FLOOR_TOKEN_ABI } from "../../vendor/floor-sdk/evm/floor/abi.gen.ts";

export const NATIVE = "0x0000000000000000000000000000000000000000";
const MAX = (1n << 256n) - 1n;
const NEXT_POLL_MS = 250;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// a receipt is awaited CONFIRM_MS at a time, for at most CONFIRM_ROUNDS while the node still knows the transaction
const CONFIRM_MS = 120_000;
const CONFIRM_ROUNDS = 5;

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

export { SendError };
export type { QuoteInfo };
/** @deprecated the family-neutral `LaunchRef` */
export type EvmLaunchRef = LaunchRef;

export class EvmChain implements Chain {
  readonly name: string;
  readonly family = "evm" as const;
  readonly tokenStep = 10n ** 12n;
  readonly native = NATIVE;
  readonly nativeDecimals = 18;
  readonly cfg: EvmChainConfig;
  readonly client: PublicClient;
  private readonly keys: Keys;
  private readonly nonces = new Map<string, number>();
  private readonly lanes = new Map<string, Promise<unknown>>();

  constructor(name: string, cfg: EvmChainConfig, keys: Keys) {
    this.name = name;
    this.cfg = cfg;
    this.keys = keys;
    this.client = createPublicClient({ transport: http(cfg.rpc, { retryCount: 2, timeout: 30_000 }) }) as PublicClient;
  }

  get nativeSymbol(): string {
    return this.cfg.native ?? "ETH";
  }

  isAddress(s: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(s);
  }

  addressOf(w: WalletRow): string | null {
    return w.evm;
  }

  private account(w: WalletRow): LocalAccount {
    const a = this.keys.evm(w);
    if (!a) throw new SendError(`wallet ${w.id} has no EVM key`, true);
    return a;
  }

  /** ⛔ The network rail: refuses anything but a testnet or a local anvil. */
  async verify(): Promise<string> {
    const [id, version] = await Promise.all([this.client.getChainId(), this.client.request({ method: "web3_clientVersion" }) as Promise<string>]);
    const why = allow(this.cfg, id, version);
    const code = await this.client.getCode({ address: this.cfg.floorAmm as Hex });
    if (!code || code === "0x") throw new Error(`no FloorAmm code at ${this.cfg.floorAmm} on ${this.name}`);
    return why;
  }

  async ethCall(call: EvmCall, from?: string): Promise<Hex> {
    try {
      const r = await this.client.call({ to: call.to as Hex, data: call.data as Hex, value: call.value, account: from as Hex | undefined });
      return (r.data ?? "0x") as Hex;
    } catch (e) {
      throw this.decode(e);
    }
  }

  /** A revert → FloorAmm's error by name (fatal unless a fresh quote can cure it); anything else is retryable. */
  decode(e: unknown): SendError {
    const data = findRevertData(e);
    if (data && data !== "0x") {
      const d = decodeFloorError(data);
      if (d) return new SendError(d.mathError ? `${d.name} (${d.mathError})` : d.name, !RETRYABLE.test(d.name));
      return new SendError(`reverted ${data.slice(0, 10)}`, true);
    }
    const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e);
    return new SendError(msg, /insufficient funds/i.test(msg));
  }

  async quoteInfo(address: string): Promise<QuoteInfo> {
    if (address.toLowerCase() === NATIVE) return { address: NATIVE, symbol: this.cfg.native ?? "ETH", decimals: 18 };
    const [symbol, decimals] = await Promise.all([
      this.client.readContract({ address: address as Hex, abi: ERC20_ABI, functionName: "symbol" }),
      this.client.readContract({ address: address as Hex, abi: ERC20_ABI, functionName: "decimals" }),
    ]);
    return { address, symbol, decimals: Number(decimals) };
  }

  /** A pasted token address → its launch, if it is this chain's FloorAmm's. */
  async resolveToken(token: string): Promise<LaunchRef | null> {
    const code = await this.client.getCode({ address: token as Hex }).catch(() => undefined);
    if (!code || code === "0x") return null;
    try {
      const program = decodeFunctionResult(FLOOR_TOKEN_ABI, "program", await this.ethCall(floorTokenCall(token, "program", {})))["0"] as string;
      if (program.toLowerCase() !== this.cfg.floorAmm.toLowerCase()) return null;
      const launchId = decodeFunctionResult(FLOOR_TOKEN_ABI, "launchId", await this.ethCall(floorTokenCall(token, "launchId", {})))["0"] as bigint;
      const q = (decodeFloorAmmResult("launchQuote", await this.ethCall(floorAmmCall(this.cfg.floorAmm, "launchQuote", { launchId }))) as Record<string, unknown>)["0"] as string;
      return { chain: this.name, family: "evm", launchId, token, tokenDecimals: 18, quote: await this.quoteInfo(q) };
    } catch {
      return null;
    }
  }

  async balanceOf(token: string, owner: string): Promise<bigint> {
    if (token.toLowerCase() === NATIVE) return this.client.getBalance({ address: owner as Hex });
    return this.client.readContract({ address: token as Hex, abi: ERC20_ABI, functionName: "balanceOf", args: [owner as Hex] });
  }

  async allowance(token: string, owner: string, spender: string): Promise<bigint> {
    return this.client.readContract({ address: token as Hex, abi: ERC20_ABI, functionName: "allowance", args: [owner as Hex, spender as Hex] });
  }

  /** What a wallet should keep for gas: two heavy sends (an approval and a ~1.2M-gas buy, `contracts/gas/bench-p3.txt`). */
  async gasReserve(): Promise<bigint> {
    const price = await this.client.getGasPrice();
    return price * 2n * 2_500_000n;
  }

  /** One address's sends go out one at a time (nonce order); the receipts are awaited in parallel. */
  private lane<T>(address: string, f: () => Promise<T>): Promise<T> {
    const prev = this.lanes.get(address) ?? Promise.resolve();
    const next = prev.then(f, f);
    this.lanes.set(address, next.catch(() => undefined));
    return next;
  }

  async send(account: LocalAccount, call: EvmCall): Promise<TransactionReceipt> {
    const from = account.address;
    // simulate first: a revert comes back decoded, and nothing is spent on it
    await this.ethCall(call, from);
    const hash = await this.lane(from, async () => {
      let nonce = this.nonces.get(from);
      if (nonce === undefined) nonce = await this.client.getTransactionCount({ address: from, blockTag: "pending" });
      try {
        const req = await this.client.prepareTransactionRequest({ account, to: call.to as Hex, data: call.data as Hex, value: call.value, nonce, chain: null });
        // a swarm's sends land in blocks the estimate never saw (its own sends move the curve first): pad the limit, or a
        // heavier fill runs out of gas (measured: instant sells, estimate 612,101, used 602,990 + the OOG)
        const gas = (req.gas * 125n) / 100n + 50_000n;
        const raw = await account.signTransaction({ ...req, gas, chainId: this.cfg.chainId } as Parameters<LocalAccount["signTransaction"]>[0]);
        const h = await this.client.sendRawTransaction({ serializedTransaction: raw });
        this.nonces.set(from, nonce + 1);
        return h;
      } catch (e) {
        this.nonces.delete(from);
        throw this.decode(e);
      }
    });
    const receipt = await this.confirm(hash);
    if (receipt.status !== "success") throw await this.why(call, from, receipt);
    return receipt;
  }

  /**
   * A sent transaction's receipt. ⛔ A slow confirmation is never a failure to retry: the transaction can still land, and a
   * retry (or its part re-routed to another wallet) would then spend twice (measured on an Arbitrum Sepolia fork:
   * a buy confirmed after the 120 s wait, its retry reverted on the spent balance, its part bought again by another wallet).
   * So the wait goes on while the node still knows the transaction; past that, the send fails FATAL (no retry, no re-route).
   */
  private async confirm(hash: Hex): Promise<TransactionReceipt> {
    for (let round = 0; ; round++) {
      try {
        return await this.client.waitForTransactionReceipt({ hash, timeout: CONFIRM_MS });
      } catch (e) {
        if (!/timed out/i.test((e as Error).message ?? "")) throw this.decode(e);
        const known = await this.client.getTransaction({ hash }).then(() => true, () => false);
        if (!known || round + 1 >= CONFIRM_ROUNDS) throw new SendError(`not confirmed after ${((round + 1) * CONFIRM_MS) / 1000} s: ${hash} (not retried: it may still land)`, true, true);
      }
    }
  }

  /** A send that reverted ON CHAIN (it simulated clean): replayed at its block's state, which names the reason in most cases. */
  private async why(call: EvmCall, from: string, r: TransactionReceipt): Promise<SendError> {
    try {
      await this.client.call({ to: call.to as Hex, data: call.data as Hex, value: call.value, account: from as Hex, blockNumber: r.blockNumber });
    } catch (e) {
      const d = this.decode(e);
      return new SendError(`${d.message} on chain (block ${r.blockNumber}, ${r.transactionHash})`, d.fatal);
    }
    return new SendError(`reverted on chain (block ${r.blockNumber}, ${r.transactionHash}; gas ${r.gasUsed})`, false);
  }

  // ---- the trades -------------------------------------------------------------------------------------------------------

  private async ensureAllowance(account: LocalAccount, token: string, amount: bigint): Promise<void> {
    if ((await this.allowance(token, account.address, this.cfg.floorAmm)) >= amount) return;
    await this.send(account, approveCall(token, this.cfg.floorAmm, MAX));
  }

  private async quoteBuy(l: LaunchRef, amountIn: bigint, to: string): Promise<bigint> {
    if (amountIn === 0n) return 0n;
    const q = decodeFloorAmmResult("quoteBuy", await this.ethCall(floorAmmCall(this.cfg.floorAmm, "quoteBuy", { launchId: l.launchId, amountIn, to }), to)) as Record<string, any>;
    return (q["r"] ?? q["0"]).tokensOut as bigint;
  }

  private async quoteSell(l: LaunchRef, tokensIn: bigint, to: string): Promise<bigint> {
    if (tokensIn === 0n) return 0n;
    const q = decodeFloorAmmResult("quoteSell", await this.ethCall(floorAmmCall(this.cfg.floorAmm, "quoteSell", { launchId: l.launchId, tokensIn, to }), to)) as Record<string, any>;
    return (q["quoteOut"] ?? q["0"]) as bigint;
  }

  /**
   * `ahead`: what the rest of an instant batch puts in before this send at worst. The send is quoted as landing LAST, i.e.
   * quote(ahead + amount) − quote(ahead), and the slippage applies on top; quoting every wallet on the same state made a
   * 25-wallet instant buy slip past even 10 % (measured on the local anvil).
   */
  async buy(w: WalletRow, l: LaunchRef, amountIn: bigint, slippageBps: number, ahead = 0n): Promise<TradeOut> {
    const r = await this.buyWith(this.account(w), l, amountIn, slippageBps, ahead);
    return { tx: r.receipt.transactionHash, quote: r.spent, tokens: r.tokens };
  }

  async sell(w: WalletRow, l: LaunchRef, tokensIn: bigint, slippageBps: number, ahead = 0n): Promise<TradeOut> {
    const r = await this.sellWith(this.account(w), l, tokensIn, slippageBps, ahead);
    return { tx: r.receipt.transactionHash, quote: r.quoteOut, tokens: r.tokens };
  }

  async transfer(w: WalletRow, token: string, to: string, amount: bigint): Promise<string> {
    return (await this.transferWith(this.account(w), token, to, amount)).transactionHash;
  }

  /** The create (`launch`): the preset row and the quote's registry entry read once; the Team Buy priced off the row. */
  async launcher(a: LaunchArgsOnChain): Promise<Launcher> {
    const x = decodePresetRowEvmV2(await this.ethCall({ to: this.cfg.floorAmm, data: presetRowCallV2(a.preset), value: 0n }));
    if (!x || !x.enabled || x.deleted) throw new Error(`preset ${a.preset} is not open on ${this.name}`);
    const row = rowOf(x.row);
    const q = await this.quoteInfo(a.quote);
    const entry = decodeQuoteEntry(await this.ethCall(quoteEntryCall(this.cfg.floorAmm, q.address)));
    if (!entry.listed || !entry.enabled) throw new Error(`${q.symbol} (${q.address}) is not a listed, enabled quote on ${this.name}`);
    const now = (await this.client.getBlock()).timestamp;
    const native = q.address === NATIVE;
    const tb = planTeamBuy(row, { quoteDecimals: q.decimals, quoteUsdCentsX64: entry.usdCentsX64, tokenDecimals: 18 }, a.teamBuy, a.slippageBps);
    const build = (name: string, symbol: string) => {
      const p = {
        createFee: entry.createFee,
        params: { presetId: BigInt(a.preset), quote: q.address, name, symbol, teamSlotRateBps: BigInt(tb.teamSlotBps), creatorBuy: tb.creatorBuy, creatorBuyMinTokens: tb.creatorBuyMinTokens },
        registry: { entry: { usdCentsX64: entry.usdCentsX64, updatedAt: entry.updatedAt }, now },
      };
      const call = createLaunchCall({ floorAmm: this.cfg.floorAmm, ...p });
      // what the create sends (native: the value) or pulls (an ERC-20: the fee + the Team Buy, approved)
      return { call, pays: native ? call.value : createQuoteTotal(p) };
    };
    return {
      quote: q,
      paysUpTo: build("x", "X").pays,
      teamBuy: tb.creatorBuy,
      teamBuyMax: tb.teamBuyMax,
      teamSlotBps: tb.teamSlotBps,
      create: async (w, name, symbol) => {
        const { call, pays } = build(name, symbol);
        const acct = this.account(w);
        if (!native && (await this.allowance(q.address, acct.address, this.cfg.floorAmm)) < pays) await this.send(acct, approveCall(q.address, this.cfg.floorAmm, MAX));
        const rc = await this.send(acct, call);
        const ev = decodeFloorLogs(rc.logs.map((l) => ({ address: l.address, topics: l.topics as string[], data: l.data })), [this.cfg.floorAmm]).find((e) => e.name === "LaunchCreated");
        return { launchId: (ev?.args.launchId as bigint | undefined) ?? null, token: (ev?.args.token as string | undefined) ?? null, tx: rc.transactionHash, paid: pays };
      },
    };
  }

  // ---- snipe -----------------------------------------------------------------------------------------------------------

  async createsMark(): Promise<string> {
    return String(await this.client.getBlockNumber());
  }

  /** Polls `LaunchCreated` logs of this chain's FloorAmm from the block after `since` until one is accepted or the deadline. */
  async nextLaunch(since: string, accept: (c: CreatedLaunch) => boolean, deadline: number): Promise<CreatedLaunch | null> {
    let next = BigInt(since) + 1n;
    const topic = FLOOR_EVENT_TOPICS["LaunchCreated"]!;
    for (;;) {
      const head = await this.client.getBlockNumber();
      if (head >= next) {
        const logs = (await this.client.request({
          method: "eth_getLogs",
          params: [{ address: this.cfg.floorAmm as Hex, topics: [topic as Hex], fromBlock: `0x${next.toString(16)}`, toBlock: `0x${head.toString(16)}` }],
        })) as { address: string; topics: string[]; data: string }[];
        next = head + 1n;
        for (const ev of decodeFloorLogs(logs, [this.cfg.floorAmm])) {
          if (ev.name !== "LaunchCreated") continue;
          const a = ev.args;
          const launch: LaunchRef = { chain: this.name, family: "evm", launchId: a.launchId as bigint, token: a.token as string, tokenDecimals: 18, quote: await this.quoteInfo(a.quote as string) };
          const c: CreatedLaunch = { launch, creator: a.creator as string, name: a.name as string, symbol: a.symbol as string };
          if (accept(c)) return c;
        }
      }
      if (Date.now() >= deadline) return null;
      await sleep(Math.max(0, Math.min(NEXT_POLL_MS, deadline - Date.now())));
    }
  }

  // ---- claim -----------------------------------------------------------------------------------------------------------

  private claimQuotes(launches: readonly LaunchRef[]): string[] {
    return [...new Set([NATIVE, ...launches.map((l) => l.quote.address)].map((q) => q.toLowerCase()))];
  }

  async owedOf(w: WalletRow, launches: readonly LaunchRef[]): Promise<WalletOwed> {
    const a = this.account(w).address;
    const reader = evmOwedReaderOfClaimsViewV2({ floorAmm: this.cfg.floorAmm, ethCall: (to, data) => this.ethCall({ to, data, value: 0n }, a) });
    const view = await reader.owed(a, launches.map((l) => l.launchId), this.claimQuotes(launches));
    const rows: OwedLaunch[] = view.launches.map((r, i) => ({
      launch: launches[i]!,
      // the view's token legs are in math units; a launch token is 18 decimals
      owed: { creator: r.creator, creatorRef: r.creatorRef, teamSlot: r.teamSlot, holder: r.holder, teamBuy: r.teamBuy * EVM_TOKEN_SCALE, shareBought: r.shareBought * EVM_TOKEN_SCALE },
    }));
    const extra: ExtraOwed[] = [];
    for (const q of view.quotes) {
      for (const kind of ["creator", "creatorRef", "teamSlot", "traderRef", "payout"] as const) if (q[kind] > 0n) extra.push({ quote: q.quote, kind, amount: q[kind] });
    }
    return { launches: rows, extra, raw: view };
  }

  async claim(w: WalletRow, owed: WalletOwed, to?: string): Promise<ClaimOut> {
    const account = this.account(w);
    const plan = planEvmClaimAllV2({ floorAmm: this.cfg.floorAmm, wallet: account.address, owed: owed.raw as Parameters<typeof planEvmClaimAllV2>[0]["owed"], payoutTo: to });
    const quotes = this.claimQuotes(owed.launches.map((x) => x.launch));
    const tokens = owed.launches.filter((x) => x.owed.teamBuy > 0n || x.owed.shareBought > 0n).map((x) => x.launch.token);
    const [qBefore, tBefore] = await Promise.all([Promise.all(quotes.map((q) => this.balanceOf(q, account.address))), Promise.all(tokens.map((t) => this.balanceOf(t, account.address)))]);
    const txs: string[] = [];
    let gas = 0n;
    let error: string | undefined;
    try {
      for (const call of [...plan.claims.map((c) => c.call), ...plan.payouts.map((p) => p.call)]) {
        const rc = await this.send(account, call);
        txs.push(rc.transactionHash);
        gas += rc.gasUsed * rc.effectiveGasPrice;
      }
    } catch (e) {
      error = (e as Error).message;
    }
    const [qAfter, tAfter] = await Promise.all([Promise.all(quotes.map((q) => this.balanceOf(q, account.address))), Promise.all(tokens.map((t) => this.balanceOf(t, account.address)))]);
    const claimed = quotes
      .map((q, i) => ({ asset: q, amount: qAfter[i]! - qBefore[i]! + (q === NATIVE ? gas : 0n) }))
      .filter((x) => x.amount !== 0n);
    return { txs, claimed, tokens: tAfter.reduce((t, x, i) => t + (x - tBefore[i]!), 0n), ...(error ? { error } : {}) };
  }

  // ---- Team Slot -------------------------------------------------------------------------------------------------------

  async teamSlotAdd(w: WalletRow, l: LaunchRef, member: SlotMember, shares: bigint): Promise<string> {
    const rc = await this.send(this.account(w), teamSlotAddCallV2({ floorAmm: this.cfg.floorAmm, launchId: l.launchId, member, shares }));
    return rc.transactionHash;
  }

  async teamShareOwed(w: WalletRow, l: LaunchRef): Promise<bigint> {
    const a = this.account(w).address;
    const data = await this.ethCall({ to: this.cfg.floorAmm, data: viewCall("teamShareOf", [l.launchId, a]), value: 0n }, a);
    return decodeTeamShareOf(data).claimable;
  }

  async teamShareBuy(w: WalletRow, l: LaunchRef, amountIn: bigint, slippageBps: number): Promise<TradeOut> {
    const account = this.account(w);
    const out = await this.quoteBuy(l, amountIn, account.address);
    const minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
    const rc = await this.send(account, teamShareBuyCallV2({ floorAmm: this.cfg.floorAmm, launchId: l.launchId, amountIn, minOut }));
    const ev = decodeFloorLogs(rc.logs.map((x) => ({ address: x.address, topics: x.topics as string[], data: x.data })), [this.cfg.floorAmm]).find((e) => e.name === "TeamShareBought");
    return { tx: rc.transactionHash, quote: (ev?.args.spent as bigint | undefined) ?? amountIn, tokens: (ev?.args.tokens as bigint | undefined) ?? out };
  }

  async buyWith(account: LocalAccount, l: LaunchRef, amountIn: bigint, slippageBps: number, ahead = 0n): Promise<{ receipt: TransactionReceipt; spent: bigint; tokens: bigint }> {
    if (l.quote.address !== NATIVE) await this.ensureAllowance(account, l.quote.address, amountIn);
    const [all, before] = await Promise.all([this.quoteBuy(l, ahead + amountIn, account.address), this.quoteBuy(l, ahead, account.address)]);
    const out = all - before;
    const minTokensOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
    const receipt = await this.send(account, buyCall({ floorAmm: this.cfg.floorAmm, quote: l.quote.address, launchId: l.launchId, amountIn, minTokensOut, to: account.address }));
    const t = this.trade(receipt);
    // what reached the wallet: the Trade event's `tokens` is before the buy's Milestone shares
    return { receipt, spent: t?.quoteGross ?? amountIn, tokens: received(receipt, l.token, account.address) ?? t?.tokens ?? out };
  }

  /** `ahead` as for `buy`: the batch's other sells, landing first at worst. */
  async sellWith(account: LocalAccount, l: LaunchRef, tokensIn: bigint, slippageBps: number, ahead = 0n): Promise<{ receipt: TransactionReceipt; quoteOut: bigint; tokens: bigint }> {
    await this.ensureAllowance(account, l.token, tokensIn);
    const [all, before] = await Promise.all([this.quoteSell(l, ahead + tokensIn, account.address), this.quoteSell(l, ahead, account.address)]);
    const out = all - before;
    const minQuoteOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
    const receipt = await this.send(account, sellCall({ floorAmm: this.cfg.floorAmm, launchId: l.launchId, tokensIn, minQuoteOut, to: account.address }));
    const t = this.trade(receipt);
    return { receipt, quoteOut: t?.quoteNet ?? out, tokens: t?.tokens ?? tokensIn };
  }

  /** A native or ERC-20 transfer (the `fund` command). */
  async transferWith(account: LocalAccount, token: string, to: string, amount: bigint): Promise<TransactionReceipt> {
    if (token.toLowerCase() === NATIVE) return this.send(account, { to, data: "0x", value: amount });
    const data = encodeTransfer(to, amount);
    return this.send(account, { to: token, data, value: 0n });
  }

  private trade(r: TransactionReceipt): { quoteGross: bigint; quoteNet: bigint; tokens: bigint } | null {
    const ev = decodeFloorLogs(r.logs.map((l) => ({ address: l.address, topics: l.topics as string[], data: l.data })), [this.cfg.floorAmm]).find((e) => e.name === "Trade");
    if (!ev) return null;
    return { quoteGross: ev.args.quoteGross as bigint, quoteNet: ev.args.quoteNet as bigint, tokens: ev.args.tokens as bigint };
  }
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** The net of `token`'s Transfer logs into `to` in this receipt, or null when there are none. */
function received(r: TransactionReceipt, token: string, to: string): bigint | null {
  const me = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  let net: bigint | null = null;
  for (const lg of r.logs) {
    if (lg.address.toLowerCase() !== token.toLowerCase() || lg.topics[0] !== TRANSFER_TOPIC || lg.topics.length < 3) continue;
    const v = BigInt(lg.data);
    if (lg.topics[2]!.slice(2).toLowerCase() === me) net = (net ?? 0n) + v;
    if (lg.topics[1]!.slice(2).toLowerCase() === me) net = (net ?? 0n) - v;
  }
  return net;
}

function encodeTransfer(to: string, amount: bigint): string {
  return "0xa9059cbb" + to.toLowerCase().replace(/^0x/, "").padStart(64, "0") + amount.toString(16).padStart(64, "0");
}

/** viem nests the revert data a few levels deep, by error class. */
function findRevertData(e: unknown): string | null {
  let x: any = e;
  for (let i = 0; i < 8 && x; i++) {
    const d = x.data?.data ?? x.data;
    if (typeof d === "string" && d.startsWith("0x")) return d;
    x = x.cause;
  }
  const m = /data: "?(0x[0-9a-fA-F]*)"?/.exec(String((e as Error)?.message ?? ""));
  return m ? m[1]! : null;
}
