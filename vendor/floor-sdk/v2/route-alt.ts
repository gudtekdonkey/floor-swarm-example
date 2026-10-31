import { addressBytes, concatBytes } from "../codec.ts";
import { coinKey } from "../route/graph.ts";
import { AccountRole } from "../solana/instruction.ts";
import type { Instruction } from "../solana/instruction.ts";
import { ADDRESS_LOOKUP_TABLE_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, findProgramAddress } from "../solana/pda.ts";
import { createAssociatedTokenAccountIdempotentInstruction } from "../solana/tx.ts";
import { FLOOR_AMM_PROGRAM_ID } from "../solana/floor/program.ts";
import { ATA_CREATE_CU, routeTradeAccountsV2 } from "./route.ts";
import type { HopQuoteV2, PoolV2, RouteQuoteV2 } from "./route.ts";
import { buyFromBalanceInstructionV2, buyInstructionV2, openHolderPositionInstruction, sellFromBalanceInstructionV2, sellInstructionV2 } from "./solana.ts";
export const MAX_TABLE_ADDRESSES_V2 = 256;
export const MAX_EXTEND_ADDRESSES_V2 = 30;
const PROBES = ["kVwEj4fW3BriC9M17tRS88VResDomcntxJAgL1kJmDb", "BvhkBZ5kEP1dxJzfprm8kLk9dSgvT8cLziBFTHZef6r7"] as const;
function quoteProgramOf(pool: PoolV2, all: readonly PoolV2[]): string {
    if (pool.quoteTokenProgram)
        return pool.quoteTokenProgram;
    if (all.some((x) => coinKey(x.token) === coinKey(pool.quote)))
        return TOKEN_2022_PROGRAM_ID;
    throw new RangeError(`pool ${pool.symbol}: quoteTokenProgram is required`);
}
function hopForms(trader: string, pool: PoolV2, all: readonly PoolV2[], programId: string): Instruction[] {
    const qp = quoteProgramOf(pool, all);
    const a = { ...routeTradeAccountsV2(trader, pool, qp, programId), quoteIsLaunch: pool.quoteIsLaunch ?? all.some((x) => coinKey(x.token) === coinKey(pool.quote)), programId };
    return [
        buyInstructionV2({ ...a, amountIn: 1n, minOut: 1n }),
        buyFromBalanceInstructionV2({ ...a, keep: 0n, minOut: 1n }),
        sellInstructionV2({ ...a, tokensIn: 1n, minOut: 1n }),
        sellFromBalanceInstructionV2({ ...a, keep: 0n, minOut: 1n }),
        openHolderPositionInstruction({ owner: trader, launch: a.launch, ownerBase: a.traderBase, programId }),
        createAssociatedTokenAccountIdempotentInstruction({ payer: trader, owner: trader, mint: pool.token, tokenProgram: TOKEN_2022_PROGRAM_ID }),
        createAssociatedTokenAccountIdempotentInstruction({ payer: trader, owner: trader, mint: pool.quote, tokenProgram: qp }),
    ];
}
export function routeTableAddressesV2(pools: readonly PoolV2[], programId = FLOOR_AMM_PROGRAM_ID): string[] {
    if (pools.some((p) => p.chain !== "solana"))
        throw new RangeError("a lookup table is Solana's");
    const seen = PROBES.map((w) => {
        const ixs = pools.flatMap((p) => hopForms(w, p, pools, programId));
        const invoked = new Set(ixs.map((i) => i.programAddress));
        return { order: ixs.flatMap((i) => i.accounts.map((m) => m.address)), invoked };
    });
    const other = new Set(seen[1].order);
    const out: string[] = [];
    const has = new Set<string>();
    for (const x of seen[0].order) {
        if (has.has(x) || !other.has(x) || seen[0].invoked.has(x) || (PROBES as readonly string[]).includes(x))
            continue;
        has.add(x);
        out.push(x);
    }
    return out;
}
export function createRouteTableInstructionV2(p: {
    authority: string;
    payer: string;
    recentSlot: bigint;
}): {
    instruction: Instruction;
    table: string;
} {
    if (p.recentSlot < 0n || p.recentSlot > 0xffffffffffffffffn)
        throw new RangeError("recentSlot: a u64");
    const slot = new Uint8Array(8);
    new DataView(slot.buffer).setBigUint64(0, p.recentSlot, true);
    const [table, bump] = findProgramAddress([addressBytes(p.authority), slot], ADDRESS_LOOKUP_TABLE_PROGRAM_ID);
    const data = concatBytes(Uint8Array.of(0, 0, 0, 0), slot, Uint8Array.of(bump));
    return {
        table,
        instruction: {
            programAddress: ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
            data,
            accounts: [
                { address: table, role: AccountRole.WRITABLE },
                { address: p.authority, role: AccountRole.READONLY },
                { address: p.payer, role: AccountRole.WRITABLE_SIGNER },
                { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
            ],
        },
    };
}
export function extendRouteTableInstructionsV2(p: {
    table: string;
    authority: string;
    payer: string;
    addresses: readonly string[];
}): Instruction[] {
    if (p.addresses.length === 0 || p.addresses.length > MAX_TABLE_ADDRESSES_V2)
        throw new RangeError(`addresses: 1 ..= ${MAX_TABLE_ADDRESSES_V2}`);
    const out: Instruction[] = [];
    for (let i = 0; i < p.addresses.length; i += MAX_EXTEND_ADDRESSES_V2) {
        const chunk = p.addresses.slice(i, i + MAX_EXTEND_ADDRESSES_V2);
        const head = new Uint8Array(12);
        const v = new DataView(head.buffer);
        v.setUint32(0, 2, true);
        v.setBigUint64(4, BigInt(chunk.length), true);
        out.push({
            programAddress: ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
            data: concatBytes(head, ...chunk.map(addressBytes)),
            accounts: [
                { address: p.table, role: AccountRole.WRITABLE },
                { address: p.authority, role: AccountRole.READONLY_SIGNER },
                { address: p.payer, role: AccountRole.WRITABLE_SIGNER },
                { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
            ],
        });
    }
    return out;
}
export const ROUTE_CU_V2 = Object.freeze({
    buy: Object.freeze([[1, 72930], [10, 126041], [24, 229866]] as const),
    sell: Object.freeze([[1, 68471], [10, 122930], [24, 216856]] as const),
    ata: ATA_CREATE_CU,
});
export function hopComputeUnitsV2(side: "buy" | "sell", crossings: number): number | undefined {
    if (!Number.isInteger(crossings) || crossings < 1)
        return undefined;
    for (const [n, cu] of ROUTE_CU_V2[side])
        if (crossings <= n)
            return cu;
    return undefined;
}
export function routeComputeUnitsV2<L>(q: RouteQuoteV2<L>, read: (hq: HopQuoteV2<L>, i: number) => {
    crossings: number;
} | null): (number | undefined)[] {
    return q.hops.map((hq, i) => {
        if (hq.hop.kind === "edge")
            return undefined;
        const r = read(hq, i);
        return r === null ? undefined : hopComputeUnitsV2(hq.hop.kind, r.crossings);
    });
}
