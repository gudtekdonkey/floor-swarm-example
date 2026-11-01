const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));
export function base58Encode(bytes: Uint8Array): string {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0)
        zeros++;
    let n = 0n;
    for (const b of bytes)
        n = (n << 8n) | BigInt(b);
    let out = "";
    while (n > 0n) {
        out = ALPHABET[Number(n % 58n)] + out;
        n /= 58n;
    }
    return "1".repeat(zeros) + out;
}
export function base58Decode(s: string): Uint8Array {
    let zeros = 0;
    while (zeros < s.length && s[zeros] === "1")
        zeros++;
    let n = 0n;
    for (const c of s) {
        const v = INDEX.get(c);
        if (v === undefined)
            throw new RangeError(`not base58: ${JSON.stringify(c)}`);
        n = n * 58n + BigInt(v);
    }
    const body: number[] = [];
    while (n > 0n) {
        body.unshift(Number(n & 0xffn));
        n >>= 8n;
    }
    return Uint8Array.from([...new Array<number>(zeros).fill(0), ...body]);
}
export function addressBytes(address: string): Uint8Array {
    const b = base58Decode(address);
    if (b.length !== 32)
        throw new RangeError(`not a 32-byte address: ${address}`);
    return b;
}
export function hex(bytes: Uint8Array): string {
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
export function readUintLE(b: Uint8Array, off: number, len: number): bigint {
    if (off + len > b.length)
        throw new RangeError(`read past the end: ${off}+${len} > ${b.length}`);
    let v = 0n;
    for (let i = len - 1; i >= 0; i--)
        v = (v << 8n) | BigInt(b[off + i]);
    return v;
}
export function readI32LE(b: Uint8Array, off: number): number {
    return Number(BigInt.asIntN(32, readUintLE(b, off, 4)));
}
export function uintLE(v: bigint, len: number): Uint8Array {
    if (v < 0n || v >> BigInt(8 * len) !== 0n)
        throw new RangeError(`${v} does not fit ${len} bytes`);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++)
        out[i] = Number((v >> BigInt(8 * i)) & 0xffn);
    return out;
}
export function i32LE(v: number): Uint8Array {
    if (!Number.isInteger(v) || v < -(2 ** 31) || v >= 2 ** 31)
        throw new RangeError(`${v} is not an i32`);
    return uintLE(BigInt.asUintN(32, BigInt(v)), 4);
}
