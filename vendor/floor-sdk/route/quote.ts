import { hopIn } from "./path.ts";
import type { Hop, RoutePath } from "./path.ts";
export interface EdgeQuote {
    inAmount: bigint;
    outAmount: bigint;
    minOut: bigint;
    raw: unknown;
}
export type EdgeQuoter = (req: {
    from: string;
    to: string;
    amountIn: bigint;
    slippageBps: number;
}) => Promise<EdgeQuote>;
export type HopStage = "window" | "schedule" | "budget" | "after-end" | "sell" | "edge" | "wrap";
export interface HopQuote {
    hop: Hop;
    amountIn: bigint;
    amountOut: bigint;
    minOut: bigint;
    computeUnits?: number;
    gas?: bigint;
    stage?: HopStage;
    impactBps?: number;
    edge?: EdgeQuote;
}
export interface RouteQuote {
    path: RoutePath;
    amountIn: bigint;
    amountOut: bigint;
    minOut: bigint;
    hops: HopQuote[];
    slippageBps: number;
    surplus?: {
        coin: string;
        expected: bigint;
    };
}
export function routeInputs(q: RouteQuote): string[] {
    return q.path.hops.map(hopIn);
}
