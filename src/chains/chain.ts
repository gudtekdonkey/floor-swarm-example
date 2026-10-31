// What every chain adapter gives the commands (EVM: `evm.ts`, Solana: `solana.ts`). The commands never branch on the family:
// amounts are base units of the asset named, `native` is the chain's gas coin (on Solana a wSOL-quoted launch spends SOL).
import type { LocalAccount } from "viem/accounts";
import type { WalletRow } from "../store/db.ts";
import type { SolSigner } from "../vault/sol-keys.ts";

export type Family = "evm" | "solana";

export interface QuoteInfo {
  address: string;
  symbol: string;
  decimals: number;
}

/** A launch the swarm can trade: `<chain>:<token>`. `launchId` is the program's numeric id (EVM's key; Solana's `Launch.id`). */
export interface LaunchRef {
  chain: string;
  family: Family;
  launchId: bigint;
  token: string;
  tokenDecimals: number;
  quote: QuoteInfo;
}

export interface TradeOut {
  tx: string;
  /** A buy: the quote spent (gross); a sell: the quote received (net). */
  quote: bigint;
  tokens: bigint;
}

/** The swarm's keys, by wallet (null: the wallet has no key in this family). */
export interface Keys {
  evm(w: WalletRow): LocalAccount | null;
  sol(w: WalletRow): SolSigner | null;
}

export interface LaunchArgsOnChain {
  preset: number;
  quote: string;
  /** The optional Team Buy: quote base units, or "max" (the row's share); 0 = none. */
  teamBuy: bigint | "max";
  /** Off the Team Buy's quoted tokens for its minimum. */
  slippageBps: number;
}

/** A create, checked once against the chain's row and quote; `create` sends one launch from a wallet. */
export interface Launcher {
  quote: QuoteInfo;
  /** The most one create sends or pulls: the create fee + the Team Buy (quote units). */
  paysUpTo: bigint;
  /** The Team Buy this create sends (0 = none) and the row's max for it. */
  teamBuy: bigint;
  teamBuyMax: bigint;
  /** The Team Slot's rate, the row's max. */
  teamSlotBps: number;
  create(w: WalletRow, name: string, symbol: string): Promise<{ launchId: bigint | null; token: string | null; tx: string; paid: bigint }>;
}

/** Which launches `snipe` takes: a creator's, a ticker's, or any. */
export interface LaunchFilter {
  /** The creator's address on this chain's family. */
  creator?: string;
  /** The ticker (compared without case). */
  symbol?: string;
  any?: boolean;
}

/** A launch the program has just created, as its create event states it. */
export interface CreatedLaunch {
  launch: LaunchRef;
  creator: string;
  name: string;
  symbol: string;
}

/**
 * What a wallet is owed on one launch. The quote legs are in the launch's quote (base units); `teamBuy` (the unlocked Team Buy)
 * and `shareBought` (tokens a Team Share buy booked) are launch tokens the claim pays out.
 */
export interface Owed {
  creator: bigint;
  creatorRef: bigint;
  teamSlot: bigint;
  holder: bigint;
  teamBuy: bigint;
  shareBought: bigint;
}

export interface OwedLaunch {
  launch: LaunchRef;
  owed: Owed;
}

/** Owed to the wallet in a quote, not by one launch: trader referrals, and EVM's quote-level legs and failed payouts. */
export interface ExtraOwed {
  quote: string;
  kind: "creator" | "creatorRef" | "teamSlot" | "traderRef" | "payout";
  amount: bigint;
}

export interface WalletOwed {
  launches: OwedLaunch[];
  extra: ExtraOwed[];
  /** The adapter's own read, handed back to `claim` (opaque to the commands). */
  raw: unknown;
}

export interface ClaimOut {
  /** The claim transactions sent, in order. */
  txs: string[];
  /** What reached the wallet, per asset (the quote, net of the gas the claim cost when the quote is the gas coin). */
  claimed: { asset: string; amount: bigint }[];
  /** Launch tokens the claims paid (the unlocked Team Buy, tokens a Team Share buy booked). */
  tokens: bigint;
  /** A claim that failed part-way: `txs` holds what was sent before it. */
  error?: string;
}

/** A Team Slot member: a wallet, or a social handle that is bound to a wallet later. */
export type SlotMember = { wallet: string } | { platform: string; handle: string };

export interface Chain {
  readonly name: string;
  readonly family: Family;
  /** The gas coin's asset id (EVM the zero address, Solana the wSOL mint). */
  readonly native: string;
  readonly nativeSymbol: string;
  readonly nativeDecimals: number;
  /** The smallest token amount a sell takes, in token units (EVM 10¹²: 18-decimal tokens over 6-decimal math; Solana 1). */
  readonly tokenStep: bigint;
  verify(): Promise<string>;
  /** Is `s` an address on this family (a token, a wallet)? */
  isAddress(s: string): boolean;
  /** The wallet's address here, or null. */
  addressOf(w: WalletRow): string | null;
  quoteInfo(asset: string): Promise<QuoteInfo>;
  balanceOf(asset: string, owner: string): Promise<bigint>;
  /** Native the swarm keeps in each wallet for its sends. */
  gasReserve(): Promise<bigint>;
  resolveToken(token: string): Promise<LaunchRef | null>;
  /** `ahead`: what the rest of an instant batch puts in before this send at worst (quoted as landing last). */
  buy(w: WalletRow, l: LaunchRef, amountIn: bigint, slippageBps: number, ahead?: bigint): Promise<TradeOut>;
  sell(w: WalletRow, l: LaunchRef, tokensIn: bigint, slippageBps: number, ahead?: bigint): Promise<TradeOut>;
  transfer(w: WalletRow, asset: string, to: string, amount: bigint): Promise<string>;
  launcher(a: LaunchArgsOnChain): Promise<Launcher>;

  // ---- snipe -------------------------------------------------------------------------------------------------------------
  /** A point to watch creates from: launches created after it are found by `nextLaunch`. */
  createsMark(): Promise<string>;
  /**
   * The first launch created after `since` that `accept` takes, or null once `deadline` (epoch ms) has passed. Reads only.
   */
  nextLaunch(since: string, accept: (c: CreatedLaunch) => boolean, deadline: number): Promise<CreatedLaunch | null>;

  // ---- claim -------------------------------------------------------------------------------------------------------------
  /** What `w` is owed on `launches` (and in their quotes). Reads only. */
  owedOf(w: WalletRow, launches: readonly LaunchRef[]): Promise<WalletOwed>;
  /** Sends the claim transactions for what `owed` read. `to`: where EVM's owed payouts go (Solana refuses it). */
  claim(w: WalletRow, owed: WalletOwed, to?: string): Promise<ClaimOut>;

  // ---- Team Slot ---------------------------------------------------------------------------------------------------------
  /** The launch's creator adds `member` to its Team Slot with `shares` share units (or tops it up). */
  teamSlotAdd(w: WalletRow, l: LaunchRef, member: SlotMember, shares: bigint): Promise<string>;
  /** The Team Share a member wallet can spend on a buy now (quote base units; 0 when it holds no place). */
  teamShareOwed(w: WalletRow, l: LaunchRef): Promise<bigint>;
  /** A member spends up to `amountIn` of its owed Team Share on the launch's token; the tokens are booked to it (claim). */
  teamShareBuy(w: WalletRow, l: LaunchRef, amountIn: bigint, slippageBps: number): Promise<TradeOut>;
}

/** A send that failed with a reason worth printing, and whether a retry could help. */
export class SendError extends Error {
  override name = "SendError";
  readonly fatal: boolean;
  /** Sent, outcome unknown (it may still land): never retried or re-routed. */
  readonly unconfirmed: boolean;
  constructor(message: string, fatal: boolean, unconfirmed = false) {
    super(message);
    this.fatal = fatal;
    this.unconfirmed = unconfirmed;
  }
}

// A program error a fresh quote can cure; every other decoded one is fatal for that wallet.
export const RETRYABLE = /slippage|deadline|minTokens|minQuote|TooLittle|Short$/i;
