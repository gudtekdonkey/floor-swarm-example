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
