import { encodeFunctionData } from "./items.ts";
import { deadlineArg } from "./floor/calls.ts";
import { EVM_NATIVE, NoRouteError, coinKey } from "../route/graph.ts";
import { chainById } from "./chains.ts";
import type { Pool } from "../route/graph.ts";
import type { HopQuote, RouteQuote } from "../route/quote.ts";
const BUY = [
    { name: "path", type: "uint256[]" },
    { name: "tokenIn", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "swapData", type: "bytes" },
    { name: "minQuoteIn", type: "uint256" },
    { name: "minTokensOut", type: "uint256[]" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
] as const;
const SELL = [
    { name: "path", type: "uint256[]" },
    { name: "tokensIn", type: "uint256" },
    { name: "minQuoteOut", type: "uint256[]" },
    { name: "tokenOut", type: "address" },
    { name: "swapIn", type: "uint256" },
    { name: "swapData", type: "bytes" },
    { name: "minOut", type: "uint256" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
] as const;
const buyArg = (name: string) => ({ name, type: "tuple", internalType: "struct IFloorRouter.Buy", components: BUY }) as const;
const sellArg = (name: string) => ({ name, type: "tuple", internalType: "struct IFloorRouter.Sell", components: SELL }) as const;
const err = (name: string, inputs: readonly {
    name: string;
    type: string;
}[] = []) => ({ type: "error", name, inputs }) as const;
const SELL_OUT = [{ name: "amountOut", type: "uint256" }, { name: "quoteOut", type: "uint256" }] as const;
export const FLOOR_ROUTER_ABI = [
    { type: "function", name: "floorAmm", inputs: [], outputs: [{ name: "", type: "address", internalType: "contract IFloorAmm" }], stateMutability: "view" },
    { type: "function", name: "router", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
    { type: "function", name: "sell", inputs: [sellArg("s")], outputs: SELL_OUT, stateMutability: "nonpayable" },
    {
        type: "function",
        name: "sellWithPermit",
        inputs: [sellArg("s"), { name: "permitDeadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "ss", type: "bytes32" }],
        outputs: SELL_OUT,
        stateMutability: "nonpayable",
    },
    {
        type: "event",
        name: "Sold",
        anonymous: false,
        inputs: [
            { name: "sender", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "launchId", type: "uint256", indexed: true },
            { name: "tokensIn", type: "uint256", indexed: false },
            { name: "hops", type: "uint256", indexed: false },
            { name: "tokenOut", type: "address", indexed: false },
            { name: "quoteOut", type: "uint256", indexed: false },
            { name: "amountOut", type: "uint256", indexed: false },
            { name: "refundQuote", type: "uint256", indexed: false },
        ],
    },
    {
        type: "event",
        name: "Bought",
        anonymous: false,
        inputs: [
            { name: "sender", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "launchId", type: "uint256", indexed: true },
            { name: "tokenIn", type: "address", indexed: false },
            { name: "amountIn", type: "uint256", indexed: false },
            { name: "hops", type: "uint256", indexed: false },
            { name: "quoteIn", type: "uint256", indexed: false },
            { name: "tokensOut", type: "uint256", indexed: false },
            { name: "refundIn", type: "uint256", indexed: false },
        ],
    },
    err("NotRouter"),
    err("SwapFailed", [{ name: "reason", type: "bytes" }]),
    err("SwapDataNotEmpty"),
    err("BadPath"),
    err("QuoteShort"),
    err("SlippageExceeded"),
    err("Expired"),
    err("BadValue"),
    err("Reentrancy"),
    { type: "function", name: "buy", inputs: [buyArg("b")], outputs: [{ name: "tokensOut", type: "uint256" }, { name: "quoteIn", type: "uint256" }], stateMutability: "payable" },
    { type: "function", name: "swap", inputs: [sellArg("s"), buyArg("b")], outputs: [{ name: "tokensOut", type: "uint256" }], stateMutability: "nonpayable" },
] as const;
export const SWAP_IN_ALL = (1n << 256n) - 1n;
export interface RouterBuy {
    path: bigint[];
    tokenIn: string;
    amountIn: bigint;
    swapData: string;
    minQuoteIn: bigint;
    minTokensOut: bigint[];
    to: string;
    deadline: bigint;
}
export interface RouterSell {
    path: bigint[];
    tokensIn: bigint;
    minQuoteOut: bigint[];
    tokenOut: string;
    swapIn: bigint;
    swapData: string;
    minOut: bigint;
    to: string;
    deadline: bigint;
}
export function checkFloorHops(chainId: unknown, floorHops: number): void {
    if (typeof chainId !== "number" || !Number.isInteger(chainId))
        throw new RangeError("an EVM route names its chainId");
    const row = chainById(chainId);
    if (row?.maxFloorHops !== undefined && floorHops > row.maxFloorHops) {
        throw new NoRouteError("TooManyHops", `${floorHops} FLOOR trades: ${row.name} (chain ${row.chainId}) carries at most ${row.maxFloorHops} per route`);
    }
}
const checkPath = (path: bigint[], mins: bigint[]): void => {
    if (path.length === 0)
        throw new RangeError("BadPath: an empty path");
    if (mins.length !== path.length)
        throw new RangeError("BadPath: one min-out a hop");
};
export function encodeRouterBuy(b: RouterBuy, chainId: number): string {
    checkPath(b.path, b.minTokensOut);
    checkFloorHops(chainId, b.path.length);
    return encodeFunctionData(FLOOR_ROUTER_ABI, "buy", { b });
}
export function encodeRouterSell(s: RouterSell, chainId: number): string {
    checkPath(s.path, s.minQuoteOut);
    checkFloorHops(chainId, s.path.length);
    if (s.tokensIn === 0n || coinKey(s.to) === EVM_NATIVE)
        throw new RangeError("BadValue: tokensIn > 0 and a recipient");
    return encodeFunctionData(FLOOR_ROUTER_ABI, "sell", { s });
}
export function encodeRouterSellWithPermit(s: RouterSell, permit: {
    deadline: bigint;
    v: number;
    r: string;
    s: string;
}, chainId: number): string {
    checkPath(s.path, s.minQuoteOut);
    checkFloorHops(chainId, s.path.length);
    if (s.tokensIn === 0n || coinKey(s.to) === EVM_NATIVE)
        throw new RangeError("BadValue: tokensIn > 0 and a recipient");
    return encodeFunctionData(FLOOR_ROUTER_ABI, "sellWithPermit", { s, permitDeadline: permit.deadline, v: BigInt(permit.v), r: permit.r, ss: permit.s });
}
export function encodeRouterSwap(s: RouterSell, b: RouterBuy, chainId: number): string {
    checkPath(s.path, s.minQuoteOut);
    checkPath(b.path, b.minTokensOut);
    checkFloorHops(chainId, s.path.length + b.path.length);
    if (coinKey(b.tokenIn) !== coinKey(s.tokenOut) || b.amountIn !== 0n)
        throw new RangeError("BadPath: swap's buy takes the sell's output (b.tokenIn = s.tokenOut, b.amountIn = 0)");
    return encodeFunctionData(FLOOR_ROUTER_ABI, "swap", { s, b });
}
const idOf = (pool: Pool): bigint => {
    if (pool.launchId === undefined)
        throw new RangeError(`pool ${pool.symbol}: an EVM pool needs its launchId`);
    return pool.launchId;
};
export function evmRouteCall(q: RouteQuote, p: {
    router: string;
    to: string;
    deadline: bigint;
    chainId: number;
    swapData?: string[];
}): {
    to: string;
    data: string;
    value: bigint;
    gas?: bigint;
} {
    if (q.path.chain !== "evm")
        throw new RangeError("evmRouteCall builds EVM routes; Solana routes are `routeInstructions`");
    checkFloorHops(p.chainId, q.hops.filter((h) => h.hop.kind !== "edge").length);
    deadlineArg(p.deadline);
    const hs = q.hops;
    const sells = hs.filter((h) => h.hop.kind === "sell");
    const buys = hs.filter((h) => h.hop.kind === "buy");
    const edges = hs.filter((h) => h.hop.kind === "edge");
    if (edges.length > 1)
        throw new RangeError("BadPath: one edge leg a route");
    const sd = p.swapData ?? [];
    if (sd.length !== edges.length)
        throw new RangeError(`the route has ${edges.length} edge leg(s): pass ${edges.length} swapData`);
    const edge = edges[0] as (HopQuote & {
        hop: {
            kind: "edge";
            from: string;
            to: string;
        };
    }) | undefined;
    const pool = (h: HopQuote): Pool => (h.hop as {
        pool: Pool;
    }).pool;
    const ids = (xs: HopQuote[]): bigint[] => xs.map((h) => idOf(pool(h)));
    const mins = (xs: HopQuote[]): bigint[] => xs.map((h) => h.minOut);
    const gas = hs.every((h) => h.gas !== undefined) ? hs.reduce((n, h) => n + (h.gas as bigint), 0n) : undefined;
    const call = (data: string, value: bigint) => ({ to: p.router, data, value, ...(gas !== undefined ? { gas } : {}) });
    if (sells.length === 0) {
        const base = pool(buys[0]).quote;
        const tokenIn = edge ? edge.hop.from : base;
        const native = coinKey(tokenIn) === EVM_NATIVE;
        const r: RouterBuy = { path: ids(buys), tokenIn, amountIn: native ? 0n : q.amountIn, swapData: edge ? sd[0] : "0x", minQuoteIn: edge ? edge.minOut : 0n, minTokensOut: mins(buys), to: p.to, deadline: p.deadline };
        return call(encodeRouterBuy(r, p.chainId), native ? q.amountIn : 0n);
    }
    const last = sells[sells.length - 1];
    const s: RouterSell = {
        path: ids(sells),
        tokensIn: q.amountIn,
        minQuoteOut: mins(sells),
        tokenOut: edge ? edge.hop.to : pool(last).quote,
        swapIn: edge ? edge.amountIn : 0n,
        swapData: edge ? sd[0] : "0x",
        minOut: edge ? edge.minOut : last.minOut,
        to: buys.length ? EVM_NATIVE : p.to,
        deadline: p.deadline,
    };
    if (buys.length === 0)
        return call(encodeRouterSell(s, p.chainId), 0n);
    const b: RouterBuy = { path: ids(buys), tokenIn: s.tokenOut, amountIn: 0n, swapData: "0x", minQuoteIn: 0n, minTokensOut: mins(buys), to: p.to, deadline: p.deadline };
    return call(encodeRouterSwap(s, b, p.chainId), 0n);
}
