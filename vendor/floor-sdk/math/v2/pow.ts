type DD = [
    number,
    number
];
const SPLIT = 134217729;
function twoSum(a: number, b: number): DD {
    const s = a + b;
    const bb = s - a;
    return [s, (a - (s - bb)) + (b - bb)];
}
function twoProd(a: number, b: number): DD {
    const p = a * b;
    let t = SPLIT * a;
    const ah = t - (t - a);
    const al = a - ah;
    t = SPLIT * b;
    const bh = t - (t - b);
    const bl = b - bh;
    return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
}
function add(x: DD, y: DD): DD {
    const [s, e] = twoSum(x[0], y[0]);
    return twoSum(s, e + x[1] + y[1]);
}
function mul(x: DD, y: DD): DD {
    const [p, e] = twoProd(x[0], y[0]);
    return twoSum(p, e + (x[0] * y[1] + x[1] * y[0]));
}
function divN(x: DD, n: number): DD {
    const q = x[0] / n;
    const [p, e] = twoProd(q, n);
    return twoSum(q, (x[0] - p - e + x[1]) / n);
}
const LN2: DD = [0.6931471805599453, 2.3190468138462996e-17];
function expDD(x: DD): DD {
    const n = Math.round(x[0] / LN2[0]);
    let r = add(x, mul(LN2, [-n, 0]));
    r = [r[0] / 1024, r[1] / 1024];
    let sum: DD = [1, 0];
    let term: DD = [1, 0];
    for (let i = 1; i <= 14; i++) {
        term = divN(mul(term, r), i);
        sum = add(sum, term);
    }
    for (let i = 0; i < 10; i++)
        sum = mul(sum, sum);
    const s = Math.pow(2, n);
    return [sum[0] * s, sum[1] * s];
}
function lnDD(x: number): DD {
    let y: DD = [Math.log(x), 0];
    for (let i = 0; i < 2; i++) {
        const e = expDD([-y[0], -y[1]]);
        y = add(y, add(mul([x, 0], e), [-1, 0]));
    }
    return y;
}
export function pow(x: number, y: number): number {
    if (y === 0 || x === 1)
        return 1;
    if (!(x > 0) || !Number.isFinite(x) || !Number.isFinite(y))
        return Math.pow(x, y);
    const r = expDD(mul(lnDD(x), [y, 0]));
    return r[0] + r[1];
}
