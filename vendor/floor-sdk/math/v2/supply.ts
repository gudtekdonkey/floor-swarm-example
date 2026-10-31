import { fail } from "../index.ts";
import { boughtBack, forSale } from "./book.ts";
import type { Book } from "./book.ts";
export interface Supply {
    live: bigint;
    dead: bigint;
}
export const sCirc = (b: Book, sup: Supply): bigint => circulatingV2(sup.live, 0n, forSale(b), boughtBack(b), sup.dead);
export function circulatingV2(minted: bigint, burned: bigint, forSale: bigint, boughtBack: bigint, dead: bigint): bigint {
    const s = minted - burned - forSale - boughtBack - dead;
    let x = minted;
    for (const y of [burned, forSale, boughtBack, dead]) {
        if (x < y)
            fail("Overflow");
        x -= y;
    }
    return s;
}
export function sBelow(s: bigint, xC: bigint, xK: bigint): bigint {
    const v = s - xC - xK;
    return v < 1n ? 1n : v;
}
