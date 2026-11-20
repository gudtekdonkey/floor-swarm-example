import { Address, bytesOfBase64, fromBoc, hexOf } from "./cell.ts";
import type { Cell } from "./cell.ts";
import type { TonChain } from "./types.ts";
import { TON_MAINNET, TON_INIT_CODES_BASE64, TON_PINNED_CODE_HASHES as GEN_HASHES } from "./consts.generated.ts";
export interface TonBook {
    network: "mainnet" | "testnet";
    globalId: -239 | -3;
    factory: Address;
    timelock: Address;
    deploySeqno?: number;
    codeHashes: Readonly<Record<"factory" | "timelock" | "launch" | "wallet" | "account" | "trader", string>>;
    initHashes: Readonly<Record<"launch" | "wallet" | "account" | "trader", string>>;
    codes: Readonly<{
        wallet: Cell;
        account: Cell;
        trader: Cell;
    }>;
    readAt: string;
}
export type TonCodePins = Readonly<{
    wallet: string;
    account: string;
    trader: string;
}>;
export { TON_PINNED_CODE_HASHES } from "./consts.generated.ts";
export class TonBookError extends Error {
    readonly field: string;
    readonly file: string;
    constructor(file: string, field: string, what: string) {
        super(`ton book ${file}: ${field}: ${what}`);
        this.name = "TonBookError";
        this.field = field;
        this.file = file;
    }
}
const HEX64 = /^[0-9a-fA-F]{64}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const HASH_NAMES = ["factory", "timelock", "launch", "wallet", "account", "trader"] as const;
const INIT_NAMES = ["launch", "account", "trader"] as const;
const CODE_NAMES = ["wallet", "account", "trader"] as const;
export function parseTonBook(json: unknown, opts: {
    file?: string;
    pins?: TonCodePins;
} = {}): TonBook {
    const file = opts.file ?? "<memory>";
    const pins: TonCodePins = opts.pins ?? GEN_HASHES;
    const fail = (field: string, what: string): never => {
        throw new TonBookError(file, field, what);
    };
    if (!isObj(json))
        return fail("(root)", "not a JSON object");
    if (json.chain !== "ton")
        fail("chain", "must be \"ton\"");
    const network = json.network;
    if (network !== "mainnet" && network !== "testnet")
        fail("network", `must be "mainnet" or "testnet", got "${String(network)}"`);
    const wantId = network === "mainnet" ? -239 : -3;
    if (json.globalId !== wantId)
        fail("globalId", `${wantId} expected for ${String(network)}, got ${String(json.globalId)}`);
    const rawAddr = (field: "factory" | "timelock"): Address => {
        const v = json[field];
        if (typeof v !== "string" || !/^0:[0-9a-fA-F]{64}$/.test(v))
            return fail(field, "not a workchain-0 raw address \"0:<64 hex>\"");
        return Address.parse(v);
    };
    const factory = rawAddr("factory");
    const timelock = rawAddr("timelock");
    let deploySeqno: number | undefined;
    if (json.deploySeqno !== undefined) {
        const d = json.deploySeqno;
        if (typeof d !== "number" || !Number.isInteger(d) || d < 1)
            fail("deploySeqno", "must be an integer of at least 1");
        deploySeqno = d as number;
    }
    const ra = json.readAt;
    const readAt = typeof ra === "string" ? ra : isObj(ra) && typeof ra.time === "string" ? ra.time : undefined;
    if (readAt === undefined || !Number.isFinite(Date.parse(readAt)))
        fail("readAt", "not an ISO timestamp (a string, or an object with \"time\")");
    const ch = json.codeHashes;
    const codeHashes: Record<string, string> = {};
    for (const n of HASH_NAMES) {
        const v = isObj(ch) ? ch[n] : undefined;
        if (typeof v !== "string" || !HEX64.test(v))
            fail(`codeHashes.${n}`, "not 64 hex");
        codeHashes[n] = (v as string).toLowerCase();
    }
    const init: Record<string, string> = {};
    const fi = json.familyInit;
    if (fi !== undefined) {
        for (const n of INIT_NAMES) {
            const v = isObj(fi) ? fi[n] : undefined;
            if (typeof v !== "string" || !HEX64.test(v))
                fail(`familyInit.${n}`, "not 64 hex");
            init[n] = (v as string).toLowerCase();
        }
    }
    const initHashes = {
        launch: init.launch ?? codeHashes.launch!,
        wallet: codeHashes.wallet!,
        account: init.account ?? codeHashes.account!,
        trader: init.trader ?? codeHashes.trader!,
    };
    const rawCodes = json.codes;
    if (rawCodes === undefined || rawCodes === null)
        fail("codes", "missing (a read-back book carries hashes only: add the three init code cells)");
    const cells: Record<string, Cell> = {};
    for (const n of CODE_NAMES) {
        const v = isObj(rawCodes) ? rawCodes[n] : undefined;
        let c: Cell | undefined;
        if (typeof v === "string") {
            try {
                c = fromBoc(bytesOfBase64(v));
            }
            catch {
                c = undefined;
            }
        }
        if (!c)
            return fail(`codes.${n}`, "not a base64 BoC with one root");
        cells[n] = c;
    }
    for (const n of CODE_NAMES) {
        const got = hexOf(cells[n]!.hash());
        if (got !== initHashes[n])
            fail(`codes.${n}`, `cell hash ${got} is not the book's ${n} init hash ${initHashes[n]}`);
    }
    for (const n of CODE_NAMES) {
        const got = hexOf(cells[n]!.hash());
        if (got !== pins[n].toLowerCase())
            fail(`codes.${n}`, `${got} is not the pinned ${n} init code hash ${pins[n]} (a child address would move)`);
    }
    return {
        network: network as "mainnet" | "testnet",
        globalId: wantId as -239 | -3,
        factory,
        timelock,
        ...(deploySeqno !== undefined ? { deploySeqno } : {}),
        codeHashes: codeHashes as TonBook["codeHashes"],
        initHashes,
        codes: { wallet: cells.wallet!, account: cells.account!, trader: cells.trader! },
        readAt: readAt as string,
    };
}
export function tonChainOf(book?: TonBook): TonChain {
    if (book)
        return { family: "ton", factory: book.factory, codes: { wallet: book.codes.wallet, account: book.codes.account, trader: book.codes.trader }, workchain: 0 };
    const m = TON_MAINNET;
    if (m.factory === null || m.timelock === null)
        throw new TonBookError("<built-in>", "factory", "TON mainnet factory is a placeholder (no deploy yet): pass a book, or regenerate the constants from the deploy output");
    const code = (n: "wallet" | "account" | "trader"): Cell => fromBoc(bytesOfBase64(TON_INIT_CODES_BASE64[n]));
    return { family: "ton", factory: Address.parse(m.factory), codes: { wallet: code("wallet"), account: code("account"), trader: code("trader") }, workchain: 0 };
}
