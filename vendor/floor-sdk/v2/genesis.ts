import type { AccountMeta, Instruction } from "../solana/instruction.ts";
import { R, W } from "../solana/instruction.ts";
import { FLOOR_AMM_PROGRAM_ID, genesisMigrationVaultPda, genesisRaisePda, launchPda } from "../solana/floor/program.ts";
import * as I from "../solana/floor/instructions.ts";
import { extraAccountMetasPda, FLOOR_HOOK_PROGRAM_ID, holderBookPda, holderPositionPda } from "./solana.ts";
import { Writer } from "../solana/floor/borsh.ts";
type Hooked = {
    hookProgramId?: string;
};
type Ctx = {
    programId?: string;
} & Hooked;
const pid = (c?: Ctx): string => c?.programId ?? FLOOR_AMM_PROGRAM_ID;
const hid = (c?: Ctx): string => c?.hookProgramId ?? FLOOR_HOOK_PROGRAM_ID;
const EVENT_PAIR = 2;
function withTail(base: Instruction, tail: AccountMeta[]): Instruction {
    const n = base.accounts.length - EVENT_PAIR;
    return { ...base, accounts: [...base.accounts.slice(0, n), ...tail, ...base.accounts.slice(n)] };
}
const withData = (base: Instruction, more: (w: Writer) => Writer): Instruction => {
    const tail = more(new Writer()).done();
    const data = new Uint8Array(base.data.length + tail.length);
    data.set(base.data, 0);
    data.set(tail, base.data.length);
    return { ...base, data };
};
type Member = {
    member: string;
};
const position = (mint: string, owner: string, c?: Ctx): string => holderPositionPda(launchPda(mint, pid(c))[0], owner, hid(c))[0];
const book = (mint: string, c?: Ctx): string => holderBookPda(launchPda(mint, pid(c))[0], hid(c))[0];
export function openGenesisLaunchInstructionV2(p: Parameters<typeof I.openGenesisLaunchInstruction>[0] & Hooked & Member): Instruction {
    const base = I.openGenesisLaunchInstruction(p);
    const g = pid(p);
    return withData(withTail(base, [
        W(book(p.baseMint, p)),
        W(extraAccountMetasPda(p.baseMint, hid(p))[0]),
        R(hid(p)),
        W(position(p.baseMint, p.launch, p)),
        W(position(p.baseMint, genesisRaisePda(g)[0], p)),
        W(position(p.baseMint, genesisMigrationVaultPda(g)[0], p)),
    ]), (w) => w.pubkey(p.member));
}
export function openGenesisWagmiInstructionV2(p: Parameters<typeof I.openGenesisWagmiInstruction>[0] & Hooked & Member): Instruction {
    const base = I.openGenesisWagmiInstruction(p);
    const g = pid(p);
    return withData(withTail(base, [
        W(book(p.baseMint, p)),
        W(extraAccountMetasPda(p.baseMint, hid(p))[0]),
        R(hid(p)),
        W(position(p.baseMint, p.launch, p)),
        W(position(p.baseMint, genesisRaisePda(g)[0], p)),
        R(extraAccountMetasPda(p.quoteMint, hid(p))[0]),
        W(book(p.quoteMint, p)),
        W(position(p.quoteMint, genesisMigrationVaultPda(g)[0], p)),
        W(position(p.quoteMint, p.launch, p)),
    ]), (w) => w.pubkey(p.member));
}
export function claimGenesisInstructionV2(p: Parameters<typeof I.claimGenesisInstruction>[0] & Hooked): Instruction {
    const base = I.claimGenesisInstruction(p);
    const g = pid(p);
    return withTail(base, [
        R(extraAccountMetasPda(p.baseMint, hid(p))[0]),
        R(launchPda(p.baseMint, g)[0]),
        W(book(p.baseMint, p)),
        W(position(p.baseMint, genesisRaisePda(g)[0], p)),
        W(position(p.baseMint, p.wallet, p)),
        R(hid(p)),
    ]);
}
export function claimGenesisWagmiInstructionV2(p: Parameters<typeof I.claimGenesisWagmiInstruction>[0] & Hooked): Instruction {
    const base = I.claimGenesisWagmiInstruction(p);
    const g = pid(p);
    return withTail(base, [
        R(extraAccountMetasPda(p.wagmiMint, hid(p))[0]),
        R(launchPda(p.wagmiMint, g)[0]),
        W(book(p.wagmiMint, p)),
        W(position(p.wagmiMint, genesisRaisePda(g)[0], p)),
        W(position(p.wagmiMint, p.wallet, p)),
        R(extraAccountMetasPda(p.floorMint, hid(p))[0]),
        R(launchPda(p.floorMint, g)[0]),
        W(book(p.floorMint, p)),
        W(position(p.floorMint, genesisMigrationVaultPda(g)[0], p)),
        W(position(p.floorMint, p.wallet, p)),
        R(hid(p)),
    ]);
}
export function sweepGenesisWagmiDustInstructionV2(p: Parameters<typeof I.sweepGenesisWagmiDustInstruction>[0] & Hooked): Instruction {
    const base = I.sweepGenesisWagmiDustInstruction(p);
    const g = pid(p);
    return withTail(base, [
        R(extraAccountMetasPda(p.floorMint, hid(p))[0]),
        R(launchPda(p.floorMint, g)[0]),
        W(book(p.floorMint, p)),
        W(position(p.floorMint, genesisMigrationVaultPda(g)[0], p)),
        W(position(p.floorMint, p.launch, p)),
        R(hid(p)),
    ]);
}
