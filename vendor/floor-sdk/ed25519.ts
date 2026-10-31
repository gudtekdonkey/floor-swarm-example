const P = (1n << 255n) - 19n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
function modPow(b: bigint, e: bigint): bigint {
    let r = 1n;
    b %= P;
    while (e > 0n) {
        if (e & 1n)
            r = (r * b) % P;
        b = (b * b) % P;
        e >>= 1n;
    }
    return r;
}
export function isOnCurve(bytes: Uint8Array): boolean {
    if (bytes.length !== 32)
        throw new RangeError("a point is 32 bytes");
    let y = 0n;
    for (let i = 31; i >= 0; i--)
        y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 127 : bytes[i]);
    y %= P;
    const y2 = (y * y) % P;
    const u = (y2 - 1n + P) % P;
    const v = (D * y2 + 1n) % P;
    if (v === 0n)
        return u === 0n;
    if (u === 0n)
        return true;
    const ratio = (u * modPow(v, P - 2n)) % P;
    return modPow(ratio, (P - 1n) / 2n) === 1n;
}
