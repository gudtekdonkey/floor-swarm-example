export const SOL_NATIVE = "SOL";
export const EVM_NATIVE = "0x0000000000000000000000000000000000000000";
export interface Pool {
    chain: "solana" | "evm";
    token: string;
    quote: string;
    quoteTokenProgram?: string;
    launchId?: bigint;
    state: unknown;
    symbol: string;
    referred?: boolean;
    linked?: boolean;
    snipeSpan?: boolean;
}
export interface QuoteGraph {
    pools: Map<string, Pool>;
    edge: Set<string>;
}
export type NoRouteReason = "Same" | "NoFloorHop" | "QuoteCycle" | "Mixed" | "TooManyHops";
export class NoRouteError extends Error {
    readonly reason: NoRouteReason;
    constructor(reason: NoRouteReason, detail: string) {
        super(`NoRoute (${reason}): ${detail}`);
        this.name = "NoRouteError";
        this.reason = reason;
    }
}
export const coinKey = (a: string): string => (a.startsWith("0x") ? a.toLowerCase() : a);
export const MAX_QUOTE_CHAIN = 8;
export async function quoteGraph(p: {
    chain: "solana" | "evm";
    tokens: string[];
    edge: string[];
    readPool: (token: string) => Promise<Pool | null>;
}): Promise<QuoteGraph> {
    const g: QuoteGraph = { pools: new Map(), edge: new Set(p.edge.map(coinKey)) };
    const seen = new Set<string>();
    for (const t of p.tokens) {
        let coin = t;
        for (let depth = 0;; depth++) {
            const k = coinKey(coin);
            if (g.edge.has(k) || seen.has(k))
                break;
            if (depth > MAX_QUOTE_CHAIN)
                throw new NoRouteError("QuoteCycle", `${t}'s quote chain passes ${MAX_QUOTE_CHAIN} pools`);
            seen.add(k);
            const pool = await p.readPool(coin);
            if (pool === null)
                break;
            if (pool.chain !== p.chain)
                throw new NoRouteError("Mixed", `${coin} is a ${pool.chain} launch on a ${p.chain} graph`);
            g.pools.set(k, pool);
            coin = pool.quote;
        }
    }
    return g;
}
export function quoteChain(g: QuoteGraph, token: string): {
    pools: Pool[];
    base: string;
} {
    const pools: Pool[] = [];
    let coin = token;
    for (;;) {
        const k = coinKey(coin);
        const pool = g.edge.has(k) ? undefined : g.pools.get(k);
        if (!pool)
            return { pools, base: coin };
        if (pools.length >= MAX_QUOTE_CHAIN || pools.includes(pool))
            throw new NoRouteError("QuoteCycle", `${token}'s quote chain does not end`);
        pools.push(pool);
        coin = pool.quote;
    }
}
