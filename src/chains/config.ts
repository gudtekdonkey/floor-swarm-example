// The chains a swarm uses: any EVM chain or Solana cluster where the FLOOR Program is deployed, mainnet, testnet or local.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface EvmChainConfig {
  family: "evm";
  chainId: number;
  rpc: string;
  floorAmm: string;
  /** The native coin's symbol, for printing. */
  native?: string;
}

export interface SolanaChainConfig {
  family: "solana";
  rpc: string;
  /** The floor_amm program id on this cluster (a local deploy may use its own). */
  programId: string;
  /** The floor_hook program id (default: the SDK's); a local deploy may use its own. */
  hookProgramId?: string;
}

export type ChainConfig = EvmChainConfig | SolanaChainConfig;

/** Solana clusters by genesis hash, for naming. Any cluster is accepted; the program must be there (`verify`). */
export const SOLANA_GENESIS: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "Solana mainnet-beta",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "Solana devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "Solana testnet",
};

/** The cluster's name: a loopback node (Surfpool, solana-test-validator), else by genesis hash. Never refuses. */
export function nameSolana(c: SolanaChainConfig, genesisHash: string, version: string): string {
  if (isLoopback(c.rpc)) return `local Solana node (${version})`;
  return SOLANA_GENESIS[genesisHash] ?? `Solana cluster (genesis ${genesisHash})`;
}

/** EVM chains FLOOR runs on, mainnets and testnets, for naming. Any chain id is accepted. */
export const EVM_CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  56: "BNB Chain",
  42161: "Arbitrum",
  5042: "Arc",
  4663: "Robinhood Chain",
  999: "HyperEVM",
  99901: "Elysium",
  11155111: "Sepolia",
  84532: "Base Sepolia",
  97: "BNB Chain testnet",
  421614: "Arbitrum Sepolia",
  998: "HyperEVM testnet",
  5042002: "Arc testnet",
  46630: "Robinhood Chain testnet",
  99801: "Elysium testnet",
};

export const isLoopback = (rpc: string): boolean => {
  try {
    const h = new URL(rpc).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
};

/** The chain's name, or throws when the RPC's chain id is not the config's. `clientVersion` is `web3_clientVersion`. */
export function nameEvm(c: EvmChainConfig, reportedChainId: number, clientVersion: string): string {
  if (reportedChainId !== c.chainId) throw new Error(`the RPC reports chain id ${reportedChainId}, the config says ${c.chainId}`);
  if (isLoopback(c.rpc) && /anvil/i.test(clientVersion)) return `local anvil (chain id ${c.chainId})`;
  return EVM_CHAIN_NAMES[c.chainId] ?? `chain id ${c.chainId}`;
}

export function loadChains(path: string): Record<string, ChainConfig> {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, ChainConfig>) : {};
}

export function saveChains(path: string, chains: Record<string, ChainConfig>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(chains, null, 2) + "\n");
}
