// The chains a swarm may use. ⛔ Testnets and local nodes only: a chain is refused unless its
// chain id is a known testnet, or its RPC is on loopback AND the node says it is anvil.
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

/** Solana clusters by genesis hash. Off loopback only devnet and testnet pass; mainnet-beta never. */
export const SOLANA_GENESIS: Record<string, string> = {
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "Solana devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "Solana testnet",
};
export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/**
 * Why a Solana cluster is allowed, or throws. A loopback node (Surfpool, solana-test-validator) passes whatever genesis it
 * reports: Surfpool forks mainnet's accounts and may report its genesis hash, but nothing sent to it leaves the machine.
 */
export function allowSolana(c: SolanaChainConfig, genesisHash: string, version: string): string {
  if (isLoopback(c.rpc)) return `local Solana node (${version})`;
  const t = SOLANA_GENESIS[genesisHash];
  if (t) return t;
  throw new Error(`the cluster at ${c.rpc} (genesis ${genesisHash}${genesisHash === SOLANA_MAINNET_GENESIS ? ", mainnet-beta" : ""}) is not devnet, testnet or a local node: the swarm refuses it`);
}

/** Public EVM testnets FLOOR deploys to. A mainnet id is never here. */
export const EVM_TESTNETS: Record<number, string> = {
  11155111: "Sepolia",
  84532: "Base Sepolia",
  97: "BNB Chain testnet",
  421614: "Arbitrum Sepolia",
  998: "HyperEVM testnet",
  5042002: "Arc testnet",
  46630: "Robinhood Chain testnet",
};

export const isLoopback = (rpc: string): boolean => {
  try {
    const h = new URL(rpc).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
};

/** Why a chain is allowed, or throws. `clientVersion` is the node's `web3_clientVersion`. */
export function allow(c: EvmChainConfig, reportedChainId: number, clientVersion: string): string {
  if (reportedChainId !== c.chainId) throw new Error(`the RPC reports chain id ${reportedChainId}, the config says ${c.chainId}`);
  if (isLoopback(c.rpc) && /anvil/i.test(clientVersion)) return `local anvil (chain id ${c.chainId})`;
  const t = EVM_TESTNETS[c.chainId];
  if (t) return t;
  throw new Error(`chain id ${c.chainId} at ${c.rpc} is not a testnet or a local anvil: the swarm refuses it`);
}

export function loadChains(path: string): Record<string, ChainConfig> {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, ChainConfig>) : {};
}

export function saveChains(path: string, chains: Record<string, ChainConfig>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(chains, null, 2) + "\n");
}
