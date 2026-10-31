import type { Instruction } from "../solana/instruction.ts";
import type { EvmCall } from "../v2/evm.ts";
import type { FloorError } from "../errors.ts";
export type FloorFamily = "solana" | "evm";
export interface SolanaChain {
    family: "solana";
    programId?: string;
    hookProgramId?: string;
}
export interface EvmChain {
    family: "evm";
    chainId: number;
    floorAmm: string;
    multicall?: string | null;
}
export type FloorChain = SolanaChain | EvmChain;
export type SolanaLaunchKey = string;
export type EvmLaunchKey = bigint;
export type LaunchKeyOf<F extends FloorFamily> = F extends "solana" ? SolanaLaunchKey : EvmLaunchKey;
export interface SolanaAccount {
    data: Uint8Array;
    owner: string;
}
export interface SolanaTransport {
    rpc: {
        getAccount(address: string): Promise<SolanaAccount | null>;
        getEpoch?(): Promise<bigint>;
    };
    send?: (tx: SolanaTx) => Promise<string>;
}
export interface EvmTransport {
    rpc: {
        call(call: EvmCall): Promise<string>;
    };
    send?: (call: EvmCall) => Promise<string>;
}
export type TransportOf<F extends FloorFamily> = F extends "solana" ? SolanaTransport : EvmTransport;
export type ChainOf<F extends FloorFamily> = F extends "solana" ? SolanaChain : EvmChain;
export interface FloorClientOptions<F extends FloorFamily = FloorFamily> {
    chain: ChainOf<F>;
    transport: TransportOf<F>;
}
export interface FeeLegs {
    backing: bigint;
    team: bigint;
    platform: bigint;
    floor: bigint;
    holder: bigint;
    total: bigint;
}
export interface Quote {
    family: FloorFamily;
    chainId: number | null;
    side: "buy" | "sell";
    launch: string;
    amountIn: bigint;
    amountOut: bigint;
    minOut: bigint;
    slippageBps: number;
    fees: FeeLegs;
    priceImpactBps: number | null;
    refund: bigint;
    graduates: boolean;
}
export interface QuoteBuyParams<F extends FloorFamily = FloorFamily> {
    launch: LaunchKeyOf<F>;
    amountIn: bigint;
    slippageBps?: number;
    wallet?: string;
}
export interface QuoteSellParams<F extends FloorFamily = FloorFamily> {
    launch: LaunchKeyOf<F>;
    tokensIn: bigint;
    slippageBps?: number;
}
export interface BuildBuyParams<F extends FloorFamily = FloorFamily> {
    launch: LaunchKeyOf<F>;
    trader: string;
    amountIn: bigint;
    minOut: bigint;
    recipient?: string;
    deadline?: bigint;
}
export interface BuildSellParams<F extends FloorFamily = FloorFamily> {
    launch: LaunchKeyOf<F>;
    trader: string;
    tokensIn: bigint;
    minOut: bigint;
    recipient?: string;
    deadline?: bigint;
}
export interface ClaimParams<F extends FloorFamily = FloorFamily> {
    wallet: string;
    types: number;
    quote: string;
    launches: readonly LaunchKeyOf<F>[];
}
export interface SolanaTx {
    family: "solana";
    instructions: Instruction[];
}
export interface EvmTx {
    family: "evm";
    chainId: number;
    calls: EvmCall[];
}
export type TxOf<F extends FloorFamily> = F extends "solana" ? SolanaTx : EvmTx;
export type FloorTx = SolanaTx | EvmTx;
export interface FloorClient<F extends FloorFamily = FloorFamily> {
    readonly family: F;
    readonly chain: ChainOf<F>;
    quoteBuy(p: QuoteBuyParams<F>): Promise<Quote>;
    quoteSell(p: QuoteSellParams<F>): Promise<Quote>;
    buildBuy(p: BuildBuyParams<F>): Promise<TxOf<F>>;
    buildSell(p: BuildSellParams<F>): Promise<TxOf<F>>;
    claim(p: ClaimParams<F>): Promise<TxOf<F>>;
    send(tx: TxOf<F>): Promise<string[]>;
    decodeError(raw: unknown): FloorError | null;
}
export type FloorChainClient<F extends FloorFamily> = FloorClient<F>;
export const DEFAULT_SLIPPAGE_BPS = 100;
