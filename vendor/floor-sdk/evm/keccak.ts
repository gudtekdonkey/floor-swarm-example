const RC_HI = new Uint32Array(24);
const RC_LO = new Uint32Array(24);
{
    let r = 1;
    for (let i = 0; i < 24; i++) {
        let hi = 0;
        let lo = 0;
        for (let j = 0; j < 7; j++) {
            r = ((r << 1) ^ ((r >> 7) * 113)) & 255;
            if (r & 2) {
                const bit = (1 << j) - 1;
                if (bit < 32)
                    lo ^= 1 << bit;
                else
                    hi ^= 1 << (bit - 32);
            }
        }
        RC_HI[i] = hi >>> 0;
        RC_LO[i] = lo >>> 0;
    }
}
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const bh = new Uint32Array(25);
const bl = new Uint32Array(25);
const ch = new Uint32Array(5);
const cl = new Uint32Array(5);
function keccakF(s: Uint32Array): void {
    for (let round = 0; round < 24; round++) {
        for (let x = 0; x < 5; x++) {
            ch[x] = s[2 * x] ^ s[2 * (x + 5)] ^ s[2 * (x + 10)] ^ s[2 * (x + 15)] ^ s[2 * (x + 20)];
            cl[x] = s[2 * x + 1] ^ s[2 * (x + 5) + 1] ^ s[2 * (x + 10) + 1] ^ s[2 * (x + 15) + 1] ^ s[2 * (x + 20) + 1];
        }
        for (let x = 0; x < 5; x++) {
            const h1 = ch[(x + 1) % 5];
            const l1 = cl[(x + 1) % 5];
            const dh = ch[(x + 4) % 5] ^ ((h1 << 1) | (l1 >>> 31));
            const dl = cl[(x + 4) % 5] ^ ((l1 << 1) | (h1 >>> 31));
            for (let y = 0; y < 25; y += 5) {
                s[2 * (x + y)] ^= dh;
                s[2 * (x + y) + 1] ^= dl;
            }
        }
        for (let x = 0; x < 5; x++) {
            for (let y = 0; y < 5; y++) {
                const i = x + 5 * y;
                const h = s[2 * i];
                const l = s[2 * i + 1];
                const r = ROT[i];
                let rh: number;
                let rl: number;
                if (r === 0) {
                    rh = h;
                    rl = l;
                }
                else if (r < 32) {
                    rh = (h << r) | (l >>> (32 - r));
                    rl = (l << r) | (h >>> (32 - r));
                }
                else if (r === 32) {
                    rh = l;
                    rl = h;
                }
                else {
                    rh = (l << (r - 32)) | (h >>> (64 - r));
                    rl = (h << (r - 32)) | (l >>> (64 - r));
                }
                const j = y + 5 * ((2 * x + 3 * y) % 5);
                bh[j] = rh;
                bl[j] = rl;
            }
        }
        for (let y = 0; y < 25; y += 5) {
            for (let x = 0; x < 5; x++) {
                s[2 * (x + y)] = bh[x + y] ^ (~bh[((x + 1) % 5) + y] & bh[((x + 2) % 5) + y]);
                s[2 * (x + y) + 1] = bl[x + y] ^ (~bl[((x + 1) % 5) + y] & bl[((x + 2) % 5) + y]);
            }
        }
        s[0] ^= RC_HI[round];
        s[1] ^= RC_LO[round];
    }
}
export function keccak256(data: Uint8Array): Uint8Array {
    return sponge256(data, 1);
}
export function sponge256(data: Uint8Array, pad: number): Uint8Array {
    const rate = 136;
    const s = new Uint32Array(50);
    const padded = new Uint8Array(Math.floor(data.length / rate) * rate + rate);
    padded.set(data);
    padded[data.length] ^= pad;
    padded[padded.length - 1] ^= 128;
    for (let off = 0; off < padded.length; off += rate) {
        for (let i = 0; i < rate / 8; i++) {
            const o = off + 8 * i;
            const lo = padded[o] | (padded[o + 1] << 8) | (padded[o + 2] << 16) | (padded[o + 3] << 24);
            const hi = padded[o + 4] | (padded[o + 5] << 8) | (padded[o + 6] << 16) | (padded[o + 7] << 24);
            s[2 * i] ^= hi;
            s[2 * i + 1] ^= lo;
        }
        keccakF(s);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) {
        const hi = s[2 * i];
        const lo = s[2 * i + 1];
        for (let b = 0; b < 4; b++) {
            out[8 * i + b] = (lo >>> (8 * b)) & 255;
            out[8 * i + 4 + b] = (hi >>> (8 * b)) & 255;
        }
    }
    return out;
}
