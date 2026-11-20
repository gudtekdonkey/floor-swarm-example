import { crc32 } from "./cell.ts";
export const STD_OP = {
    transfer: 260734629,
    internal_transfer: 395134233,
    transfer_notification: 1935855772,
    excesses: 3576854235,
    burn: 1499400124,
    burn_notification: 2078119902,
    provide_wallet_address: 745978227,
    take_wallet_address: 3513996288,
    provide_wallet_balance: 2059982169,
    take_wallet_balance: 3396861378,
} as const;
const memo = new Map<string, number>();
export function op(name: string): number {
    let v = memo.get(name);
    if (v === undefined) {
        v = crc32("floor." + name);
        memo.set(name, v);
    }
    return v;
}
export function logTag(name: string): number {
    const k = "log:" + name;
    let v = memo.get(k);
    if (v === undefined) {
        v = crc32("floor.log." + name);
        memo.set(k, v);
    }
    return v;
}
