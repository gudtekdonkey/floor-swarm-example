import type { TonBook } from "./book.ts";
import { getFamily, getTimelockInfo } from "./reader.ts";
import type { TonRpc } from "./reader.ts";
export const TON_FAMILY = { factory: 0, launch: 1, wallet: 2, account: 3, trader: 4 } as const;
const hex = (n: bigint): string => n.toString(16).padStart(64, "0");
export async function checkTonBookOnChain(rpc: TonRpc, book: TonBook): Promise<string[]> {
    const out: string[] = [];
    for (const name of ["launch", "wallet", "account", "trader"] as const) {
        const f = await getFamily(rpc, book.factory, TON_FAMILY[name]);
        if (f.initHash === 0n) {
            out.push(`family ${name}: not set on chain`);
            continue;
        }
        if (hex(f.codeHash) !== book.codeHashes[name])
            out.push(`family ${name}: chain code ${hex(f.codeHash)} is not the book's ${book.codeHashes[name]}`);
        if (hex(f.initHash) !== book.initHashes[name])
            out.push(`family ${name}: chain init ${hex(f.initHash)} is not the book's ${book.initHashes[name]}`);
    }
    const t = await getTimelockInfo(rpc, book.timelock);
    if (!t.factory || !t.factory.equals(book.factory))
        out.push(`timelock: factory ${t.factory ? t.factory.toRaw() : "none"} is not the book's ${book.factory.toRaw()}`);
    return out;
}
