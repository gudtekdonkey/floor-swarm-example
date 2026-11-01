import { addressBytes, base58Encode } from "./codec.ts";
import { encodeAccount } from "./solana/floor/accounts.ts";
import { TOKEN_PROGRAM_ID } from "./solana/pda.ts";
import { encodeAccountV2 } from "./v2/layouts.ts";
export function fixtureAddress(i: number): string {
    if (!Number.isInteger(i) || i < 0 || i > 65535)
        throw new RangeError(`fixture slot ${i}`);
    const b = new Uint8Array(32);
    b[0] = 240;
    b[1] = i & 255;
    b[2] = i >> 8;
    return base58Encode(b);
}
export function fixtureEvmAddress(i: number): string {
    if (!Number.isInteger(i) || i < 0 || i > 65535)
        throw new RangeError(`fixture slot ${i}`);
    return "0x" + "f0".padEnd(36, "0") + i.toString(16).padStart(4, "0");
}
export const fixtureKeys = () => ({
    launch: fixtureAddress(1),
    creator: fixtureAddress(2),
    wallet: fixtureAddress(3),
    quoteMint: fixtureAddress(4),
    baseMint: fixtureAddress(5),
    tokenVault: fixtureAddress(6),
    quoteVault: fixtureAddress(7),
    teamSlot: fixtureAddress(8),
});
export function launchV2Fixture(v: Record<string, unknown> = {}): {
    address: string;
    data: Uint8Array;
} {
    const k = fixtureKeys();
    return {
        address: k.launch,
        data: encodeAccountV2("LaunchV2", {
            createdAt: 1000n,
            creator: k.creator,
            quoteMint: k.quoteMint,
            quoteTokenProgram: TOKEN_PROGRAM_ID,
            baseMint: k.baseMint,
            tokenVault: k.tokenVault,
            quoteVault: k.quoteVault,
            creatorRef: [k.creator, k.creator, k.creator],
            ...v,
        }),
    };
}
export function teamSlotFixture(members: readonly {
    key: string;
    kind?: number;
    state?: number;
}[] = []): {
    address: string;
    data: Uint8Array;
} {
    const k = fixtureKeys();
    if (members.length > 10)
        throw new RangeError("a Team Slot holds at most 10 members");
    const ms = Array.from({ length: 10 }, (_, i) => ({ key: members[i] ? addressBytes(members[i].key) : new Uint8Array(32), kind: members[i]?.kind ?? 0, state: members[i] ? members[i].state ?? 2 : 0 }));
    return { address: k.teamSlot, data: encodeAccount("TeamSlot", { memberCount: members.length, flags: 1, launch: k.launch, creator: k.creator, members: ms }) };
}
export function holderPositionFixture(v: {
    amount?: bigint;
    owed?: bigint;
    indexSnap?: bigint;
} = {}): Uint8Array {
    const k = fixtureKeys();
    return encodeAccountV2("HolderPosition", { launch: k.launch, owner: k.wallet, amount: v.amount ?? 0n, indexSnap: v.indexSnap ?? 0n, owed: v.owed ?? 0n });
}
export function holderBookFixture(v: {
    index?: bigint;
    w?: bigint;
    carry?: bigint;
} = {}): Uint8Array {
    const k = fixtureKeys();
    return encodeAccountV2("HolderBook", { launch: k.launch, mint: k.baseMint, w: v.w ?? 0n, index: v.index ?? 0n, carry: v.carry ?? 0n, bookedTotal: 0n, paidTotal: 0n });
}
