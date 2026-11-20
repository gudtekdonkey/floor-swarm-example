import { fail } from "../index.ts";
import { U128_MAX } from "./wide.ts";
import { Undo, cMoney, ckHeld, cloneBook, kMoney, fClaims, fOwn, feesAt, feesNow, MAX_WALK_STEPS, moneyHeld, tokensHeld, walkDownAcc, walkUpFrom, } from "./book.ts";
import type { Book } from "./book.ts";
import { FeeAcc, LEG_BACKING, cheaper, feeTotal, netFromGross } from "./fees.ts";
import { kpotUpgrade, relayPots } from "./relay.ts";
import type { Relay } from "./relay.ts";
import { split } from "./split.ts";
import type { Split, SplitRow } from "./split.ts";
import type { Sqrt } from "./sqrt.ts";
import { sCirc } from "./supply.ts";
import type { Supply } from "./supply.ts";
export interface BookBuy {
    gross: bigint;
    net: bigint;
    refund: bigint;
    tokens: bigint;
    fees: bigint[];
    fromResale: bigint;
    fromFirst: bigint;
    steps: number;
    budgetHit: boolean;
    graduatedNow: boolean;
    sqrtBefore: Sqrt;
    sqrtAfter: Sqrt;
    split: Split;
    relay: Relay;
}
export interface BookSell {
    tokensIn: bigint;
    unfilled: bigint;
    gross: bigint;
    fees: bigint[];
    out: bigint;
    steps: number;
    sqrtBefore: Sqrt;
    sqrtAfter: Sqrt;
    fromF: bigint;
    fromK: bigint;
    fromC: bigint;
    relay: Relay;
}
const noSplit = (): Split => ({ dF: 0n, ckAdd: 0n, ckTake: 0n, cAdd: 0n, kAdd: 0n, cTake: 0n, kTake: 0n, ms: 0n, booked: [0n, 0n, 0n, 0n], sqrtFNew: 0n });
const noRelay = (): Relay => ({ nC: 0, nK: 0, laidC: 0n, laidK: 0n, atF: 0n, kAtF: 0n, kept: 0 });
const add = (a: bigint, b: bigint): bigint => (a + b > U128_MAX ? fail("Overflow") : a + b);
function upgrade(b: Book, row: SplitRow, sup: Supply): void {
    if (b.kpot)
        return;
    kpotUpgrade(b, row, b.graduated ? sCirc(b, sup) : 0n);
}
function commit(dst: Book, src: Book): void {
    Object.assign(dst, src);
}
type Side = {
    row: SplitRow;
    sup: Supply;
} | null;
function buyOn(book: Book, side: Side, gross: bigint, minTokens: bigint, walkSteps: number, keep = true): BookBuy {
    const ppm = feesNow(book);
    const budget = netFromGross(gross, ppm);
    if (budget === 0n)
        fail("NothingToDo");
    const w = cloneBook(book);
    if (side !== null)
        upgrade(w, side.row, side.sup);
    const u = new Undo();
    const acc = new FeeAcc(ppm);
    let walked = walkUpFrom(w, budget, { money: 0n, tokens: 0n, fromResale: 0n, fromFirst: 0n, steps: 0, budgetHit: false, graduatedNow: false }, acc, walkSteps, u);
    const c = cheaper(ppm, feesAt(w, w.sqrtP));
    if (c.some((x, i) => x !== ppm[i]) && walked.tokens > 0n) {
        const spent = walked.money + feeTotal(acc.legs());
        if (spent > U128_MAX || spent > gross)
            fail("Overflow");
        const budget2 = netFromGross(gross - spent, c);
        if (budget2 > 0n)
            walked = walkUpFrom(w, budget2, walked, acc, walkSteps, u);
    }
    if (walked.tokens === 0n)
        fail(tokensHeld(w) === 0n ? "BookEmpty" : "NothingToDo");
    if (walked.tokens < minTokens)
        fail("SlippageExceeded");
    const fees = acc.legs();
    const paid = walked.money + feeTotal(fees);
    if (paid > U128_MAX || paid > gross)
        fail("Overflow");
    w.floor = add(w.floor, fees[LEG_BACKING]);
    let sp = noSplit();
    let rl = noRelay();
    if (w.graduated && side !== null) {
        const sNew = sCirc(w, side.sup);
        if (u.bought.length > 0) {
            sp = split(side.row, w.ranges.slice(0, w.nRanges), {
                sqrtF: w.sqrtF,
                sqrtP1: w.sqrtP,
                fTotal: fOwn(w),
                fClaims: fClaims(w),
                c0: cMoney(w),
                k0: kMoney(w),
                held: ckHeld(w),
                sNew,
            }, u.bought);
            w.floor = add(w.floor, sp.dF);
            w.sqrtF = sp.sqrtFNew;
        }
        rl = relayPots(w, side.row, { c: sp.cAdd, k: sp.kAdd }, { c: sp.cTake, k: sp.kTake }, sNew);
    }
    const r: BookBuy = {
        gross,
        net: walked.money,
        refund: gross - paid,
        tokens: walked.tokens,
        fees,
        fromResale: walked.fromResale,
        fromFirst: walked.fromFirst,
        steps: walked.steps,
        budgetHit: walked.budgetHit,
        graduatedNow: walked.graduatedNow,
        sqrtBefore: book.sqrtP,
        sqrtAfter: w.sqrtP,
        split: sp,
        relay: rl,
    };
    if (keep)
        commit(book, w);
    return r;
}
function sellOn(book: Book, side: Side, tokens: bigint, minOut: bigint, keep = true): BookSell {
    if (tokens === 0n)
        fail("NothingToDo");
    const w = cloneBook(book);
    if (side !== null)
        upgrade(w, side.row, side.sup);
    const ppm = feesNow(w);
    const acc = new FeeAcc(ppm);
    const walked = walkDownAcc(w, tokens, acc);
    const fees = acc.legs();
    const total = feeTotal(fees);
    if (walked.tokens === 0n || walked.money <= total)
        fail(walked.money === 0n && moneyHeld(w) === 0n ? "BookEmpty" : "NothingToDo");
    const out = walked.money - total;
    if (out < minOut)
        fail("SlippageExceeded");
    w.floor = add(w.floor, fees[LEG_BACKING]);
    const rl = w.graduated && side !== null ? relayPots(w, side.row, { c: 0n, k: 0n }, { c: 0n, k: 0n }, sCirc(w, side.sup)) : noRelay();
    const r: BookSell = {
        tokensIn: tokens,
        unfilled: tokens - walked.tokens,
        gross: walked.money,
        fees,
        out,
        steps: walked.steps,
        sqrtBefore: book.sqrtP,
        sqrtAfter: w.sqrtP,
        fromF: walked.fromF,
        fromK: walked.fromK,
        fromC: walked.fromC,
        relay: rl,
    };
    if (keep)
        commit(book, w);
    return r;
}
export function buy(book: Book, row: SplitRow, sup: Supply, gross: bigint, minTokens: bigint, opts: {
    walkSteps?: number;
} = {}): BookBuy {
    return buyOn(book, { row, sup }, gross, minTokens, opts.walkSteps ?? MAX_WALK_STEPS);
}
export function sell(book: Book, row: SplitRow, sup: Supply, tokens: bigint, minOut: bigint): BookSell {
    return sellOn(book, { row, sup }, tokens, minOut);
}
export const quoteBuy = (book: Book, row: SplitRow, sup: Supply, gross: bigint, walkSteps: number = MAX_WALK_STEPS): BookBuy => buyOn(book, { row, sup }, gross, 0n, walkSteps, false);
export const quoteSell = (book: Book, row: SplitRow, sup: Supply, tokens: bigint): BookSell => sellOn(book, { row, sup }, tokens, 0n, false);
export function buyMinTokens(b: Book, row: SplitRow, sup: Supply, gross: bigint, slippageBps: number, walkSteps: number = MAX_WALK_STEPS): bigint {
    const less = buyLessIn(gross, slippageBps);
    return slippageBps === 10000 ? 0n : buy(cloneBook(b), row, sup, less, 0n, { walkSteps }).tokens;
}
export function buyLessIn(gross: bigint, slippageBps: number): bigint {
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10000)
        fail("VaultShareOutOfRange");
    return (gross * BigInt(10000 - slippageBps)) / 10000n;
}
export function bookBuy(book: Book, gross: bigint, minTokens: bigint, walkSteps: number = MAX_WALK_STEPS): BookBuy {
    return buyOn(book, null, gross, minTokens, walkSteps);
}
export function bookSell(book: Book, tokens: bigint, minOut: bigint): BookSell {
    return sellOn(book, null, tokens, minOut);
}
export const quoteBookBuy = (book: Book, gross: bigint, walkSteps: number = MAX_WALK_STEPS): BookBuy => buyOn(book, null, gross, 0n, walkSteps, false);
export const quoteBookSell = (book: Book, tokens: bigint): BookSell => sellOn(book, null, tokens, 0n, false);
