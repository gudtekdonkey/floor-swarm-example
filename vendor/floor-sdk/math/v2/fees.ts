import { log2X64 } from "../fixed.ts";
import { DOWN, U128_MAX, UP, mulDiv } from "./wide.ts";
export const FEE_LEGS = 5;
export const FEE_DEFAULT_PPM = 100;
export const DEFAULT_FEE_PPM: readonly number[] = [100, 100, 100, 100, 100];
export const LEG_BACKING = 0;
export const LEG_TEAM = 1;
export const LEG_PLATFORM = 2;
export const LEG_FLOOR = 3;
export const LEG_HOLDER = 4;
const PPM = 1000000n;
export const feeLeg = (amount: bigint, ppm: number): bigint => mulDiv(amount, BigInt(ppm), PPM, UP) ?? amount;
export const feeLegs = (amount: bigint, ppm: readonly number[]): bigint[] => ppm.map((p) => feeLeg(amount, p));
export const feeTotal = (f: readonly bigint[]): bigint => f.reduce((a, b) => (a + b > U128_MAX ? U128_MAX : a + b), 0n);
export function ppmAt(end: readonly number[], start: readonly number[], sqrtA: bigint, sqrtB: bigint, sqrtP: bigint): number[] {
    if (sqrtB === 0n || sqrtP >= sqrtB)
        return [...end];
    if (sqrtP <= sqrtA)
        return [...start];
    const lg = (x: bigint): bigint => log2X64(x) ?? 0n;
    const [la, lb, lp] = [lg(sqrtA), lg(sqrtB), lg(sqrtP)];
    const one = 1n << 64n;
    let w = 0n;
    if (lb > la) {
        const q = mulDiv(lb > lp ? lb - lp : 0n, one, lb - la, DOWN) ?? 0n;
        w = q > one ? one : q;
    }
    return end.map((e, i) => {
        const x = BigInt(start[i]) * w + BigInt(e) * (one - w);
        return Number((x + one - 1n) / one);
    });
}
export const PREGRAD_PPM: readonly number[] = [0, 0, 4000, 1000, 0];
export function ratesAt(graduated: boolean, own: boolean, end: readonly number[], start: readonly number[], sqrtA: bigint, sqrtB: bigint, sqrtP: bigint): number[] {
    if (!graduated && !own)
        return [...PREGRAD_PPM];
    return ppmAt(end, start, sqrtA, sqrtB, sqrtP);
}
export const cheaper = (a: readonly number[], b: readonly number[]): number[] => a.map((x, i) => Math.min(x, b[i]));
export class FeeAcc {
    readonly pre: number[];
    whole: bigint[] = [0n, 0n, 0n, 0n, 0n];
    rem: bigint[] = [0n, 0n, 0n, 0n, 0n];
    constructor(pre: readonly number[]) {
        this.pre = [...pre];
    }
    add(q: bigint, at: readonly number[]): boolean {
        const [qh, ql] = [q / PPM, q % PPM];
        const w = [...this.whole];
        const r2 = [...this.rem];
        for (let i = 0; i < FEE_LEGS; i++) {
            const r = BigInt(Math.min(this.pre[i], at[i]));
            const lo = ql * r;
            const rem = r2[i] + (lo % PPM);
            const x = w[i] + qh * r + lo / PPM + rem / PPM;
            if (x > U128_MAX)
                return false;
            w[i] = x;
            r2[i] = rem % PPM;
        }
        this.whole = w;
        this.rem = r2;
        return true;
    }
    legs(): bigint[] {
        return this.whole.map((x, i) => {
            const v = x + (this.rem[i] > 0n ? 1n : 0n);
            return v > U128_MAX ? U128_MAX : v;
        });
    }
}
export function grossForNet(net: bigint, ppm: readonly number[]): bigint | null {
    const g = net + feeTotal(feeLegs(net, ppm));
    return g > U128_MAX ? null : g;
}
export function netFromGross(gross: bigint, ppm: readonly number[]): bigint {
    const sum = ppm.reduce((a, p) => a + BigInt(p), 0n);
    let net = mulDiv(gross, PPM, PPM + sum, DOWN) ?? 0n;
    for (;;) {
        if (net >= gross)
            break;
        const g = grossForNet(net + 1n, ppm);
        if (g === null || g > gross)
            break;
        net++;
    }
    for (;;) {
        if (net <= 0n)
            break;
        const g = grossForNet(net, ppm);
        if (g !== null && g <= gross)
            break;
        net--;
    }
    return net;
}
export const TRADER_REF_BPS: readonly [
    number,
    number,
    number
] = [3000, 2000, 1000];
export const CREATOR_REF_BPS: readonly [
    number,
    number,
    number
] = [900, 90, 10];
export function slices(fee: bigint, present: readonly boolean[], bps: readonly number[]): [
    bigint[],
    bigint
] {
    const out = [0n, 0n, 0n];
    let left = fee;
    for (let i = 0; i < 3; i++) {
        if (!present[i] || bps[i] === 0)
            continue;
        let s = (fee * BigInt(bps[i])) / 10000n;
        if (s > left)
            s = left;
        out[i] = s;
        left -= s;
    }
    return [out, left];
}
export const platformLegs = (platform: bigint, traderPresent: readonly boolean[]): [
    bigint[],
    bigint
] => slices(platform, traderPresent, TRADER_REF_BPS);
export const creatorLegs = (creator: bigint, creatorPresent: readonly boolean[]): [
    bigint[],
    bigint
] => slices(creator, creatorPresent, CREATOR_REF_BPS);
