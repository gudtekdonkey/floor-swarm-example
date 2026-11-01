// The Solana adapter: floor_amm v2 through the vendored @floorlaunchpad/sdk (its Solana client builds every trade: the hook's accounts,
// the holder position, wSOL; plus the v2 create, PDAs, account decoders, the v0 compiler and the v2 event-CPI decoder), plain
// JSON-RPC over fetch, and ed25519 from Node's crypto
// (`vault/sol-keys.ts`). No web3.js, no new dependency.
//
// A wSOL-quoted launch is traded in SOL: the buy wraps what it spends into the wallet's wSOL account and closes it after (the
// refund and the rent come back as SOL); the sell closes it the same way. The chain's `native` is the wSOL mint.
import { allowSolana, type SolanaChainConfig } from "./config.ts";
import { RETRYABLE, SendError, type Chain, type ClaimOut, type CreatedLaunch, type ExtraOwed, type Keys, type LaunchArgsOnChain, type Launcher, type LaunchRef, type OwedLaunch, type QuoteInfo, type SlotMember, type TradeOut, type WalletOwed } from "./chain.ts";
import type { WalletRow } from "../store/db.ts";
import type { SolSigner } from "../vault/sol-keys.ts";
import { base58Decode, base58Encode, concatBytes, readUintLE, uintLE } from "../../vendor/floor-sdk/codec.ts";
import { grindMintNonce } from "../../vendor/floor-sdk/solana/floor/mint.ts";
import type { Instruction } from "../../vendor/floor-sdk/solana/instruction.ts";
import { computeUnitLimitInstruction, R, W, RS } from "../../vendor/floor-sdk/solana/instruction.ts";
import { CLOCK_SYSVAR_ID, SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WSOL_MINT, associatedTokenAddress } from "../../vendor/floor-sdk/solana/pda.ts";
import { PACKET_DATA_SIZE, closeAccountInstruction, compileV0Message, createAssociatedTokenAccountIdempotentInstruction, syncNativeInstruction, systemTransferInstruction, transactionSize } from "../../vendor/floor-sdk/solana/tx.ts";
import { configPda, launchPda, metadataPda, presetPda, quoteEntryPda } from "../../vendor/floor-sdk/solana/floor/program.ts";
import { decodeConfig, decodeQuoteEntry } from "../../vendor/floor-sdk/solana/floor/accounts.ts";
import { createMintAccounts } from "../../vendor/floor-sdk/solana/floor/instructions.ts";
import { decodeEventCpiV2, type FloorEventV2 } from "../../vendor/floor-sdk/v2/events.ts";
import { FLOOR_HOOK_PROGRAM_ID, createLaunchInstructionV2 } from "../../vendor/floor-sdk/v2/solana.ts";
import { decodeLaunchV2Typed, decodePresetRowV2Typed, type LaunchV2Account } from "../../vendor/floor-sdk/v2/types.ts";
import { quoteBuySolanaV2, solanaSettleInputsV2 } from "../../vendor/floor-sdk/v2/solanaSettle.ts";
import { quoteSellImpactV2 } from "../../vendor/floor-sdk/math/v2/receipt.ts";
import { sCirc } from "../../vendor/floor-sdk/math/v2/supply.ts";
import { buyMinTokens } from "../../vendor/floor-sdk/math/v2/trade.ts";
import { SOL_BUY_WALK_STEPS } from "../../vendor/floor-sdk/math/v2/book.ts";
import { minOutAt } from "../../vendor/floor-sdk/v2/press.ts";
import { createSolanaClient } from "../../vendor/floor-sdk/client/solana/index.ts";
import type { FloorClient } from "../../vendor/floor-sdk/client/types.ts";
import { planTeamBuy, rowOf } from "./teambuy.ts";
import { holderBookPda, holderPositionPda, teamShareBuyInstructionV2 } from "../../vendor/floor-sdk/v2/solana.ts";
import { holderOwedNowV2, launchOwedV2, planClaimAllV2, type LaunchOwedV2 } from "../../vendor/floor-sdk/v2/claims.ts";
import { teamSlotAddMemberV2 } from "../../vendor/floor-sdk/v2/tx/solana.ts";
import { refOwedPda, teamSlotPda } from "../../vendor/floor-sdk/solana/floor/program.ts";
import { decodeRefOwed } from "../../vendor/floor-sdk/solana/floor/accounts.ts";

const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
// what a wallet keeps for its sends: fees, the launch token account's rent (Token-2022, ~0.0021 SOL), the wSOL account's
// rent while a trade runs (returned when it closes)
const LAMPORTS_RESERVE = 10_000_000n;
const CU = 1_400_000;
const POLL_MS = 400;
// a signature is watched this long while its blockhash is still valid; past its last valid height it can never land
const CONFIRM_MS = 600_000;

interface AccountInfo {
  data: Uint8Array;
  owner: string;
  lamports: bigint;
}

class RpcError extends Error {
  readonly code: number;
  readonly data: any;
  constructor(e: { code: number; message: string; data?: any }) {
    super(e.message);
    this.code = e.code;
    this.data = e.data;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function shortVec(n: number): Uint8Array {
  const out: number[] = [];
  for (let v = n; ; ) {
    const b = v & 0x7f;
    v >>= 7;
    if (v === 0) return new Uint8Array([...out, b]);
    out.push(b | 0x80);
  }
}

/** The message's required signers, in order (the header's count, then the first static keys). */
function messageSigners(msg: Uint8Array): string[] {
  const n = msg[1]!;
  let o = 4;
  let count = 0;
  for (let shift = 0; ; shift += 7) {
    const b = msg[o++]!;
    count |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
  }
  if (count < n) throw new Error("a message with fewer keys than signers");
  return [...Array(n).keys()].map((i) => base58Encode(msg.subarray(o + 32 * i, o + 32 * (i + 1))));
}

/** SPL Token / Token-2022 `TransferChecked` (12): [12, amount u64, decimals u8]; source, mint, destination, owner. */
function transferCheckedInstruction(p: { source: string; mint: string; destination: string; owner: string; amount: bigint; decimals: number; tokenProgram: string }): Instruction {
  return { programAddress: p.tokenProgram, accounts: [W(p.source), R(p.mint), W(p.destination), RS(p.owner)], data: concatBytes(new Uint8Array([12]), uintLE(p.amount, 8), new Uint8Array([p.decimals])) };
}

/** A program error by name from the logs (Anchor prints it), else the custom code, else the RPC's own words. */
function errorFrom(logs: readonly string[] | undefined, err: unknown, fallback: string): SendError {
  const text = (logs ?? []).join("\n");
  const anchor = /Error Code: (\w+)\. Error Number: (\d+)/.exec(text);
  if (anchor) return new SendError(`${anchor[1]} (${anchor[2]})`, !RETRYABLE.test(anchor[1]!));
  const custom = /Program (\w+) failed: custom program error: (0x[0-9a-fA-F]+)/.exec(text) ?? /()custom program error: (0x[0-9a-fA-F]+)/.exec(text);
  if (custom) {
    const [who, code] = [custom[1]!, parseInt(custom[2]!, 16)];
    // the failing program's own code: System 1 and SPL Token 1 are both "not enough"
    if (code === 1 && (who === SYSTEM_PROGRAM_ID || (who === TOKEN_PROGRAM_ID || who === TOKEN_2022_PROGRAM_ID))) return new SendError(`insufficient ${who === SYSTEM_PROGRAM_ID ? "SOL" : "token balance"} (${fallback})`, true);
    return new SendError(`custom program error ${code}${who ? ` in ${who}` : ""}`, true);
  }
  const e = JSON.stringify(err ?? "");
  if (/insufficient (lamports|funds)/i.test(text) || /InsufficientFunds/.test(e)) return new SendError(`insufficient funds (${fallback})`, true);
  if (/AccountNotFound|no record of a prior credit/i.test(text + e)) return new SendError(`the wallet has no SOL (${fallback})`, true);
  if (/BlockhashNotFound/i.test(e + fallback)) return new SendError("blockhash not found", false);
  return new SendError(err ? `${fallback}: ${e}` : fallback, false);
}

export class SolanaChain implements Chain {
  readonly name: string;
  readonly family = "solana" as const;
  readonly tokenStep = 1n;
  readonly native = WSOL_MINT;
  readonly nativeSymbol = "SOL";
  readonly nativeDecimals = 9;
  readonly cfg: SolanaChainConfig;
  private readonly keys: Keys;
  private readonly ctx: { programId: string; hookProgramId: string };
  private readonly client: FloorClient<"solana">;
  private readonly mintPrograms = new Map<string, Promise<{ program: string; decimals: number }>>();
  private nextId = 1;

  constructor(name: string, cfg: SolanaChainConfig, keys: Keys) {
    this.name = name;
    this.cfg = cfg;
    this.keys = keys;
    this.ctx = { programId: cfg.programId, hookProgramId: cfg.hookProgramId ?? FLOOR_HOOK_PROGRAM_ID };
    this.client = createSolanaClient({
      chain: { family: "solana", programId: this.ctx.programId, hookProgramId: this.ctx.hookProgramId },
      transport: { rpc: { getAccount: (a) => this.account(a) } },
    });
  }

  // ---- JSON-RPC --------------------------------------------------------------------------------------------------------

  async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(this.cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }) });
      } catch (e) {
        last = e;
        await sleep(300 * (attempt + 1));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${method}: HTTP ${res.status}`);
        await sleep(500 * (attempt + 1));
        continue;
      }
      const j = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
      if (j.error) throw new RpcError(j.error);
      return j.result as T;
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  private static info(v: { data: [string, string]; owner: string; lamports: number } | null): AccountInfo | null {
    return v ? { data: Uint8Array.from(Buffer.from(v.data[0], "base64")), owner: v.owner, lamports: BigInt(v.lamports) } : null;
  }

  async account(address: string): Promise<AccountInfo | null> {
    const r = await this.rpc<{ value: any }>("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]);
    return SolanaChain.info(r.value);
  }

  async accounts(addresses: readonly string[]): Promise<(AccountInfo | null)[]> {
    const out: (AccountInfo | null)[] = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const r = await this.rpc<{ value: any[] }>("getMultipleAccounts", [addresses.slice(i, i + 100), { encoding: "base64", commitment: "confirmed" }]);
      out.push(...r.value.map((v) => SolanaChain.info(v)));
    }
    return out;
  }

  /** ⛔ The network rail: a loopback node, or devnet / testnet by genesis hash; and the program must be there. */
  async verify(): Promise<string> {
    const [genesis, version] = await Promise.all([this.rpc<string>("getGenesisHash"), this.rpc<Record<string, unknown>>("getVersion")]);
    const why = allowSolana(this.cfg, genesis, String(version["solana-core"] ?? JSON.stringify(version)));
    const p = await this.account(this.cfg.programId);
    if (!p) throw new Error(`no floor_amm program at ${this.cfg.programId} on ${this.name}`);
    if (!(await this.account(configPda(this.cfg.programId)[0]))) throw new Error(`floor_amm at ${this.cfg.programId} on ${this.name} has no Config (not initialised)`);
    return why;
  }

  isAddress(s: string): boolean {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
    try {
      return base58Decode(s).length === 32;
    } catch {
      return false;
    }
  }

  addressOf(w: WalletRow): string | null {
    return w.sol;
  }

  private signer(w: WalletRow): SolSigner {
    const k = this.keys.sol(w);
    if (!k) throw new SendError(`wallet ${w.id} has no Solana key`, true);
    if (w.sol && k.address !== w.sol) throw new SendError(`wallet ${w.id}'s Solana key does not match its address`, true);
    return k;
  }

  // ---- mints and balances ----------------------------------------------------------------------------------------------

  /** A mint's token program (SPL Token or Token-2022) and decimals. */
  mintOf(mint: string): Promise<{ program: string; decimals: number }> {
    let p = this.mintPrograms.get(mint);
    if (!p) {
      p = this.account(mint).then((a) => {
        if (!a || (a.owner !== TOKEN_PROGRAM_ID && a.owner !== TOKEN_2022_PROGRAM_ID)) throw new Error(`${mint} is not a token mint on ${this.name}`);
        return { program: a.owner, decimals: a.data[44]! };
      });
      p.catch(() => this.mintPrograms.delete(mint));
      this.mintPrograms.set(mint, p);
    }
    return p;
  }

  async quoteInfo(asset: string): Promise<QuoteInfo> {
    if (asset === "native" || asset === WSOL_MINT) return { address: WSOL_MINT, symbol: "SOL", decimals: 9 };
    const { decimals } = await this.mintOf(asset);
    return { address: asset, symbol: (await this.symbolOf(asset)) ?? `${asset.slice(0, 4)}…`, decimals };
  }

  /** The Metaplex symbol, when the mint has metadata. */
  private async symbolOf(mint: string): Promise<string | null> {
    const m = await this.account(metadataPda(mint)[0]).catch(() => null);
    if (!m || m.owner !== METAPLEX) return null;
    try {
      const d = m.data;
      const nameLen = Number(readUintLE(d, 65, 4));
      const o = 69 + nameLen;
      const symLen = Number(readUintLE(d, o, 4));
      const sym = Buffer.from(d.subarray(o + 4, o + 4 + symLen)).toString("utf8").replace(/\0+$/, "").trim();
      return sym || null;
    } catch {
      return null;
    }
  }

  async balanceOf(asset: string, owner: string): Promise<bigint> {
    if (asset === "native" || asset === WSOL_MINT) return BigInt((await this.rpc<{ value: number }>("getBalance", [owner, { commitment: "confirmed" }])).value);
    const { program } = await this.mintOf(asset);
    const a = await this.account(associatedTokenAddress(owner, asset, program));
    return a && a.data.length >= 72 ? readUintLE(a.data, 64, 8) : 0n;
  }

  async gasReserve(): Promise<bigint> {
    return LAMPORTS_RESERVE;
  }

  // ---- launches --------------------------------------------------------------------------------------------------------

  async resolveToken(mint: string): Promise<LaunchRef | null> {
    if (!this.isAddress(mint)) return null;
    const a = await this.account(launchPda(mint, this.cfg.programId)[0]).catch(() => null);
    if (!a || a.owner !== this.cfg.programId) return null;
    try {
      const l = decodeLaunchV2Typed(a.data);
      if (l.baseMint !== mint) return null;
      return { chain: this.name, family: "solana", launchId: BigInt(l.id), token: mint, tokenDecimals: Number(l.decimals), quote: await this.quoteInfo(l.quoteMint) };
    } catch {
      return null;
    }
  }

  /** The launch as a trade sees it: the `LaunchV2` with the mint's supply applied when it fell (burns are real). */
  private async state(l: LaunchRef): Promise<LaunchV2Account> {
    const launch = launchPda(l.token, this.cfg.programId)[0];
    const [acct, mint] = await this.accounts([launch, l.token]);
    if (!acct || !mint) throw new SendError(`${l.token}'s launch account is gone`, true);
    const d = decodeLaunchV2Typed(acct.data);
    const live = readUintLE(mint.data, 36, 8);
    return live < d.supply ? { ...d, supply: live } : d;
  }

  async buy(w: WalletRow, l: LaunchRef, amountIn: bigint, slippageBps: number, ahead = 0n): Promise<TradeOut> {
    const k = this.signer(w);
    const s = await this.state(l);
    const q = (x: bigint): bigint => (x === 0n ? 0n : quoteBuySolanaV2(s, x).buy.tokens);
    let out: bigint;
    let minOut: bigint;
    if (ahead === 0n) {
      // the SDK's one buy min-out rule
      const i = solanaSettleInputsV2(s);
      out = q(amountIn);
      minOut = buyMinTokens(i.book, i.row, i.sup, amountIn, slippageBps, SOL_BUY_WALK_STEPS);
    } else {
      try {
        out = q(ahead + amountIn) - q(ahead);
      } catch {
        out = q(amountIn);
      }
      minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
    }
    const tx = await this.client.buildBuy({ launch: l.token, trader: k.address, amountIn, minOut: minOut > 0n ? minOut : 1n });
    const sig = await this.send([k], tx.instructions as Instruction[]);
    const ev = (await this.events(sig)).find((e) => e.name === "Trade");
    // what reached the wallet: the Trade event's `tokens` is before the buy's Milestone shares
    const got = await this.received(sig, l.token, k.address);
    return { tx: sig, quote: ev ? BigInt(ev.fields.quoteGross) - BigInt(ev.fields.refund ?? 0) : amountIn, tokens: got ?? (ev ? BigInt(ev.fields.tokens) : out) };
  }

  async sell(w: WalletRow, l: LaunchRef, tokensIn: bigint, slippageBps: number, ahead = 0n): Promise<TradeOut> {
    const k = this.signer(w);
    const s = await this.state(l);
    const i = solanaSettleInputsV2(s);
    const q = (x: bigint): bigint => (x === 0n ? 0n : quoteSellImpactV2(i.book, x, sCirc(i.book, i.sup)).quote.out);
    let out: bigint;
    try {
      out = q(ahead + tokensIn) - q(ahead);
    } catch {
      out = q(tokensIn);
    }
    const minOut = out > 0n ? minOutAt(out, slippageBps) : 1n;
    const tx = await this.client.buildSell({ launch: l.token, trader: k.address, tokensIn, minOut });
    const sig = await this.send([k], tx.instructions as Instruction[]);
    const ev = (await this.events(sig)).find((e) => e.name === "Trade");
    return { tx: sig, quote: ev ? BigInt(ev.fields.quoteNet) : out, tokens: ev ? BigInt(ev.fields.tokens) : tokensIn };
  }

  /** SOL (`native`), or an SPL / Token-2022 token into the recipient's associated account (made if missing). */
  async transfer(w: WalletRow, asset: string, to: string, amount: bigint): Promise<string> {
    const k = this.signer(w);
    if (asset === "native" || asset === WSOL_MINT) return this.send([k], [systemTransferInstruction({ from: k.address, to, lamports: amount })]);
    const { program, decimals } = await this.mintOf(asset);
    return this.send([k], [
      createAssociatedTokenAccountIdempotentInstruction({ payer: k.address, owner: to, mint: asset, tokenProgram: program }),
      transferCheckedInstruction({ source: associatedTokenAddress(k.address, asset, program), mint: asset, destination: associatedTokenAddress(to, asset, program), owner: k.address, amount, decimals, tokenProgram: program }),
    ]);
  }

  /** `create_launch` (v2): the Config, the preset row and the quote's registry entry read once; the Team Buy (optional)
   *  priced off the row; the Team Slot opens at the row's max; the mint is the creator's PDA for a fresh nonce. */
  async launcher(a: LaunchArgsOnChain): Promise<Launcher> {
    const pid = this.cfg.programId;
    const config = configPda(pid)[0];
    const preset = presetPda(a.preset, pid)[0];
    const q = await this.quoteInfo(a.quote === "native" ? WSOL_MINT : a.quote);
    const quote = quoteEntryPda(q.address, pid)[0];
    const [cfgA, rowA, qeA, clockA] = await this.accounts([config, preset, quote, CLOCK_SYSVAR_ID]);
    const cfg = decodeConfig(cfgA!.data);
    if (cfg.createPaused) throw new Error(`creates are paused on ${this.name}`);
    if (!rowA) throw new Error(`no preset ${a.preset} on ${this.name}`);
    const pr = decodePresetRowV2Typed(rowA.data);
    if (!pr.enabled || pr.deleted) throw new Error(`preset ${a.preset} is not open on ${this.name}`);
    if (!qeA) throw new Error(`${q.symbol} (${q.address}) is not a listed quote on ${this.name}`);
    const qe = decodeQuoteEntry(qeA.data);
    if (!qe.enabled) throw new Error(`${q.symbol} (${q.address}) is not an enabled quote on ${this.name}`);
    const now = BigInt.asIntN(64, readUintLE(clockA!.data, 32, 8));
    const qtp = qe.tokenProgram as string;
    const createFee = BigInt(qe.createFee);
    const usd = BigInt(qe.usdCentsX64);
    const tb = planTeamBuy(rowOf(pr.row), { quoteDecimals: q.decimals, quoteUsdCentsX64: usd, tokenDecimals: 6 }, a.teamBuy, a.slippageBps);
    const pays = createFee + tb.creatorBuy;
    const wsol = q.address === WSOL_MINT;
    return {
      quote: q,
      paysUpTo: pays,
      teamBuy: tb.creatorBuy,
      teamBuyMax: tb.teamBuyMax,
      teamSlotBps: tb.teamSlotBps,
      create: async (w, name, symbol) => {
        const k = this.signer(w);
        const hit = await grindMintNonce({ creator: k.address, programId: this.ctx.programId, fits: () => true, budgetMs: 10_000 });
        if (!hit) throw new Error("no mint nonce with a first-try bump found in 10 s");
        const mintNonce = hit.nonce;
        const m = createMintAccounts({ ...this.ctx, creator: k.address, quoteMint: q.address, quoteTokenProgram: qtp, args: { mintNonce } });
        const creatorQuote = associatedTokenAddress(k.address, q.address, qtp);
        const wrap: Instruction[] = wsol
          ? [createAssociatedTokenAccountIdempotentInstruction({ payer: k.address, owner: k.address, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM_ID }), systemTransferInstruction({ from: k.address, to: creatorQuote, lamports: pays }), syncNativeInstruction(creatorQuote)]
          : [];
        const create = createLaunchInstructionV2({
          ...this.ctx,
          creator: k.address, config, preset, quote, quoteMint: q.address, creatorQuote, quoteTokenProgram: qtp,
          args: { name, symbol, creatorBuy: tb.creatorBuy, creatorBuyMinTokens: tb.creatorBuyMinTokens, quoteUsdCentsX64: 0n, mintNonce },
          teamBuyMax: tb.teamBuyMax,
          teamSlotMaxBps: tb.teamSlotBps,
          registry: { entry: { usdCentsX64: usd, updatedAt: BigInt(qe.updatedAt) }, now },
        });
        const unwrap = wsol ? [closeAccountInstruction({ account: creatorQuote, destination: k.address, owner: k.address, tokenProgram: TOKEN_PROGRAM_ID })] : [];
        const one = [computeUnitLimitInstruction(CU), ...wrap, create, ...unwrap];
        let sig: string;
        if (this.fits(k.address, one)) sig = await this.send([k], one);
        else {
          // too big for one packet: the wrap first, then the create (its refund stays wrapped until the next trade closes it)
          if (wrap.length) await this.send([k], wrap);
          sig = await this.send([k], [computeUnitLimitInstruction(CU), create]);
        }
        const ev = (await this.events(sig)).find((e) => e.name === "LaunchCreatedV2");
        return { launchId: ev ? BigInt(ev.fields.id) : null, token: m.baseMint, tx: sig, paid: pays };
      },
    };
  }

  // ---- snipe -----------------------------------------------------------------------------------------------------------

  /** The program's newest signature now ("" when it has none): the creates after it are the ones `nextLaunch` finds. */
  async createsMark(): Promise<string> {
    const r = await this.rpc<{ signature: string }[]>("getSignaturesForAddress", [this.cfg.programId, { limit: 1, commitment: "confirmed" }]);
    return r[0]?.signature ?? "";
  }

  /** Polls the program's new transactions for `LaunchCreatedV2` events (the create's event CPI) until one is accepted. */
  async nextLaunch(since: string, accept: (c: CreatedLaunch) => boolean, deadline: number): Promise<CreatedLaunch | null> {
    let until: string | undefined = since || undefined;
    const text = (b: Uint8Array): string => Buffer.from(b).toString("utf8").replace(/\0+$/, "").trim();
    for (;;) {
      const sigs: { signature: string; err: unknown }[] = await this.rpc("getSignaturesForAddress", [this.cfg.programId, { ...(until ? { until } : {}), limit: 1000, commitment: "confirmed" }]);
      if (sigs.length > 0) {
        until = sigs[0]!.signature;
        for (const sg of [...sigs].reverse()) {
          if (sg.err) continue;
          const ev = (await this.events(sg.signature)).find((e) => e.name === "LaunchCreatedV2");
          if (!ev) continue;
          let launch: LaunchRef | null = null;
          for (let i = 0; i < 5 && !launch; i++) {
            launch = await this.resolveToken(ev.fields.mint as string);
            if (!launch) await sleep(POLL_MS);
          }
          if (!launch) continue;
          const c: CreatedLaunch = { launch, creator: ev.fields.creator as string, name: text(ev.fields.name as Uint8Array), symbol: text(ev.fields.symbol as Uint8Array) };
          if (accept(c)) return c;
        }
      }
      if (Date.now() >= deadline) return null;
      await sleep(Math.max(0, Math.min(POLL_MS, deadline - Date.now())));
    }
  }

  // ---- claim -----------------------------------------------------------------------------------------------------------

  async owedOf(w: WalletRow, launches: readonly LaunchRef[]): Promise<WalletOwed> {
    const wallet = this.signer(w).address;
    const pid = this.ctx.programId;
    const clock = await this.account(CLOCK_SYSVAR_ID);
    const now = BigInt.asIntN(64, readUintLE(clock!.data, 32, 8));
    const rows: LaunchOwedV2[] = [];
    for (const l of launches) {
      const launch = launchPda(l.token, pid)[0];
      const slot = teamSlotPda(launch, pid)[0];
      const pos = holderPositionPda(launch, wallet, this.ctx.hookProgramId)[0];
      const book = holderBookPda(launch, this.ctx.hookProgramId)[0];
      const [la, ts, pa, ba] = await this.accounts([launch, slot, pos, book]);
      if (!la) throw new Error(`${l.token}'s launch account is gone`);
      const holderOwed = pa && ba ? holderOwedNowV2({ positionData: pa.data, bookData: ba.data, balance: await this.balanceOf(l.token, wallet) }) : 0n;
      rows.push(launchOwedV2({ wallet, launch, launchData: la.data, teamSlot: ts ? { address: slot, data: ts.data } : null, now, holderOwed }));
    }
    const refOwed: { quoteMint: string; quoteTokenProgram: string; owed: bigint }[] = [];
    for (const r of rows) {
      if (refOwed.some((x) => x.quoteMint === r.quoteMint)) continue;
      const a = await this.account(refOwedPda(wallet, r.quoteMint, pid)[0]);
      refOwed.push({ quoteMint: r.quoteMint, quoteTokenProgram: r.quoteTokenProgram, owed: a ? BigInt((decodeRefOwed(a.data) as any).owed) : 0n });
    }
    const owed: OwedLaunch[] = rows.map((r, i) => ({ launch: launches[i]!, owed: { creator: r.owed.creator, creatorRef: r.owed.creatorRef, teamSlot: r.owed.teamSlot, holder: r.owed.holder, teamBuy: r.owed.teamBuy, shareBought: r.owed.shareBought } }));
    const extra: ExtraOwed[] = refOwed.filter((x) => x.owed > 0n).map((x) => ({ quote: x.quoteMint, kind: "traderRef", amount: x.owed }));
    return { launches: owed, extra, raw: { launches: rows, refOwed } };
  }

  async claim(w: WalletRow, owed: WalletOwed, to?: string): Promise<ClaimOut> {
    if (to) throw new SendError("--to: a Solana claim pays the wallet's own token accounts; there is no payout address to name", true);
    const k = this.signer(w);
    const raw = owed.raw as { launches: LaunchOwedV2[]; refOwed: { quoteMint: string; quoteTokenProgram: string; owed: bigint }[] };
    const { value: bh } = await this.rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    // a quote that is itself a launch's token pays through the hook
    const quotes = [...new Set(raw.launches.map((r) => r.quoteMint))];
    const launchQuotes: string[] = [];
    for (const q of quotes) if (q !== WSOL_MINT && (await this.account(launchPda(q, this.ctx.programId)[0]))) launchQuotes.push(q);
    const plan = planClaimAllV2({ wallet: k.address, launches: raw.launches, refOwed: raw.refOwed, recentBlockhash: bh.blockhash, launchQuotes, ...this.ctx });
    const tokens = owed.launches.filter((x) => x.owed.teamBuy > 0n || x.owed.shareBought > 0n).map((x) => x.launch.token);
    const read = (): Promise<bigint[]> => Promise.all([...quotes, ...tokens].map((a) => this.balanceOf(a, k.address)));
    const before = await read();
    const txs: string[] = [];
    let fees = 0n;
    let error: string | undefined;
    try {
      for (const t of plan.transactions) {
        const sig = await this.send([k], t.instructions);
        txs.push(sig);
        fees += BigInt((await this.tx(sig).catch(() => null))?.meta?.fee ?? 0);
      }
    } catch (e) {
      error = (e as Error).message;
    }
    const after = await read();
    const claimed = quotes
      .map((q, i) => ({ asset: q, amount: after[i]! - before[i]! + (q === WSOL_MINT ? fees : 0n) }))
      .filter((x) => x.amount !== 0n);
    return { txs, claimed, tokens: tokens.reduce((t, _, i) => t + (after[quotes.length + i]! - before[quotes.length + i]!), 0n), ...(error ? { error } : {}) };
  }

  // ---- Team Slot -------------------------------------------------------------------------------------------------------

  async teamSlotAdd(w: WalletRow, l: LaunchRef, member: SlotMember, shares: bigint): Promise<string> {
    const k = this.signer(w);
    const s = await this.state(l);
    const launch = launchPda(l.token, this.ctx.programId)[0];
    const qp = (await this.mintOf(l.quote.address)).program;
    const payerQuote = associatedTokenAddress(k.address, l.quote.address, qp);
    const add = teamSlotAddMemberV2({
      ...this.ctx,
      payer: k.address,
      launch,
      teamSlot: teamSlotPda(launch, this.ctx.programId)[0],
      quoteMint: l.quote.address,
      payerQuote,
      quoteVault: s.quoteVault,
      quoteTokenProgram: qp,
      baseMint: l.token,
      member,
      shares,
    });
    // the instruction names the payer's quote account even though nothing is paid: make sure it exists
    return this.send([k], [computeUnitLimitInstruction(CU), createAssociatedTokenAccountIdempotentInstruction({ payer: k.address, owner: k.address, mint: l.quote.address, tokenProgram: qp }), add]);
  }

  async teamShareOwed(w: WalletRow, l: LaunchRef): Promise<bigint> {
    const o = await this.owedOf(w, [l]);
    return o.launches[0]!.owed.teamSlot;
  }

  async teamShareBuy(w: WalletRow, l: LaunchRef, amountIn: bigint, slippageBps: number): Promise<TradeOut> {
    const k = this.signer(w);
    const s = await this.state(l);
    const launch = launchPda(l.token, this.ctx.programId)[0];
    const out = quoteBuySolanaV2(s, amountIn).buy.tokens;
    const minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
    const memberBase = associatedTokenAddress(k.address, l.token, TOKEN_2022_PROGRAM_ID);
    const sig = await this.send([k], [
      computeUnitLimitInstruction(CU),
      createAssociatedTokenAccountIdempotentInstruction({ payer: k.address, owner: k.address, mint: l.token, tokenProgram: TOKEN_2022_PROGRAM_ID }),
      teamShareBuyInstructionV2({ ...this.ctx, member: k.address, launch, baseMint: l.token, quoteMint: l.quote.address, tokenVault: s.tokenVault, quoteVault: s.quoteVault, memberBase, amountIn, minOut: minOut > 0n ? minOut : 1n }),
    ]);
    const ev = (await this.events(sig)).find((e) => e.name === "Trade");
    return { tx: sig, quote: ev ? BigInt(ev.fields.quoteGross) - BigInt(ev.fields.refund ?? 0) : amountIn, tokens: ev ? BigInt(ev.fields.tokens) : out };
  }

  // ---- sending ---------------------------------------------------------------------------------------------------------

  private fits(payer: string, ixs: Instruction[]): boolean {
    try {
      return transactionSize(compileV0Message({ payer, instructions: ixs, recentBlockhash: SYSTEM_PROGRAM_ID })) <= PACKET_DATA_SIZE;
    } catch {
      return false;
    }
  }

  /**
   * Compile, sign, send (the node's preflight simulates it: a program error comes back named and costs nothing), then
   * watch the signature. ⛔ Unlike EVM, a Solana send can be proven never to land: once the chain passes its blockhash's last
   * valid height with no status, it is a plain retryable failure. Only a send still unseen after `CONFIRM_MS` with its
   * blockhash valid is UNCONFIRMED (fatal, never retried or re-routed).
   */
  async send(signers: SolSigner[], ixs: Instruction[]): Promise<string> {
    const payer = signers[0]!.address;
    const { value: bh } = await this.rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const msg = compileV0Message({ payer, instructions: ixs, recentBlockhash: bh.blockhash });
    const need = messageSigners(msg);
    const sigs = need.map((addr) => {
      const s = signers.find((x) => x.address === addr);
      if (!s) throw new SendError(`no key for the signer ${addr}`, true);
      return s.sign(msg);
    });
    const raw = concatBytes(shortVec(sigs.length), ...sigs, msg);
    if (raw.length > PACKET_DATA_SIZE) throw new SendError(`the transaction is ${raw.length} bytes, over ${PACKET_DATA_SIZE}`, true);
    const sig = base58Encode(sigs[0]!);
    try {
      await this.rpc<string>("sendTransaction", [Buffer.from(raw).toString("base64"), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 5 }]);
    } catch (e) {
      if (e instanceof RpcError) throw errorFrom(e.data?.logs, e.data?.err, e.message);
      throw new SendError((e as Error).message, false);
    }
    const until = Date.now() + CONFIRM_MS;
    for (;;) {
      const st = (await this.rpc<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>("getSignatureStatuses", [[sig], { searchTransactionHistory: false }])).value[0];
      if (st?.err) {
        const tx = await this.tx(sig).catch(() => null);
        const d = errorFrom(tx?.meta?.logMessages, st.err, "failed on chain");
        throw new SendError(`${d.message} on chain (${sig})`, d.fatal);
      }
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
      if (!st) {
        const height = await this.rpc<number>("getBlockHeight", [{ commitment: "confirmed" }]);
        if (height > bh.lastValidBlockHeight) {
          // one last look: it may have landed just before the expiry
          const again = (await this.rpc<{ value: ({ err: unknown } | null)[] }>("getSignatureStatuses", [[sig], { searchTransactionHistory: true }])).value[0];
          if (!again) throw new SendError(`expired unlanded (blockhash past height ${bh.lastValidBlockHeight}): ${sig}`, false);
          continue;
        }
      }
      if (Date.now() > until) throw new SendError(`not confirmed after ${CONFIRM_MS / 1000} s: ${sig} (not retried: it may still land)`, true, true);
      await sleep(POLL_MS);
    }
  }

  private tx(sig: string): Promise<any> {
    return this.rpc<any>("getTransaction", [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
  }

  /** The change in `owner`'s `mint` balance across a landed transaction (its token balances), or null when unread. */
  async received(sig: string, mint: string, owner: string): Promise<bigint | null> {
    const tx: any = await this.tx(sig).catch(() => null);
    if (!tx?.meta?.postTokenBalances) return null;
    const of = (xs: any[] | undefined): bigint => (xs ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((t, b) => t + BigInt(b.uiTokenAmount.amount), 0n);
    return of(tx.meta.postTokenBalances) - of(tx.meta.preTokenBalances);
  }

  /** The program's events in a landed transaction (its `emit_cpi!` inner instructions). */
  async events(sig: string): Promise<FloorEventV2[]> {
    let tx: any = null;
    for (let i = 0; i < 10 && !tx; i++) {
      tx = await this.tx(sig).catch(() => null);
      if (!tx) await sleep(POLL_MS);
    }
    if (!tx) return [];
    const keys: string[] = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
    const out: FloorEventV2[] = [];
    for (const group of tx.meta?.innerInstructions ?? []) {
      for (const ix of group.instructions) {
        if (keys[ix.programIdIndex] !== this.cfg.programId) continue;
        try {
          const ev = decodeEventCpiV2(base58Decode(ix.data));
          if (ev) out.push(ev);
        } catch {
          // not an event of this schema
        }
      }
    }
    return out;
  }
}

/** A random u64 mint nonce: the mint is the PDA ["mint", creator, nonce], so a fresh nonce is a fresh mint. */
