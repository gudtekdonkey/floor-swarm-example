import { WSOL_MINT } from "../solana/pda.ts";
import { EVM_NATIVE, NoRouteError, SOL_NATIVE, coinKey, quoteChain } from "./graph.ts";
import type { Pool, QuoteGraph } from "./graph.ts";
export type Hop = {
    kind: "edge";
    from: string;
    to: string;
} | {
    kind: "buy";
    pool: Pool;
} | {
    kind: "sell";
    pool: Pool;
};
export interface RoutePath {
    chain: "solana" | "evm";
    from: string;
    to: string;
    hops: Hop[];
}
export function findRoute(g: QuoteGraph, from: string, to: string): RoutePath {
    if (coinKey(from) === coinKey(to))
        throw new NoRouteError("Same", `${from} → itself`);
    const a = quoteChain(g, from);
    const b = quoteChain(g, to);
    const chain = (a.pools[0] ?? b.pools[0])?.chain;
    if (chain === undefined)
        throw new NoRouteError("NoFloorHop", `${from} → ${to} crosses no FLOOR pool`);
    if ([...a.pools, ...b.pools].some((x) => x.chain !== chain))
        throw new NoRouteError("Mixed", `${from} → ${to} mixes chains`);
    const coinsA = [from, ...a.pools.map((x) => x.quote)].map(coinKey);
    const coinsB = [to, ...b.pools.map((x) => x.quote)].map(coinKey);
    let ia = -1;
    let ib = -1;
    for (let i = 0; i < coinsA.length && ia < 0; i++) {
        const j = coinsB.indexOf(coinsA[i]);
        if (j >= 0)
            [ia, ib] = [i, j];
    }
    const hops: Hop[] = [];
    if (ia >= 0) {
        for (const pool of a.pools.slice(0, ia))
            hops.push({ kind: "sell", pool });
        for (const pool of b.pools.slice(0, ib).reverse())
            hops.push({ kind: "buy", pool });
    }
    else {
        for (const pool of a.pools)
            hops.push({ kind: "sell", pool });
        hops.push({ kind: "edge", from: a.base, to: b.base });
        for (const pool of [...b.pools].reverse())
            hops.push({ kind: "buy", pool });
    }
    if (!hops.some((h) => h.kind !== "edge"))
        throw new NoRouteError("NoFloorHop", `${from} → ${to} crosses no FLOOR pool`);
    return { chain, from, to, hops };
}
export function isWrapHop(h: Hop): boolean {
    return h.kind === "edge" && ((h.from === SOL_NATIVE && h.to === WSOL_MINT) || (h.from === WSOL_MINT && h.to === SOL_NATIVE));
}
export function hopIn(h: Hop): string {
    return h.kind === "edge" ? h.from : h.kind === "buy" ? h.pool.quote : h.pool.token;
}
export function hopOut(h: Hop): string {
    return h.kind === "edge" ? h.to : h.kind === "buy" ? h.pool.token : h.pool.quote;
}
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const KNOWN: Record<string, string> = { [SOL_NATIVE]: "SOL", [WSOL_MINT]: "wSOL", [USDC_SOLANA]: "USDC" };
export function describeRoute(path: RoutePath, names: Record<string, string> = {}, edgeName?: string): string {
    const byKey = new Map(Object.entries(names).map(([k, v]) => [coinKey(k), v]));
    const pools = new Map(path.hops.filter((h) => h.kind !== "edge").map((h) => [coinKey((h as {
            pool: Pool;
        }).pool.token), (h as {
            pool: Pool;
        }).pool]));
    const name = (c: string): string => {
        const n = byKey.get(coinKey(c));
        if (n !== undefined)
            return n;
        const p = pools.get(coinKey(c));
        if (p)
            return p.symbol.startsWith("$") ? p.symbol : `$${p.symbol}`;
        if (KNOWN[c])
            return KNOWN[c];
        if (path.chain === "evm" && coinKey(c) === EVM_NATIVE)
            return "native";
        return c.length > 10 ? `${c.slice(0, 4)}…${c.slice(-4)}` : c;
    };
    let s = name(path.from);
    for (const h of path.hops) {
        s += ` → ${name(hopOut(h))}`;
        if (h.kind === "edge")
            s += isWrapHop(h) ? (h.from === SOL_NATIVE ? " (wrap)" : " (unwrap)") : ` (${edgeName ?? (path.chain === "solana" ? "Jupiter" : "DEX")})`;
    }
    return s;
}
