import { decodeEvmLogs, decodeSolanaEventCpi } from "../events/index.ts";
import type { EvmEvent, FloorEvent, SolanaEvent } from "../events/index.ts";
import type { Log } from "../evm/items.ts";
import type { FeeLegs, FloorFamily } from "../client/types.ts";
import { base58Decode } from "../codec.ts";
import { FLOOR_AMM_PROGRAM_ID } from "../solana/floor/program.ts";
export interface EvmLandedTx {
    logs: readonly Log[];
}
export interface SolanaLandedTx {
    innerInstructions: readonly {
        programId: string;
        data: Uint8Array | string;
    }[];
}
export type LandedTx = EvmLandedTx | SolanaLandedTx;
export interface ReceiptScope {
    floorAmm?: string | readonly string[];
    programId?: string;
}
const isEvm = (t: LandedTx): t is EvmLandedTx => "logs" in t;
const same = (chain: FloorFamily, a: string, b: string): boolean => (chain === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b);
export function eventsOf(landed: LandedTx, scope: ReceiptScope = {}): FloorEvent[] {
    if (isEvm(landed)) {
        const from = scope.floorAmm === undefined ? undefined : typeof scope.floorAmm === "string" ? [scope.floorAmm] : scope.floorAmm;
        return decodeEvmLogs(landed.logs, from);
    }
    const pid = scope.programId ?? FLOOR_AMM_PROGRAM_ID;
    const out: SolanaEvent[] = [];
    for (const ix of landed.innerInstructions) {
        if (ix.programId !== pid)
            continue;
        const e = decodeSolanaEventCpi(typeof ix.data === "string" ? base58Decode(ix.data) : ix.data);
        if (e)
            out.push(e);
    }
    return out;
}
const launchOf = (e: FloorEvent): string => (e.chain === "evm" ? String((e.fields as {
    launchId: bigint;
}).launchId) : (e.fields as {
    launch: string;
}).launch);
const launchKey = (l: string | bigint | undefined): string | undefined => (l === undefined ? undefined : String(l));
const pick = <N extends string>(es: FloorEvent[], name: N): Extract<FloorEvent, {
    name: N;
}>[] => es.filter((e): e is Extract<FloorEvent, {
    name: N;
}> => e.name === name);
export interface ReceiptFill {
    family: FloorFamily;
    side: "buy" | "sell";
    launch: string;
    trader: string;
    recipient: string;
    amountIn: bigint;
    amountOut: bigint;
    refund: bigint;
    quoteGross: bigint;
    quoteNet: bigint;
    fees: FeeLegs;
    kind: number;
    sqrtBefore: bigint;
    sqrtAfter: bigint;
}
export function fillOf(side: "buy" | "sell", landed: LandedTx, p: {
    trader?: string;
    launch?: string | bigint;
} & ReceiptScope = {}): ReceiptFill | null {
    const want = launchKey(p.launch);
    for (const e of pick(eventsOf(landed, p), "Trade")) {
        const f = e.fields;
        if (f.isBuy !== (side === "buy"))
            continue;
        if (p.trader !== undefined && !same(e.chain, f.trader, p.trader))
            continue;
        const launch = launchOf(e);
        if (want !== undefined && launch !== want)
            continue;
        const [backing, team, platform, floor, holder] = f.fees;
        return {
            family: e.chain,
            side,
            launch,
            trader: f.trader,
            recipient: f.recipient,
            amountIn: f.isBuy ? f.quoteGross - f.refund : f.tokens,
            amountOut: f.isBuy ? f.tokens : f.quoteNet,
            refund: f.isBuy ? f.refund : f.unfilled,
            quoteGross: f.quoteGross,
            quoteNet: f.quoteNet,
            fees: { backing, team, platform, floor, holder, total: backing + team + platform + floor + holder },
            kind: Number(f.kind),
            sqrtBefore: f.sqrtBefore,
            sqrtAfter: f.sqrtAfter,
        };
    }
    return null;
}
export interface ReceiptClaimed {
    quote: string;
    launch: string | null;
    types: number;
    creator: bigint;
    creatorRef: bigint;
    teamSlot: bigint;
    traderRef: bigint;
    holder: bigint;
    extra: bigint;
    amount: bigint;
}
export interface ReceiptPayout {
    quote: string;
    to: string;
    amount: bigint;
}
export interface ReceiptTokensPaid {
    launch: string;
    kind: "teamBuy" | "shareBought" | "teamBuyUnlocked";
    tokens: bigint;
}
export interface ReceiptPaid {
    claims: ReceiptClaimed[];
    payouts: ReceiptPayout[];
    tokens: ReceiptTokensPaid[];
    byQuote: Record<string, bigint>;
    tokensTotal: bigint;
}
export function paidOf(landed: LandedTx, p: {
    wallet: string;
} & ReceiptScope): ReceiptPaid {
    const out: ReceiptPaid = { claims: [], payouts: [], tokens: [], byQuote: {}, tokensTotal: 0n };
    const add = (q: string, a: bigint) => {
        out.byQuote[q] = (out.byQuote[q] ?? 0n) + a;
    };
    const tok = (launch: string, kind: ReceiptTokensPaid["kind"], tokens: bigint | null) => {
        if (tokens === null || tokens === 0n)
            return;
        out.tokens.push({ launch, kind, tokens });
        out.tokensTotal += tokens;
    };
    for (const e of eventsOf(landed, p)) {
        if (e.chain === "solana") {
            if (e.name === "Claimed" && e.fields.wallet === p.wallet) {
                const f = e.fields;
                out.claims.push({
                    quote: f.quoteMint,
                    launch: f.launch,
                    types: f.types | ((f.typesHi ?? 0) << 8),
                    creator: f.creator,
                    creatorRef: f.creatorRef,
                    teamSlot: f.teamSlot,
                    traderRef: f.traderRef,
                    holder: 0n,
                    extra: f.extra,
                    amount: f.amount,
                });
                add(f.quoteMint, f.amount);
                tok(f.launch, "teamBuy", f.teamBuy);
                tok(f.launch, "shareBought", f.shareBought);
            }
            else if (e.name === "CreatorBuyUnlocked" && e.fields.creator === p.wallet)
                tok(e.fields.launch, "teamBuyUnlocked", e.fields.paid ?? e.fields.tokens);
            continue;
        }
        evmPaid(e, p.wallet, out, add, tok);
    }
    return out;
}
function evmPaid(e: EvmEvent, wallet: string, out: ReceiptPaid, add: (q: string, a: bigint) => void, tok: (l: string, k: ReceiptTokensPaid["kind"], t: bigint) => void): void {
    switch (e.name) {
        case "Claimed": {
            const f = e.fields;
            if (!same("evm", f.wallet, wallet))
                return;
            out.claims.push({ quote: f.quote, launch: null, types: Number(f.types), creator: f.creator, creatorRef: f.creatorRef, teamSlot: f.teamSlot, traderRef: f.traderRef, holder: f.holder, extra: f.extra, amount: f.amount });
            add(f.quote, f.amount);
            return;
        }
        case "PayoutClaimed":
            if (!same("evm", e.fields.wallet, wallet))
                return;
            out.payouts.push({ quote: e.fields.quote, to: e.fields.to, amount: e.fields.amount });
            add(e.fields.quote, e.fields.amount);
            return;
        case "TeamBuyClaimed":
            if (same("evm", e.fields.wallet, wallet))
                tok(String(e.fields.launchId), "teamBuy", e.fields.tokens);
            return;
        case "TeamShareBoughtClaimed":
            if (same("evm", e.fields.wallet, wallet))
                tok(String(e.fields.launchId), "shareBought", e.fields.tokens);
            return;
        case "CreatorBuyUnlocked":
            if (same("evm", e.fields.creator, wallet))
                tok(String(e.fields.launchId), "teamBuyUnlocked", e.fields.paid);
            return;
    }
}
export interface ReceiptCreated {
    family: FloorFamily;
    launch: string;
    launchId: bigint;
    token: string;
    quote: string;
    creator: string;
    presetId: number;
    creatorBuyTokens: bigint;
    createFee: bigint;
    nativeCreateFee: bigint;
    name: string;
    symbol: string;
    listed: boolean;
}
const text = (b: Uint8Array): string => {
    let n = b.length;
    while (n > 0 && b[n - 1] === 0)
        n--;
    return new TextDecoder().decode(b.slice(0, n));
};
export function createdOf(landed: LandedTx, scope: ReceiptScope = {}): ReceiptCreated | null {
    for (const e of eventsOf(landed, scope)) {
        if (e.chain === "solana" && (e.name === "LaunchCreatedV2" || e.name === "LaunchCreated")) {
            const f = e.fields;
            return {
                family: "solana",
                launch: f.launch,
                launchId: f.id,
                token: f.mint,
                quote: f.quoteMint,
                creator: f.creator,
                presetId: f.presetId,
                creatorBuyTokens: f.creatorBuyTokens,
                createFee: f.createFee,
                nativeCreateFee: f.nativeCreateFee,
                name: text(f.name),
                symbol: text(f.symbol),
                listed: f.listed,
            };
        }
        if (e.chain === "evm" && e.name === "LaunchCreated") {
            const f = e.fields;
            return {
                family: "evm",
                launch: String(f.launchId),
                launchId: f.launchId,
                token: f.token,
                quote: f.quote,
                creator: f.creator,
                presetId: Number(f.presetId),
                creatorBuyTokens: f.creatorBuyTokens,
                createFee: f.createFee,
                nativeCreateFee: f.nativeCreateFee,
                name: f.name,
                symbol: f.symbol,
                listed: f.listed,
            };
        }
    }
    return null;
}
export interface ReceiptBurned {
    launch: string;
    fromTeamBuy: bigint;
    fromWallet: bigint;
    fromShareBought: bigint;
    total: bigint;
    supply: bigint;
    sOut: bigint;
    floorAfterX64: bigint;
}
export function burnedOf(landed: LandedTx, p: {
    wallet: string;
} & ReceiptScope): ReceiptBurned[] {
    const out: ReceiptBurned[] = [];
    for (const e of eventsOf(landed, p)) {
        if (!((e.chain === "solana" && e.name === "TokensBurned") || (e.chain === "evm" && e.name === "TokensBurnedV2")))
            continue;
        const f = e.fields as {
            wallet: string;
            fromTeamBuy: bigint;
            fromWallet: bigint;
            fromShareBought: bigint | null;
            supply: bigint;
            sOut: bigint;
            floorAfterX64: bigint;
        };
        if (!same(e.chain, f.wallet, p.wallet))
            continue;
        const share = f.fromShareBought ?? 0n;
        out.push({
            launch: launchOf(e),
            fromTeamBuy: f.fromTeamBuy,
            fromWallet: f.fromWallet,
            fromShareBought: share,
            total: f.fromTeamBuy + f.fromWallet + share,
            supply: f.supply,
            sOut: f.sOut,
            floorAfterX64: f.floorAfterX64,
        });
    }
    return out;
}
