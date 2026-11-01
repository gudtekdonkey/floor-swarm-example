import { MEMBERS_MAX as MAX_MEMBERS } from "../../v2/layouts.ts";
import { createLaunchInstructionV2 } from "../../v2/solana.ts";
import type { Instruction } from "../instruction.ts";
import { computeUnitLimitInstruction, computeUnitPriceInstruction } from "../instruction.ts";
import { PACKET_DATA_SIZE, compileV0Message, transactionSize } from "../tx.ts";
import type { LookupTable } from "../tx.ts";
import { createMintAccounts, teamSlotAddInstruction, TEAM_SLOT_PENDING_HANDLE, TEAM_SLOT_WALLET } from "./instructions.ts";
import { FLOOR_AMM_PROGRAM_ID, teamSlotPda } from "./program.ts";
export interface CreateSlotMember {
    key: string;
    kind: typeof TEAM_SLOT_WALLET | typeof TEAM_SLOT_PENDING_HANDLE;
    amount: bigint;
    payNow: boolean;
}
export const MAX_TX_LOCKS = 64;
export interface CreateWithSlotPlan {
    instructions: Instruction[];
    message: Uint8Array;
    size: number;
    locks: number;
    fits: boolean;
    transactions: {
        instructions: Instruction[];
        message: Uint8Array;
        size: number;
    }[];
    teamSlot: string;
}
export function planCreateWithSlot(p: {
    create: Parameters<typeof createLaunchInstructionV2>[0];
    members: readonly CreateSlotMember[];
    recentBlockhash: string;
    lookupTables?: LookupTable[];
    computeUnitLimit?: number;
    microLamports?: bigint;
}): CreateWithSlotPlan {
    const c = p.create;
    const pid = c.programId ?? FLOOR_AMM_PROGRAM_ID;
    if (p.members.length > MAX_MEMBERS)
        throw new RangeError(`a Team Slot has at most ${MAX_MEMBERS} members (R103)`);
    const mint = createMintAccounts({ ...c, programId: pid });
    const teamSlot = teamSlotPda(mint.launch, pid)[0];
    const pay = { payer: c.creator, launch: mint.launch, teamSlot, quoteMint: c.quoteMint, payerQuote: c.creatorQuote, quoteVault: mint.quoteVault, quoteTokenProgram: c.quoteTokenProgram, baseMint: mint.baseMint, programId: pid };
    const instructions: Instruction[] = [
        ...(p.computeUnitLimit !== undefined ? [computeUnitLimitInstruction(p.computeUnitLimit)] : []),
        ...(p.microLamports !== undefined ? [computeUnitPriceInstruction(p.microLamports)] : []),
        createLaunchInstructionV2(c),
        ...[...p.members.filter((m) => m.payNow), ...p.members.filter((m) => !m.payNow)].map((m) => teamSlotAddInstruction({ ...pay, key: m.key, kind: m.kind, amount: m.amount, payNow: m.payNow })),
    ];
    const compile = (ixs: Instruction[]) => {
        const m = compileV0Message({ payer: c.creator, instructions: ixs, recentBlockhash: p.recentBlockhash, lookupTables: p.lookupTables });
        return { instructions: ixs, message: m, size: transactionSize(m) };
    };
    const whole = compile(instructions);
    const { message, size } = whole;
    const lockSet = new Set<string>([c.creator]);
    for (const ix of instructions) {
        lockSet.add(ix.programAddress);
        for (const a of ix.accounts)
            lockSet.add(a.address);
    }
    const fits = size <= PACKET_DATA_SIZE && lockSet.size <= MAX_TX_LOCKS;
    const transactions: CreateWithSlotPlan["transactions"] = [];
    if (fits)
        transactions.push(whole);
    else {
        const budget = instructions.slice(0, instructions.length - 1 - p.members.length);
        const adds = instructions.slice(instructions.length - p.members.length);
        let cur = instructions.slice(0, instructions.length - p.members.length);
        for (const a of adds) {
            const next = compile([...cur, a]);
            if (next.size <= PACKET_DATA_SIZE)
                cur = [...cur, a];
            else {
                transactions.push(compile(cur));
                cur = [...budget, a];
            }
        }
        transactions.push(compile(cur));
        for (const t of transactions)
            if (t.size > PACKET_DATA_SIZE)
                throw new RangeError(`a create transaction is ${t.size} B even alone: give a lookup table`);
    }
    return { instructions, message, size, locks: lockSet.size, fits, transactions, teamSlot };
}
