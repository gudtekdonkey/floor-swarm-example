import { WSOL_MINT } from "./solana/pda.ts";
import { SOL_NATIVE } from "./route/graph.ts";
import { isWrapHop } from "./route/path.ts";
import type { EdgeQuoter, RouteQuote } from "./route/quote.ts";
import { jupiterSwapInstructionsBody } from "./route/edge-jupiter.ts";
import type { JupiterQuote } from "./route/edge-jupiter.ts";
export const JUPITER_API = "https://lite-api.jup.ag/swap/v1";
export function jupiterQuoteUrl(p: {
    quoteMint: string;
    lamports: bigint;
    slippageBps: number;
    api?: string;
    inputMint?: string;
}): string {
    if (p.lamports <= 0n)
        throw new RangeError("lamports must be > 0");
    if (!Number.isInteger(p.slippageBps) || p.slippageBps < 0 || p.slippageBps > 10000)
        throw new RangeError("slippageBps in 0..10,000");
    const q = new URLSearchParams({ inputMint: p.inputMint ?? WSOL_MINT, outputMint: p.quoteMint, amount: p.lamports.toString(), slippageBps: String(p.slippageBps), swapMode: "ExactIn" });
    return `${p.api ?? JUPITER_API}/quote?${q.toString()}`;
}
const jupMint = (c: string): string => (c === SOL_NATIVE ? WSOL_MINT : c);
export function jupiterEdgeQuoter(fetchJson: (url: string) => Promise<unknown>, opts: {
    api?: string;
} = {}): EdgeQuoter {
    return async ({ from, to, amountIn, slippageBps }) => {
        const raw = (await fetchJson(jupiterQuoteUrl({ inputMint: jupMint(from), quoteMint: jupMint(to), lamports: amountIn, slippageBps, api: opts.api }))) as JupiterQuote;
        return { inAmount: BigInt(raw.inAmount), outAmount: BigInt(raw.outAmount), minOut: BigInt(raw.otherAmountThreshold), raw };
    };
}
export function jupiterSwapRequests(q: RouteQuote, trader: string, opts: {
    api?: string;
} = {}): {
    hop: number;
    url: string;
    body: string;
}[] {
    const out: {
        hop: number;
        url: string;
        body: string;
    }[] = [];
    q.hops.forEach((h, i) => {
        if (h.hop.kind !== "edge" || isWrapHop(h.hop))
            return;
        if (!h.edge)
            throw new RangeError(`hop ${i} has no edge quote`);
        out.push({ hop: i, url: `${opts.api ?? JUPITER_API}/swap-instructions`, body: jupiterSwapInstructionsBody({ quote: h.edge.raw as JupiterQuote, trader }) });
    });
    return out;
}
