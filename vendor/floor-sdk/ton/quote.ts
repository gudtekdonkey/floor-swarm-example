import { buyMinTokens, quoteBuy, quoteSell } from "../math/v2/trade.ts";
import type { BookBuy, BookSell } from "../math/v2/trade.ts";
import type { Book } from "../math/v2/book.ts";
import type { SplitRow } from "../math/v2/split.ts";
import type { Supply } from "../math/v2/supply.ts";
import { minOutAt } from "../v2/press.ts";
import { TON_WALK_STEPS } from "./types.ts";
import type { Cell } from "./cell.ts";
export interface TonLaunchView {
    book: Book;
    row: SplitRow;
    sup: Supply;
}
export type DecodeBook = (cell: Cell) => Book;
export interface TonBuyQuote {
    amountIn: bigint;
    tokens: bigint;
    minTokens: bigint;
    refund: bigint;
    budgetHit: boolean;
    steps: number;
    fees: bigint[];
    graduates: boolean;
    raw: BookBuy;
}
export interface TonSellQuote {
    tokensIn: bigint;
    out: bigint;
    minOut: bigint;
    unfilled: bigint;
    fees: bigint[];
    steps: number;
    raw: BookSell;
}
export function quoteBuyTon(v: TonLaunchView, amountIn: bigint, slippageBps: number): TonBuyQuote {
    const raw = quoteBuy(v.book, v.row, v.sup, amountIn, TON_WALK_STEPS);
    return {
        amountIn,
        tokens: raw.tokens,
        minTokens: buyMinTokens(v.book, v.row, v.sup, amountIn, slippageBps, TON_WALK_STEPS),
        refund: raw.refund,
        budgetHit: raw.budgetHit,
        steps: raw.steps,
        fees: raw.fees,
        graduates: raw.graduatedNow,
        raw,
    };
}
export function quoteSellTon(v: TonLaunchView, tokensIn: bigint, slippageBps: number): TonSellQuote {
    const raw = quoteSell(v.book, v.row, v.sup, tokensIn);
    return {
        tokensIn,
        out: raw.out,
        minOut: raw.out > 0n ? minOutAt(raw.out, slippageBps) : 0n,
        unfilled: raw.unfilled,
        fees: raw.fees,
        steps: raw.steps,
        raw,
    };
}
export function quoteBuyFromCell(decode: DecodeBook, bookCell: Cell, row: SplitRow, sup: Supply, amountIn: bigint, slippageBps: number): TonBuyQuote {
    return quoteBuyTon({ book: decode(bookCell), row, sup }, amountIn, slippageBps);
}
