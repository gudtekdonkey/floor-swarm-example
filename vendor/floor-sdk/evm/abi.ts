import { keccak256 } from "./keccak.ts";
export type AbiType = {
    kind: "uint" | "int";
    bits: number;
} | {
    kind: "address" | "bool" | "bytes" | "string";
} | {
    kind: "fixedBytes";
    size: number;
} | {
    kind: "array";
    of: AbiType;
    length: number | null;
} | {
    kind: "tuple";
    of: AbiType[];
};
export type AbiValue = bigint | boolean | string | Uint8Array | AbiValue[];
export class AbiError extends Error {
    constructor(detail: string) {
        super(`abi: ${detail}`);
        this.name = "AbiError";
    }
}
function splitTop(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
        if (ch === "(")
            depth++;
        if (ch === ")")
            depth--;
        if (ch === "," && depth === 0) {
            out.push(cur);
            cur = "";
        }
        else
            cur += ch;
    }
    if (cur.length > 0 || out.length > 0)
        out.push(cur);
    return out;
}
export function parseType(t: string): AbiType {
    const s = t.trim();
    if (s.endsWith("]")) {
        const i = s.lastIndexOf("[");
        const n = s.slice(i + 1, -1);
        if (i <= 0 || !/^\d*$/.test(n))
            throw new AbiError(`bad array ${s}`);
        return { kind: "array", of: parseType(s.slice(0, i)), length: n === "" ? null : Number(n) };
    }
    if (s.startsWith("(") && s.endsWith(")"))
        return { kind: "tuple", of: splitTop(s.slice(1, -1)).map(parseType) };
    if (s === "address" || s === "bool" || s === "bytes" || s === "string")
        return { kind: s };
    const m = /^(u?int)(\d*)$/.exec(s);
    if (m) {
        const bits = m[2] === "" ? 256 : Number(m[2]);
        if (bits % 8 !== 0 || bits < 8 || bits > 256)
            throw new AbiError(`bad width ${s}`);
        return { kind: m[1] === "uint" ? "uint" : "int", bits };
    }
    const b = /^bytes(\d+)$/.exec(s);
    if (b) {
        const size = Number(b[1]);
        if (size < 1 || size > 32)
            throw new AbiError(`bad size ${s}`);
        return { kind: "fixedBytes", size };
    }
    throw new AbiError(`unknown type ${s}`);
}
export function typeString(t: AbiType): string {
    switch (t.kind) {
        case "uint":
        case "int":
            return `${t.kind}${t.bits}`;
        case "fixedBytes":
            return `bytes${t.size}`;
        case "array":
            return `${typeString(t.of)}[${t.length ?? ""}]`;
        case "tuple":
            return `(${t.of.map(typeString).join(",")})`;
        default:
            return t.kind;
    }
}
function isDynamic(t: AbiType): boolean {
    if (t.kind === "bytes" || t.kind === "string")
        return true;
    if (t.kind === "array")
        return t.length === null || isDynamic(t.of);
    if (t.kind === "tuple")
        return t.of.some(isDynamic);
    return false;
}
function headSize(t: AbiType): number {
    if (isDynamic(t))
        return 32;
    if (t.kind === "array")
        return (t.length as number) * headSize(t.of);
    if (t.kind === "tuple")
        return t.of.reduce((a, x) => a + headSize(x), 0);
    return 32;
}
export function hexToBytes(h: string): Uint8Array {
    const s = h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h;
    if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s))
        throw new AbiError(`bad hex ${h}`);
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
    return out;
}
export function bytesToHex(b: Uint8Array): string {
    let s = "0x";
    for (const x of b)
        s += x.toString(16).padStart(2, "0");
    return s;
}
const concat = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
};
function word(v: bigint): Uint8Array {
    const out = new Uint8Array(32);
    let x = v;
    for (let i = 31; i >= 0; i--) {
        out[i] = Number(x & 0xffn);
        x >>= 8n;
    }
    return out;
}
const readWord = (d: Uint8Array, o: number): bigint => {
    if (o + 32 > d.length)
        throw new AbiError("data too short");
    let v = 0n;
    for (let i = 0; i < 32; i++)
        v = (v << 8n) | BigInt(d[o + i]);
    return v;
};
const asBytes = (v: AbiValue): Uint8Array => (v instanceof Uint8Array ? v : typeof v === "string" ? hexToBytes(v) : (() => { throw new AbiError("expected bytes"); })());
const padRight = (b: Uint8Array): Uint8Array => {
    const out = new Uint8Array(Math.ceil(b.length / 32) * 32);
    out.set(b);
    return out;
};
function encodeOne(t: AbiType, v: AbiValue): Uint8Array {
    switch (t.kind) {
        case "uint": {
            if (typeof v !== "bigint" || v < 0n || v >= 1n << BigInt(t.bits))
                throw new AbiError(`uint${t.bits} out of range`);
            return word(v);
        }
        case "int": {
            const lim = 1n << BigInt(t.bits - 1);
            if (typeof v !== "bigint" || v < -lim || v >= lim)
                throw new AbiError(`int${t.bits} out of range`);
            return word(v < 0n ? (1n << 256n) + v : v);
        }
        case "address": {
            const b = asBytes(v);
            if (b.length !== 20)
                throw new AbiError("an address is 20 bytes");
            const out = new Uint8Array(32);
            out.set(b, 12);
            return out;
        }
        case "bool":
            if (typeof v !== "boolean")
                throw new AbiError("expected bool");
            return word(v ? 1n : 0n);
        case "fixedBytes": {
            const b = asBytes(v);
            if (b.length !== t.size)
                throw new AbiError(`bytes${t.size} is ${t.size} bytes`);
            const out = new Uint8Array(32);
            out.set(b);
            return out;
        }
        case "bytes":
        case "string": {
            const b = t.kind === "string" ? (typeof v === "string" ? new TextEncoder().encode(v) : (() => { throw new AbiError("expected string"); })()) : asBytes(v);
            return concat([word(BigInt(b.length)), padRight(b)]);
        }
        case "array": {
            if (!Array.isArray(v))
                throw new AbiError("expected array");
            if (t.length !== null && v.length !== t.length)
                throw new AbiError(`expected ${t.length} items`);
            const body = encodeSeq(v.map(() => t.of), v);
            return t.length === null ? concat([word(BigInt(v.length)), body]) : body;
        }
        case "tuple": {
            if (!Array.isArray(v) || v.length !== t.of.length)
                throw new AbiError("tuple arity");
            return encodeSeq(t.of, v);
        }
    }
}
function encodeSeq(types: AbiType[], values: AbiValue[]): Uint8Array {
    if (types.length !== values.length)
        throw new AbiError(`expected ${types.length} values, got ${values.length}`);
    const heads: Uint8Array[] = [];
    const tails: Uint8Array[] = [];
    let tailOff = types.reduce((a, t) => a + headSize(t), 0);
    types.forEach((t, i) => {
        const e = encodeOne(t, values[i]);
        if (isDynamic(t)) {
            heads.push(word(BigInt(tailOff)));
            tails.push(e);
            tailOff += e.length;
        }
        else
            heads.push(e);
    });
    return concat([...heads, ...tails]);
}
export function encodeAbi(types: readonly (string | AbiType)[], values: readonly AbiValue[]): Uint8Array {
    return encodeSeq(types.map((t) => (typeof t === "string" ? parseType(t) : t)), [...values]);
}
function decodeOne(t: AbiType, d: Uint8Array, base: number, at: number): AbiValue {
    const o = isDynamic(t) ? base + Number(readWord(d, at)) : at;
    switch (t.kind) {
        case "uint":
            return readWord(d, o);
        case "int": {
            const w = readWord(d, o);
            return w >= 1n << 255n ? w - (1n << 256n) : w;
        }
        case "address":
            return checksumAddress(bytesToHex(d.slice(o + 12, o + 32)));
        case "bool":
            return readWord(d, o) !== 0n;
        case "fixedBytes":
            return bytesToHex(d.slice(o, o + t.size));
        case "bytes":
        case "string": {
            const n = Number(readWord(d, o));
            if (o + 32 + n > d.length)
                throw new AbiError("data too short");
            const b = d.slice(o + 32, o + 32 + n);
            return t.kind === "string" ? new TextDecoder().decode(b) : bytesToHex(b);
        }
        case "array": {
            let n = t.length ?? 0;
            let start = o;
            if (t.length === null) {
                n = Number(readWord(d, o));
                start = o + 32;
            }
            return decodeSeq(Array.from({ length: n }, () => t.of), d, start);
        }
        case "tuple":
            return decodeSeq(t.of, d, o);
    }
}
function decodeSeq(types: AbiType[], d: Uint8Array, base: number): AbiValue[] {
    const out: AbiValue[] = [];
    let at = base;
    for (const t of types) {
        out.push(decodeOne(t, d, base, at));
        at += headSize(t);
    }
    return out;
}
export function decodeAbi(types: readonly (string | AbiType)[], data: Uint8Array | string): AbiValue[] {
    return decodeSeq(types.map((t) => (typeof t === "string" ? parseType(t) : t)), typeof data === "string" ? hexToBytes(data) : data, 0);
}
export function parseSignature(sig: string): {
    name: string;
    types: AbiType[];
    canonical: string;
} {
    const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\((.*)\)$/.exec(sig.replace(/\s+/g, ""));
    if (!m)
        throw new AbiError(`bad signature ${sig}`);
    const types = m[2] === "" ? [] : splitTop(m[2]).map(parseType);
    return { name: m[1], types, canonical: `${m[1]}(${types.map(typeString).join(",")})` };
}
export function functionSelector(sig: string): Uint8Array {
    return keccak256(new TextEncoder().encode(parseSignature(sig).canonical)).slice(0, 4);
}
export function eventTopic(sig: string): string {
    return bytesToHex(keccak256(new TextEncoder().encode(parseSignature(sig).canonical)));
}
export function encodeCall(sig: string, values: readonly AbiValue[]): Uint8Array {
    const { types } = parseSignature(sig);
    return concat([functionSelector(sig), encodeSeq(types, [...values])]);
}
export function checksumAddress(a: string): string {
    const b = hexToBytes(a);
    if (b.length !== 20)
        throw new AbiError("an address is 20 bytes");
    const lower = bytesToHex(b).slice(2);
    const h = bytesToHex(keccak256(new TextEncoder().encode(lower))).slice(2);
    let out = "0x";
    for (let i = 0; i < 40; i++)
        out += parseInt(h[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    return out;
}
export function create2Address(p: {
    deployer: string;
    salt: string | Uint8Array;
    initCode?: string | Uint8Array;
    initCodeHash?: string | Uint8Array;
}): string {
    const salt = typeof p.salt === "string" ? hexToBytes(p.salt) : p.salt;
    if (salt.length !== 32)
        throw new AbiError("a salt is 32 bytes");
    const h = p.initCodeHash !== undefined ? asBytes(p.initCodeHash) : keccak256(asBytes(p.initCode ?? new Uint8Array()));
    return checksumAddress(bytesToHex(keccak256(concat([Uint8Array.of(255), hexToBytes(p.deployer), salt, h])).slice(12)));
}
