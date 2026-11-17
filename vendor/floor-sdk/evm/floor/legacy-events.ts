import type { AbiItem } from "../items.ts";
export const LEGACY_CLAIMED_SIGNATURE = "Claimed(address,address,address,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256)";
export const LEGACY_CLAIMED_TOPIC = "0x586c69c7198e9e5c48c058d0267bd1388a73f9a8878aeb9d72d25331acc39aeb";
export const LEGACY_EVENTS: readonly AbiItem[] = [
    {
        type: "event",
        name: "Claimed",
        anonymous: false,
        inputs: [
            { name: "wallet", type: "address", indexed: true },
            { name: "sender", type: "address", indexed: true },
            { name: "quote", type: "address", indexed: true },
            { name: "types", type: "uint8", indexed: false },
            { name: "creator", type: "uint256", indexed: false },
            { name: "creatorRef", type: "uint256", indexed: false },
            { name: "teamSlot", type: "uint256", indexed: false },
            { name: "traderRef", type: "uint256", indexed: false },
            { name: "holder", type: "uint256", indexed: false },
            { name: "extra", type: "uint256", indexed: false },
            { name: "amount", type: "uint256", indexed: false },
        ],
    },
];
export const CLAIM_HOLDER_BIT = 512n;
export function normalizeLegacyClaimed(args: Record<string, any>): Record<string, any> {
    const types = BigInt(args.types);
    return { ...args, types: BigInt(args.holder) > 0n ? types | CLAIM_HOLDER_BIT : types };
}
