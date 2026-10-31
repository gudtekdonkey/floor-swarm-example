import { concatBytes, uintLE } from "../codec.ts";
import { sha256 } from "../sha256.ts";
export const AccountRole = Object.freeze({ READONLY: 0, WRITABLE: 1, READONLY_SIGNER: 2, WRITABLE_SIGNER: 3 } as const);
export type AccountRoleValue = 0 | 1 | 2 | 3;
export interface AccountMeta {
    address: string;
    role: AccountRoleValue;
}
export interface Instruction {
    programAddress: string;
    accounts: AccountMeta[];
    data: Uint8Array;
}
export const R = (address: string): AccountMeta => ({ address, role: 0 });
export const W = (address: string): AccountMeta => ({ address, role: 1 });
export const RS = (address: string): AccountMeta => ({ address, role: 2 });
export const WS = (address: string): AccountMeta => ({ address, role: 3 });
export function instructionDiscriminator(name: string): Uint8Array {
    return sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);
}
export function accountDiscriminator(name: string): Uint8Array {
    return sha256(new TextEncoder().encode(`account:${name}`)).slice(0, 8);
}
export function eventDiscriminator(name: string): Uint8Array {
    return sha256(new TextEncoder().encode(`event:${name}`)).slice(0, 8);
}
export const EVENT_IX_TAG_LE = Uint8Array.from([228, 69, 165, 46, 81, 203, 154, 29]);
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
export const MAX_COMPUTE_UNIT_LIMIT = 1400000;
export function computeUnitLimitInstruction(units: number): Instruction {
    if (!Number.isInteger(units) || units < 0 || units > 4294967295)
        throw new RangeError("units must fit a u32");
    return { programAddress: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: concatBytes(new Uint8Array([2]), uintLE(BigInt(units), 4)) };
}
export function computeUnitLimitFor(consumed: number, marginBps = 1000): number {
    if (!Number.isInteger(consumed) || consumed < 0)
        throw new RangeError("consumed must be a whole number of compute units");
    if (!Number.isInteger(marginBps) || marginBps < 0)
        throw new RangeError("marginBps must be a whole number of bps");
    return Math.min(MAX_COMPUTE_UNIT_LIMIT, consumed + Math.ceil((consumed * marginBps) / 10000));
}
export function computeUnitPriceInstruction(microLamports: bigint): Instruction {
    if (microLamports < 0n || microLamports > 0xffffffffffffffffn)
        throw new RangeError("microLamports must fit a u64");
    return { programAddress: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: concatBytes(new Uint8Array([3]), uintLE(microLamports, 8)) };
}
export function priorityFeeLamports(limit: number, microLamports: bigint): bigint {
    return (BigInt(limit) * microLamports + 999999n) / 1000000n;
}
