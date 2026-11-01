import { circulatingV2 } from "../math/v2/supply.ts";
export interface CirculatingParts {
    live: bigint;
    forSale: bigint;
    heldByBid: bigint;
    dead: bigint;
}
export function circulating(p: CirculatingParts): bigint {
    try {
        return circulatingV2(p.live, 0n, p.forSale, p.heldByBid, p.dead);
    }
    catch (e) {
        throw new RangeError("Overflow", { cause: e });
    }
}
