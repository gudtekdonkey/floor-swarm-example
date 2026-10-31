import { addressBytes, base58Encode, concatBytes } from "../codec.ts";
import { isOnCurve } from "../ed25519.ts";
import { sha256 } from "../sha256.ts";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const BPF_LOADER_UPGRADEABLE_ID = "BPFLoaderUpgradeab1e11111111111111111111111";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const ADDRESS_LOOKUP_TABLE_PROGRAM_ID = "AddressLookupTab1e1111111111111111111111111";
export const RENT_SYSVAR_ID = "SysvarRent111111111111111111111111111111111";
export const CLOCK_SYSVAR_ID = "SysvarC1ock11111111111111111111111111111111";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export type Seed = Uint8Array | string;
export type Pda = readonly [
    address: string,
    bump: number
];
const MAX_SEED_LEN = 32;
const MAX_SEEDS = 16;
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
function seedBytes(s: Seed): Uint8Array {
    return typeof s === "string" ? new TextEncoder().encode(s) : s;
}
export function createProgramAddress(seeds: readonly Seed[], programId: string): string | null {
    if (seeds.length > MAX_SEEDS)
        throw new RangeError("at most 16 seeds");
    const parts = seeds.map(seedBytes);
    for (const p of parts)
        if (p.length > MAX_SEED_LEN)
            throw new RangeError("a seed is at most 32 bytes");
    const h = sha256(concatBytes(...parts, addressBytes(programId), PDA_MARKER));
    return isOnCurve(h) ? null : base58Encode(h);
}
export const PDA_CACHE_MAX = 2048;
const pdaCache = new Map<string, Pda>();
export function clearPdaCache(): void {
    pdaCache.clear();
    ataCache.clear();
}
function pdaKey(seeds: readonly Seed[], programId: string): string {
    let k = programId;
    for (const s of seeds)
        k += typeof s === "string" ? `|s${s.length}:${s}` : `|b${s.length}:${String.fromCharCode(...s)}`;
    return k;
}
export function findProgramAddress(seeds: readonly Seed[], programId: string): Pda {
    if (seeds.length > MAX_SEEDS - 1)
        throw new RangeError("at most 16 seeds");
    for (const s of seeds)
        if (typeof s !== "string" && s.length > MAX_SEED_LEN)
            throw new RangeError("a seed is at most 32 bytes");
    const key = pdaKey(seeds, programId);
    const hit = pdaCache.get(key);
    if (hit) {
        pdaCache.delete(key);
        pdaCache.set(key, hit);
        return hit;
    }
    for (let bump = 255; bump >= 0; bump--) {
        const a = createProgramAddress([...seeds, Uint8Array.of(bump)], programId);
        if (a !== null) {
            const r: Pda = Object.freeze([a, bump] as const);
            if (pdaCache.size >= PDA_CACHE_MAX)
                pdaCache.delete(pdaCache.keys().next().value!);
            pdaCache.set(key, r);
            return r;
        }
    }
    throw new Error("no viable bump");
}
export const programDataPda = (program: string): Pda => findProgramAddress([addressBytes(program)], BPF_LOADER_UPGRADEABLE_ID);
export const eventAuthorityPda = (program: string): Pda => findProgramAddress(["__event_authority"], program);
const ataCache = new Map<string, string>();
export function associatedTokenAddress(owner: string, mint: string, tokenProgram = TOKEN_2022_PROGRAM_ID): string {
    const key = `${owner}|${mint}|${tokenProgram}`;
    const hit = ataCache.get(key);
    if (hit !== undefined) {
        ataCache.delete(key);
        ataCache.set(key, hit);
        return hit;
    }
    const a = findProgramAddress([addressBytes(owner), addressBytes(tokenProgram), addressBytes(mint)], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
    if (ataCache.size >= PDA_CACHE_MAX)
        ataCache.delete(ataCache.keys().next().value!);
    ataCache.set(key, a);
    return a;
}
