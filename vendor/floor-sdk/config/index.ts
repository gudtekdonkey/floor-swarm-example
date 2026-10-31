import { CHAIN_ROWS, PROGRAM_IDS } from "./generated.ts";
export { PROGRAM_IDS };
import { CHAIN_REGISTRY, CHAIN_SLUGS, EVM_CHAIN_SLUGS } from "./registry.gen.ts";
export { CHAIN_REGISTRY, CHAIN_SLUGS, EVM_CHAIN_SLUGS };
export type ChainSlug = (typeof CHAIN_SLUGS)[number];
export type ChainName = (typeof CHAIN_ROWS)[number]["name"];
export type EvmChainName = Exclude<ChainName, "solana">;
export interface QuoteRow {
    symbol: string;
    name: string;
    address: string;
    decimals: number;
    kind: string;
    tokenProgram?: string;
    deferred?: boolean;
}
export interface ExplorerRow {
    name: string;
    url: string;
    address?: string;
    tx?: string;
    soak: {
        url: string;
        query?: string;
    };
}
export interface ChainRow {
    name: ChainName;
    label: string;
    family: "solana" | "evm";
    v2DayOne: boolean;
    chainId?: number;
    cluster?: string;
    native: string;
    nativeName: string;
    floorAmmAddress?: string | null;
    rpcEnv: string;
    soak: {
        name?: string;
        chainId?: number;
        cluster?: string;
        rpcEnv: string;
    };
    explorer: ExplorerRow;
    quotes: readonly QuoteRow[];
}
export const CHAINS: readonly ChainRow[] = CHAIN_ROWS as unknown as readonly ChainRow[];
export function chainByName(name: string): ChainRow | undefined {
    return CHAINS.find((c) => c.name === name);
}
export function chainById(chainId: number, soak = false): ChainRow | undefined {
    return CHAINS.find((c) => c.family === "evm" && (soak ? c.soak.chainId : c.chainId) === chainId);
}
export function dayOneChains(): readonly ChainRow[] {
    return CHAINS.filter((c) => c.v2DayOne);
}
export function quotesOf(name: string, withDeferred = false): readonly QuoteRow[] {
    return (chainByName(name)?.quotes ?? []).filter((q) => withDeferred || !q.deferred);
}
export function findQuote(name: string, address: string): QuoteRow | undefined {
    const evm = chainByName(name)?.family === "evm";
    const a = evm ? address.toLowerCase() : address;
    return quotesOf(name, true).find((q) => (evm ? q.address.toLowerCase() : q.address) === a);
}
export function quoteDecimals(name: string, address: string): number {
    const q = findQuote(name, address);
    if (!q)
        throw new RangeError(`config: ${address} is not a quote on ${name}`);
    return q.decimals;
}
export function explorerUrl(name: string, kind: "address" | "tx", id: string, soak = false): string {
    const c = chainByName(name);
    if (!c)
        throw new RangeError(`config: unknown chain ${name}`);
    const e = c.explorer;
    const base = soak ? e.soak.url : e.url;
    const path = kind === "tx" ? (e.tx ?? "/tx/") : (e.address ?? "/address/");
    return `${base}${path}${id}${soak ? (e.soak.query ?? "") : ""}`;
}
