import { addressBytes, base58Encode } from "../../codec.ts";
import { isOnCurve } from "../../ed25519.ts";
import { findProgramAddress } from "../pda.ts";
import type { Pda } from "../pda.ts";
import { FLOOR_AMM_PROGRAM_ID } from "./program.ts";
export const MINT_SEED = "mint";
const U64_MAX = (1n << 64n) - 1n;
function nonceBytes(nonce: bigint): Uint8Array {
    if (typeof nonce !== "bigint" || nonce < 0n || nonce > U64_MAX)
        throw new RangeError(`a mint nonce is a u64: ${String(nonce)}`);
    const b = new Uint8Array(8);
    let v = nonce;
    for (let i = 0; i < 8; i++) {
        b[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return b;
}
export const launchMintPda = (creator: string, mintNonce: bigint, p = FLOOR_AMM_PROGRAM_ID): Pda => findProgramAddress([MINT_SEED, addressBytes(creator), nonceBytes(mintNonce)], p);
export const launchMintAddress = (creator: string, mintNonce: bigint, p = FLOOR_AMM_PROGRAM_ID): string => launchMintPda(creator, mintNonce, p)[0];
export interface MintNonceCheck {
    mint: string;
    bump: number;
    firstTry: boolean;
    fits: boolean;
}
export function checkMintNonce(p: {
    creator: string;
    nonce: bigint;
    programId?: string;
    fits?: (address: string) => boolean;
}): MintNonceCheck {
    const [mint, bump] = launchMintPda(p.creator, p.nonce, p.programId ?? FLOOR_AMM_PROGRAM_ID);
    return { mint, bump, firstTry: bump === 255, fits: p.fits ? p.fits(mint) : true };
}
const K = new Int32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298,
]);
const IV = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
const MSG_LEN = 98;
const NONCE_WORD = 9;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const M4 = 58 ** 4;
const bswap = (x: number): number => ((x << 24) | ((x & 65280) << 8) | ((x >>> 8) & 65280) | (x >>> 24)) | 0;
function expand(w: Int32Array): void {
    for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
}
function rounds(s: Int32Array, kw: Int32Array, from: number): void {
    let a = s[0], b = s[1], c = s[2], d = s[3], e = s[4], f = s[5], g = s[6], h = s[7];
    for (let i = from; i < 64; i++) {
        const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + kw[i]) | 0;
        const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
    }
    s[0] = a;
    s[1] = b;
    s[2] = c;
    s[3] = d;
    s[4] = e;
    s[5] = f;
    s[6] = g;
    s[7] = h;
}
class Kernel {
    readonly w1 = new Int32Array(64);
    readonly kw1 = new Int32Array(64);
    readonly kw2 = new Int32Array(64);
    readonly pre = new Int32Array(8);
    readonly s = new Int32Array(8);
    readonly h1 = new Int32Array(8);
    readonly out = new Int32Array(8);
    constructor(creator: string, programId: string) {
        const msg = new Uint8Array(128);
        msg.set(new TextEncoder().encode(MINT_SEED), 0);
        msg.set(addressBytes(creator), 4);
        msg[44] = 255;
        msg.set(addressBytes(programId), 45);
        msg.set(new TextEncoder().encode("ProgramDerivedAddress"), 77);
        msg[MSG_LEN] = 128;
        const bits = MSG_LEN * 8;
        msg[126] = bits >>> 8;
        msg[127] = bits & 255;
        const word = (o: number) => (msg[o] << 24) | (msg[o + 1] << 16) | (msg[o + 2] << 8) | msg[o + 3];
        for (let i = 0; i < 16; i++)
            this.w1[i] = word(4 * i);
        const w2 = new Int32Array(64);
        for (let i = 0; i < 16; i++)
            w2[i] = word(64 + 4 * i);
        expand(w2);
        for (let i = 0; i < 64; i++)
            this.kw2[i] = (K[i] + w2[i]) | 0;
        for (let i = 0; i < NONCE_WORD; i++)
            this.kw1[i] = (K[i] + this.w1[i]) | 0;
        const s = this.pre;
        for (let i = 0; i < 8; i++)
            s[i] = IV[i];
        let a = s[0], b = s[1], c = s[2], d = s[3], e = s[4], f = s[5], g = s[6], h = s[7];
        for (let i = 0; i < NONCE_WORD; i++) {
            const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + this.kw1[i]) | 0;
            const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            h = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        s[0] = a;
        s[1] = b;
        s[2] = c;
        s[3] = d;
        s[4] = e;
        s[5] = f;
        s[6] = g;
        s[7] = h;
    }
    hash(lo: number, hi: number): Int32Array {
        const w = this.w1, kw = this.kw1, s = this.s, h1 = this.h1, out = this.out;
        w[NONCE_WORD] = bswap(lo);
        w[NONCE_WORD + 1] = bswap(hi);
        expand(w);
        for (let i = NONCE_WORD; i < 64; i++)
            kw[i] = (K[i] + w[i]) | 0;
        s.set(this.pre);
        rounds(s, kw, NONCE_WORD);
        for (let i = 0; i < 8; i++)
            h1[i] = s[i] = (IV[i] + s[i]) | 0;
        rounds(s, this.kw2, 0);
        for (let i = 0; i < 8; i++)
            out[i] = (h1[i] + s[i]) | 0;
        return out;
    }
}
function digestBytes(h: Int32Array): Uint8Array {
    const b = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
        b[4 * i] = h[i] >>> 24;
        b[4 * i + 1] = (h[i] >>> 16) & 255;
        b[4 * i + 2] = (h[i] >>> 8) & 255;
        b[4 * i + 3] = h[i] & 255;
    }
    return b;
}
function tail4(h: Int32Array): number {
    let r = 0;
    for (let i = 0; i < 8; i++) {
        const x = h[i];
        r = (r * 65536 + (x >>> 16)) % M4;
        r = (r * 65536 + (x & 65535)) % M4;
    }
    return r;
}
function tailString(r: number, n: number): string {
    let t = "";
    for (let i = 0; i < n; i++) {
        t = ALPHABET[r % 58] + t;
        r = Math.floor(r / 58);
    }
    return t;
}
function randomNonce(): bigint {
    const b = new Uint8Array(8);
    globalThis.crypto.getRandomValues(b);
    let v = 0n;
    for (let i = 7; i >= 0; i--)
        v = (v << 8n) | BigInt(b[i]);
    return v;
}
export interface GrindMintNonceOptions {
    creator: string;
    programId?: string;
    fits: (address: string) => boolean;
    tail?: number;
    start?: bigint;
    sliceMs?: number;
    yieldTo?: () => Promise<void>;
    cancelled?: () => boolean;
    budgetMs?: number;
    onTried?: (tried: number) => void;
}
export interface MintNonceHit {
    nonce: bigint;
    mint: string;
}
const now = (): number => globalThis.performance?.now?.() ?? Date.now();
const macrotask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
export async function grindMintNonce(o: GrindMintNonceOptions): Promise<MintNonceHit | null> {
    const programId = o.programId ?? FLOOR_AMM_PROGRAM_ID;
    const tail = o.tail;
    if (tail !== undefined && (!Number.isInteger(tail) || tail < 1 || tail > 4))
        throw new RangeError(`tail is 1..4 characters: ${tail}`);
    const k = new Kernel(o.creator, programId);
    const sliceMs = o.sliceMs ?? 40;
    const yieldTo = o.yieldTo ?? macrotask;
    const t0 = now();
    const deadline = o.budgetMs === undefined ? Infinity : t0 + o.budgetMs;
    const start = o.start ?? randomNonce();
    nonceBytes(start);
    let lo = Number(start & 0xffffffffn) | 0;
    let hi = Number(start >> 32n) | 0;
    let tried = 0;
    const CHUNK = 2048;
    for (;;) {
        const sliceEnd = Math.min(now() + sliceMs, deadline);
        do {
            for (let n = 0; n < CHUNK; n++) {
                const h = k.hash(lo, hi);
                const nlo = lo, nhi = hi;
                lo = (lo + 1) | 0;
                if (lo === 0)
                    hi = (hi + 1) | 0;
                if (tail !== undefined && !o.fits(tailString(tail4(h), tail)))
                    continue;
                const bytes = digestBytes(h);
                const mint = base58Encode(bytes);
                if (!o.fits(mint) || isOnCurve(bytes))
                    continue;
                o.onTried?.(tried + n + 1);
                return { nonce: (BigInt(nhi >>> 0) << 32n) | BigInt(nlo >>> 0), mint };
            }
            tried += CHUNK;
        } while (now() < sliceEnd);
        o.onTried?.(tried);
        if (now() >= deadline || o.cancelled?.())
            return null;
        await yieldTo();
        if (o.cancelled?.())
            return null;
    }
}
