import { addressBytes, base58Encode } from "../../codec.ts";
export class Writer {
    private parts: number[] = [];
    uint(v: bigint | number, n: number): this {
        let x = BigInt(v);
        if (x < 0n || x >= 1n << BigInt(8 * n))
            throw new RangeError(`a ${8 * n}-bit value out of range: ${v}`);
        for (let i = 0; i < n; i++) {
            this.parts.push(Number(x & 0xffn));
            x >>= 8n;
        }
        return this;
    }
    u8 = (v: number): this => this.uint(v, 1);
    u16 = (v: number): this => this.uint(v, 2);
    u32 = (v: number): this => this.uint(v, 4);
    u64 = (v: bigint): this => this.uint(v, 8);
    u128 = (v: bigint): this => this.uint(v, 16);
    bool = (v: boolean): this => this.u8(v ? 1 : 0);
    pubkey = (a: string): this => this.bytes(addressBytes(a));
    bytes(b: Uint8Array): this {
        for (const x of b)
            this.parts.push(x);
        return this;
    }
    string(s: string): this {
        const b = new TextEncoder().encode(s);
        return this.u32(b.length).bytes(b);
    }
    done(): Uint8Array {
        return Uint8Array.from(this.parts);
    }
}
export class Reader {
    o = 0;
    readonly b: Uint8Array;
    constructor(b: Uint8Array) {
        this.b = b;
    }
    uint(n: number): bigint {
        if (this.o + n > this.b.length)
            throw new RangeError("borsh: data too short");
        let v = 0n;
        for (let i = n - 1; i >= 0; i--)
            v = (v << 8n) | BigInt(this.b[this.o + i]);
        this.o += n;
        return v;
    }
    u8 = (): number => Number(this.uint(1));
    u16 = (): number => Number(this.uint(2));
    u32 = (): number => Number(this.uint(4));
    u64 = (): bigint => this.uint(8);
    i64 = (): bigint => {
        const v = this.uint(8);
        return v >= 1n << 63n ? v - (1n << 64n) : v;
    };
    u128 = (): bigint => this.uint(16);
    bool = (): boolean => this.u8() !== 0;
    bytes(n: number): Uint8Array {
        if (this.o + n > this.b.length)
            throw new RangeError("borsh: data too short");
        const r = this.b.slice(this.o, this.o + n);
        this.o += n;
        return r;
    }
    pubkey = (): string => base58Encode(this.bytes(32));
}
