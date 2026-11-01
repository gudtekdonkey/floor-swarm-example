import { MAX_WALK_STEPS, ckMoney, cloneBook } from "./book.ts";
import type { Book } from "./book.ts";
import { bestBidPriceX64V2, dexLiquidityV2, nextBuyPriceX64, stackViewV2 } from "./display.ts";
import type { LaunchStageV2 } from "./display.ts";
import { FEE_LEGS, LEG_BACKING, LEG_FLOOR, LEG_HOLDER, LEG_PLATFORM, LEG_TEAM, feeTotal } from "./fees.ts";
import { creatorLegsV2, platformLegsV2, splitMembersV2 } from "./team.ts";
import { bookBuy, bookSell } from "./trade.ts";
import type { BookBuy, BookSell } from "./trade.ts";
import { U64_MAX, U128_MAX } from "./wide.ts";
const PPM = 1000000n;
export interface PriceImpactV2 {
    spotX64: bigint;
    avgX64: bigint;
    ppm: bigint | null;
}
export function priceImpactV2(spotX64: bigint, money: bigint, tokens: bigint, side: "buy" | "sell"): PriceImpactV2 {
    const avgX64 = tokens > 0n ? (money << 64n) / tokens : 0n;
    let ppm: bigint | null = null;
    if (spotX64 > 0n && tokens > 0n) {
        const at = spotX64 * tokens;
        const d = side === "buy" ? (money << 64n) - at : at - (money << 64n);
        ppm = (d * PPM) / at;
    }
    return { spotX64, avgX64, ppm };
}
export interface TradeImpactV2 extends PriceImpactV2 {
    beforeX64: bigint;
    afterX64: bigint;
    dropPpm: bigint;
}
const dropOf = (before: bigint, after: bigint): bigint => (before === 0n ? 0n : ((before - after) * PPM) / before);
export function quoteBuyImpactV2(b: Book, gross: bigint, walkSteps: number = MAX_WALK_STEPS): {
    quote: BookBuy;
    impact: TradeImpactV2;
} {
    const beforeX64 = nextBuyPriceX64(b);
    const after = cloneBook(b);
    const quote = bookBuy(after, gross, 0n, walkSteps);
    const afterX64 = nextBuyPriceX64(after);
    return { quote, impact: { ...priceImpactV2(beforeX64, quote.net, quote.tokens, "buy"), beforeX64, afterX64, dropPpm: dropOf(beforeX64, afterX64) } };
}
export const SELL_FLAG_DROP_PPM = 100000n;
export interface SellImpactV2 extends TradeImpactV2 {
    circulating: bigint;
    shareOfCirculatingPpm: bigint | null;
    moneyBidding: bigint;
    shareOfBiddingPpm: bigint | null;
    cushion: bigint;
    stage: LaunchStageV2;
    outOfProportion: boolean;
}
export function quoteSellImpactV2(b: Book, tokens: bigint, circulating: bigint): {
    quote: BookSell;
    impact: SellImpactV2;
} {
    const beforeX64 = nextBuyPriceX64(b);
    const bid = bestBidPriceX64V2(b) ?? 0n;
    const after = cloneBook(b);
    const quote = bookSell(after, tokens, 0n);
    const afterX64 = nextBuyPriceX64(after);
    const filled = quote.tokensIn - quote.unfilled;
    const moneyBidding = dexLiquidityV2(b);
    const cushion = ckMoney(b);
    const stage = stackViewV2(b).stage;
    const dropPpm = dropOf(beforeX64, afterX64);
    const small = (circulating > 0n && filled * 100n <= circulating && dropPpm >= SELL_FLAG_DROP_PPM) || (quote.gross <= cushion && dropPpm > SELL_FLAG_DROP_PPM);
    return {
        quote,
        impact: {
            ...priceImpactV2(bid, quote.gross, filled, "sell"),
            beforeX64,
            afterX64,
            dropPpm,
            circulating,
            shareOfCirculatingPpm: circulating > 0n ? (filled * PPM) / circulating : null,
            moneyBidding,
            shareOfBiddingPpm: moneyBidding > 0n ? (quote.gross * PPM) / moneyBidding : null,
            cushion,
            stage,
            outOfProportion: stage === "stack" && small,
        },
    };
}
export const FEE_NAMES_V2: readonly string[] = ["Backing Fee", "Team Fee", "Platform fee", "$FLOOR fee", "Holder Fee"];
export interface FeePartsV2 {
    backing: bigint;
    backingKept: bigint;
    backingCut: bigint;
    team: bigint;
    teamCreatorRefs: bigint[];
    teamCreator: bigint;
    teamMembers: bigint[];
    teamDust: bigint;
    platform: bigint;
    platformTraderRefs: bigint[];
    platformBucket: bigint;
    floorToken: bigint;
    holder: bigint;
    total: bigint;
    parts: {
        name: string;
        amount: bigint;
    }[];
}
export interface FeePartsOpts {
    traderRefs?: readonly boolean[];
    creatorRefs?: readonly boolean[];
    slotWeights?: readonly number[];
}
export function feePartsV2(fees: readonly bigint[], opts: FeePartsOpts = {}): FeePartsV2 {
    if (fees.length !== FEE_LEGS)
        throw new RangeError(`fees: ${fees.length} legs, want ${FEE_LEGS}`);
    const none = [false, false, false];
    const team = fees[LEG_TEAM];
    const platform = fees[LEG_PLATFORM];
    const [teamCreatorRefs, teamRest] = creatorLegsV2(team, opts.creatorRefs ?? none);
    const [platformTraderRefs, platformBucket] = platformLegsV2(platform, opts.traderRefs ?? none);
    const w = opts.slotWeights;
    const split = w !== undefined && w.some((x) => x !== 0);
    const [teamMembers, teamDust] = split ? splitMembersV2(teamRest, w) : [Array(w?.length ?? 10).fill(0n) as bigint[], 0n];
    return {
        backing: fees[LEG_BACKING],
        backingKept: fees[LEG_BACKING],
        backingCut: 0n,
        team,
        teamCreatorRefs,
        teamCreator: split ? 0n : teamRest,
        teamMembers,
        teamDust,
        platform,
        platformTraderRefs,
        platformBucket,
        floorToken: fees[LEG_FLOOR],
        holder: fees[LEG_HOLDER],
        total: feeTotal(fees),
        parts: FEE_NAMES_V2.map((name, i) => ({ name, amount: fees[i] })),
    };
}
export interface MilestonePartsV2 {
    team: bigint;
    holder: bigint;
    platform: bigint;
    floorToken: bigint;
    total: bigint;
}
const partsOf = (p: readonly bigint[]): MilestonePartsV2 => ({
    team: p[0],
    holder: p[1],
    platform: p[2],
    floorToken: p[3],
    total: p[0] + p[1] + p[2] + p[3],
});
export interface BuyMilestonesV2 {
    booked: MilestonePartsV2;
    paid: MilestonePartsV2;
}
export function buyMilestonesV2(r: BookBuy): BuyMilestonesV2 {
    const booked = partsOf(r.split.booked);
    return { booked, paid: booked };
}
const EVM_TOKEN_SCALE = 1000000000000n;
export function maxLegV2(chain: "solana" | "evm", side: "buy" | "sell"): bigint {
    if (chain === "solana")
        return U64_MAX;
    return side === "buy" ? U128_MAX : U64_MAX * EVM_TOKEN_SCALE;
}
export function checkLegV2(amount: bigint, chain: "solana" | "evm", side: "buy" | "sell"): bigint {
    const max = maxLegV2(chain, side);
    if (amount < 1n || amount > max)
        throw new RangeError(`${chain} ${side}: ${amount} outside 1 ..= ${max}`);
    return amount;
}
