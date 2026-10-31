import { addressBytes, concatBytes, uintLE } from "../codec.ts";
import { R, W, RS, WS } from "./instruction.ts";
import type { Instruction } from "./instruction.ts";
import { ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, associatedTokenAddress } from "./pda.ts";
export function createAssociatedTokenAccountIdempotentInstruction(p: {
    payer: string;
    owner: string;
    mint: string;
    tokenProgram: string;
}): Instruction {
    return {
        programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: [WS(p.payer), W(associatedTokenAddress(p.owner, p.mint, p.tokenProgram)), R(p.owner), R(p.mint), R(SYSTEM_PROGRAM_ID), R(p.tokenProgram)],
        data: new Uint8Array([1]),
    };
}
export function systemTransferInstruction(p: {
    from: string;
    to: string;
    lamports: bigint;
}): Instruction {
    return { programAddress: SYSTEM_PROGRAM_ID, accounts: [WS(p.from), W(p.to)], data: concatBytes(uintLE(2n, 4), uintLE(p.lamports, 8)) };
}
export function syncNativeInstruction(account: string): Instruction {
    return { programAddress: TOKEN_PROGRAM_ID, accounts: [W(account)], data: new Uint8Array([17]) };
}
export function closeAccountInstruction(p: {
    account: string;
    destination: string;
    owner: string;
    tokenProgram?: string;
}): Instruction {
    return { programAddress: p.tokenProgram ?? TOKEN_PROGRAM_ID, accounts: [W(p.account), W(p.destination), RS(p.owner)], data: new Uint8Array([9]) };
}
export function burnCheckedInstruction(p: {
    account: string;
    mint: string;
    owner: string;
    amount: bigint;
    decimals: number;
    tokenProgram: string;
}): Instruction {
    return { programAddress: p.tokenProgram, accounts: [W(p.account), W(p.mint), RS(p.owner)], data: concatBytes(new Uint8Array([15]), uintLE(p.amount, 8), new Uint8Array([p.decimals])) };
}
export interface LookupTable {
    address: string;
    addresses: string[];
}
function shortVec(n: number): Uint8Array {
    const out: number[] = [];
    let v = n;
    for (;;) {
        let b = v & 127;
        v >>= 7;
        if (v === 0) {
            out.push(b);
            return new Uint8Array(out);
        }
        out.push(b | 128);
    }
}
function cmpBytes(a: Uint8Array, b: Uint8Array): number {
    for (let i = 0; i < 32; i++)
        if (a[i] !== b[i])
            return a[i] - b[i];
    return 0;
}
export function compileV0Message(p: {
    payer: string;
    instructions: Instruction[];
    recentBlockhash: string;
    lookupTables?: LookupTable[];
}): Uint8Array {
    type Meta = {
        signer: boolean;
        writable: boolean;
        invoked: boolean;
    };
    const meta = new Map<string, Meta>();
    const get = (k: string): Meta => {
        let m = meta.get(k);
        if (!m)
            meta.set(k, (m = { signer: false, writable: false, invoked: false }));
        return m;
    };
    for (const ix of p.instructions) {
        get(ix.programAddress).invoked = true;
        for (const a of ix.accounts) {
            const m = get(a.address);
            m.signer ||= a.role >= 2;
            m.writable ||= (a.role & 1) === 1;
        }
    }
    const pm = get(p.payer);
    pm.signer = true;
    pm.writable = true;
    const bytes = new Map<string, Uint8Array>();
    for (const k of meta.keys())
        bytes.set(k, addressBytes(k));
    const byAddress = (x: [
        string,
        Meta
    ], y: [
        string,
        Meta
    ]): number => cmpBytes(bytes.get(x[0])!, bytes.get(y[0])!);
    const lookups: {
        table: string;
        w: number[];
        r: number[];
    }[] = [];
    const loadedW: string[] = [];
    const loadedR: string[] = [];
    for (const t of p.lookupTables ?? []) {
        const drain = (f: (m: Meta) => boolean): [
            number[],
            string[]
        ] => {
            const idx: number[] = [];
            const keys: string[] = [];
            const ordered = [...meta.entries()].filter(([, m]) => f(m)).sort(byAddress);
            for (const [key] of ordered) {
                const i = t.addresses.indexOf(key);
                if (i >= 0) {
                    if (i > 255)
                        throw new RangeError("address lookup table index overflow");
                    idx.push(i);
                    keys.push(key);
                }
            }
            for (const key of keys)
                meta.delete(key);
            return [idx, keys];
        };
        const [w, wk] = drain((m) => !m.signer && !m.invoked && m.writable);
        const [r, rk] = drain((m) => !m.signer && !m.invoked && !m.writable);
        if (w.length || r.length) {
            lookups.push({ table: t.address, w, r });
            loadedW.push(...wk);
            loadedR.push(...rk);
        }
    }
    meta.delete(p.payer);
    const sorted = [...meta.entries()].sort(byAddress);
    const pick = (f: (m: Meta) => boolean) => sorted.filter(([, m]) => f(m)).map(([k]) => k);
    const ws = [p.payer, ...pick((m) => m.signer && m.writable)];
    const rs = pick((m) => m.signer && !m.writable);
    const wn = pick((m) => !m.signer && m.writable);
    const rn = pick((m) => !m.signer && !m.writable);
    const statics = [...ws, ...rs, ...wn, ...rn];
    const all = [...statics, ...loadedW, ...loadedR];
    const index = new Map(all.map((k, i) => [k, i]));
    const at = (k: string): number => {
        const i = index.get(k);
        if (i === undefined || i > 255)
            throw new RangeError(`account index: ${k}`);
        return i;
    };
    const parts: Uint8Array[] = [
        new Uint8Array([128, ws.length + rs.length, rs.length, rn.length]),
        shortVec(statics.length),
        ...statics.map((k) => bytes.get(k)!),
        addressBytes(p.recentBlockhash),
        shortVec(p.instructions.length),
    ];
    for (const ix of p.instructions) {
        parts.push(new Uint8Array([at(ix.programAddress)]), shortVec(ix.accounts.length), new Uint8Array(ix.accounts.map((a) => at(a.address))));
        parts.push(shortVec(ix.data.length), ix.data);
    }
    parts.push(shortVec(lookups.length));
    for (const l of lookups)
        parts.push(addressBytes(l.table), shortVec(l.w.length), new Uint8Array(l.w), shortVec(l.r.length), new Uint8Array(l.r));
    return concatBytes(...parts);
}
export function transactionSize(message: Uint8Array): number {
    const signers = message[0] === 128 ? message[1] : message[0];
    return shortVec(signers).length + 64 * signers + message.length;
}
export const PACKET_DATA_SIZE = 1232;
