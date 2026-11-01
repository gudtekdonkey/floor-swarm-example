import { bytesToHex, checksumAddress, decodeAbi, encodeCall } from "../evm/abi.ts";
import { planEvmClaimAllV2 } from "./claims-evm.ts";
import { EVM_TOKEN_SCALE } from "./market-evm.ts";
import { evmSignature } from "../generated/index.ts";
import type { EvmClaimPlanV2, EvmLaunchOwedV2, EvmOwedReaderV2, EvmOwedV2, EvmQuoteOwedV2 } from "./claims-evm.ts";
export const MAX_LAUNCHES_PER_OWED_READ_V2 = 100;
export interface EvmLaunchOwedViewV2 extends EvmLaunchOwedV2 {
    token: string;
    unlockAt: bigint;
}
export interface EvmOwedViewV2 extends EvmOwedV2 {
    launches: EvmLaunchOwedViewV2[];
}
export interface EvmClaimsViewReaderV2 extends EvmOwedReaderV2 {
    owed(wallet: string, launchIds: readonly bigint[], quotes: readonly string[]): Promise<EvmOwedViewV2>;
}
const OWED_V2_SIG = evmSignature("owedV2");
const OWED_V2_LAUNCH_ROWS = "(uint256,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint64,uint256)[]";
const OWED_V2_QUOTE_ROWS = "(address,uint256,uint256,uint256,uint256,uint256)[]";
function owedCall(wallet: string, launchIds: readonly bigint[], quotes: readonly string[]): string {
    return bytesToHex(encodeCall(OWED_V2_SIG, [checksumAddress(wallet), [...launchIds], quotes.map((q) => checksumAddress(q))]));
}
function toMath(chain: bigint, what: string): bigint {
    if (chain % EVM_TOKEN_SCALE !== 0n)
        throw new RangeError(`owedV2.${what} ${chain} is not a whole math unit`);
    return chain / EVM_TOKEN_SCALE;
}
function decodeOwed(data: string | Uint8Array): EvmOwedViewV2 {
    const [ls, qs] = decodeAbi([OWED_V2_LAUNCH_ROWS, OWED_V2_QUOTE_ROWS], data) as [
        unknown[][],
        unknown[][]
    ];
    const n = (v: unknown): bigint => v as bigint;
    return {
        launches: ls.map((r) => ({
            launchId: n(r[0]),
            quote: checksumAddress(r[1] as string),
            token: checksumAddress(r[2] as string),
            creator: n(r[3]),
            creatorRef: n(r[4]),
            teamSlot: n(r[5]),
            holder: n(r[6]),
            teamBuy: toMath(n(r[7]), "teamBuy"),
            teamBuyLocked: toMath(n(r[8]), "teamBuyLocked"),
            shareBought: toMath(n(r[10]), "shareBought"),
            unlockAt: n(r[9]),
        })),
        quotes: qs.map((r) => ({ quote: checksumAddress(r[0] as string), creator: n(r[1]), creatorRef: n(r[2]), teamSlot: n(r[3]), traderRef: n(r[4]), payout: n(r[5]) })),
    };
}
export function evmOwedReaderOfClaimsViewV2(p: {
    floorAmm: string;
    ethCall: (to: string, data: string) => Promise<string>;
    maxLaunchesPerRead?: number;
}): EvmClaimsViewReaderV2 {
    const to = checksumAddress(p.floorAmm);
    const per = p.maxLaunchesPerRead ?? MAX_LAUNCHES_PER_OWED_READ_V2;
    if (!Number.isInteger(per) || per < 1)
        throw new RangeError("maxLaunchesPerRead must be \u2265 1");
    return {
        async owed(wallet, launchIds, quotes) {
            const out: EvmOwedViewV2 = { launches: [], quotes: [] };
            for (let i = 0; i === 0 || i < launchIds.length; i += per) {
                const ids = launchIds.slice(i, i + per);
                const qs = i === 0 ? quotes : [];
                const r = decodeOwed(await p.ethCall(to, owedCall(wallet, ids, qs)));
                if (r.launches.length !== ids.length || r.quotes.length !== qs.length)
                    throw new RangeError("owedV2: one row per launch and per quote");
                out.launches.push(...r.launches);
                out.quotes.push(...r.quotes);
            }
            return out;
        },
    };
}
export interface EvmClaimAllV2 extends EvmClaimPlanV2 {
    owed: EvmOwedViewV2;
}
export async function planEvmClaimAll(p: {
    floorAmm: string;
    wallet: string;
    launchIds: readonly bigint[];
    quotes: readonly string[];
    ethCall: (to: string, data: string) => Promise<string>;
    payoutTo?: string;
    maxQuotesPerCall?: number;
    maxLaunchesPerCall?: number;
    maxLaunchesPerRead?: number;
}): Promise<EvmClaimAllV2> {
    const reader = evmOwedReaderOfClaimsViewV2({ floorAmm: p.floorAmm, ethCall: p.ethCall, maxLaunchesPerRead: p.maxLaunchesPerRead });
    const owed = await reader.owed(p.wallet, p.launchIds, p.quotes);
    const plan = planEvmClaimAllV2({
        floorAmm: p.floorAmm,
        wallet: p.wallet,
        owed,
        payoutTo: p.payoutTo,
        maxQuotesPerCall: p.maxQuotesPerCall,
        maxLaunchesPerCall: p.maxLaunchesPerCall,
    });
    return { ...plan, owed };
}
