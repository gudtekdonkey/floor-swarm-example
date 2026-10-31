import { hex } from "../codec.ts";
import { EVENT_IX_TAG_LE, eventDiscriminator } from "../solana/instruction.ts";
import { Reader, Writer } from "../solana/floor/borsh.ts";
type F = "pubkey" | "bool" | "u8" | "u32" | "u64" | "i64" | "u128" | "u64[4]" | "u64[5]" | "bytes:10" | "bytes:32";
const S = (...f: [
    string,
    F
][]): [
    string,
    F
][] => f;
export const EVENTS_V2: Record<string, [
    string,
    F
][]> = {
    LaunchCreatedV2: S(["launch", "pubkey"], ["mint", "pubkey"], ["quoteMint", "pubkey"], ["creator", "pubkey"], ["id", "u64"], ["presetId", "u8"], ["presetVersion", "u32"], ["presetHash", "bytes:32"], ["p0X64", "u128"], ["raise", "u64"], ["windowTokens", "u64"], ["creatorBuyTokens", "u64"], ["createFee", "u64"], ["name", "bytes:32"], ["symbol", "bytes:10"], ["slot", "u64"], ["ts", "i64"], ["listed", "bool"], ["quoteUsdCentsX64", "u128"], ["nativeCreateFee", "u64"], ["rowVersion", "u8"], ["sqrtP0", "u128"]),
    Trade: S(["launch", "pubkey"], ["trader", "pubkey"], ["isBuy", "bool"], ["quoteGross", "u64"], ["quoteNet", "u64"], ["refund", "u64"], ["tokens", "u64"], ["fees", "u64[5]"], ["traderRef", "u64"], ["fromResale", "u64"], ["fromFirst", "u64"], ["unfilled", "u64"], ["sqrtBefore", "u128"], ["sqrtAfter", "u128"], ["sqrtF", "u128"], ["floor", "u64"], ["cushion", "u64"], ["sCirc", "u64"], ["steps", "u8"], ["budgetHit", "bool"], ["slot", "u64"], ["ts", "i64"], ["kind", "u8"], ["creatorRef", "u64"], ["recipient", "pubkey"], ["bidMoney", "u64"], ["msPaid", "u64[4]"]),
    HolderPositionOpened: S(["launch", "pubkey"], ["owner", "pubkey"], ["amount", "u64"]),
    HolderPositionClosed: S(["launch", "pubkey"], ["owner", "pubkey"], ["amount", "u64"], ["paid", "u64"]),
    HolderIndexRolled: S(["launch", "pubkey"], ["index", "u128"], ["wMatured", "u64"], ["wPending", "u64"], ["carry", "u64"]),
    DeadSynced: S(["launch", "pubkey"], ["added", "u64"], ["deadTokens", "u64"], ["sCirc", "u64"]),
};
EVENTS_V2.GenesisRaiseBought = EVENTS_V2.Trade;
export const TRADE_KIND_ORDINARY = 0;
export const TRADE_KIND_TEAM_BUY = 1;
export const TRADE_KIND_TEAM_SHARE_BUY = 2;
export const TRADE_KIND_GENESIS_RAISE = 3;
export const TRADE_KIND_GENESIS_SHARE = 4;
export const TRADE_KIND_GENESIS_OVERFLOW = 5;
export const TRADE_KIND_GENESIS_OVERFLOW_SHARE = 6;
export const isPersonTradeV2 = (kind: number | undefined): boolean => kind !== TRADE_KIND_GENESIS_RAISE && kind !== TRADE_KIND_GENESIS_OVERFLOW;
export const movesBookV2 = (kind: number | undefined): boolean => kind !== TRADE_KIND_GENESIS_SHARE && kind !== TRADE_KIND_GENESIS_OVERFLOW_SHARE;
export const FEE_LEGS_V2 = ["backing", "team", "platform", "floor", "holder"] as const;
export const MS_CLASSES_V2 = ["team", "holder", "platform", "floor"] as const;
let disc: Map<string, string> | undefined;
const PRE_CUTOVER: [
    string,
    string
][] = [["TradeV2", "Trade"]];
const DISC = (): Map<string, string> => (disc ??= new Map([...Object.keys(EVENTS_V2).map((n): [
        string,
        string
    ] => [hex(eventDiscriminator(n)), n]), ...PRE_CUTOVER.map(([a, n]): [
        string,
        string
    ] => [hex(eventDiscriminator(a)), n])]));
function read(r: Reader, t: F): unknown {
    const bm = /^bytes:(\d+)$/.exec(t);
    if (bm)
        return r.bytes(Number(bm[1]));
    const m = /^u64\[(\d)\]$/.exec(t);
    if (m)
        return Array.from({ length: Number(m[1]) }, () => r.u64());
    return (r as any)[t]();
}
function write(w: Writer, t: F, v: any): void {
    const bm = /^bytes:(\d+)$/.exec(t);
    if (bm) {
        if (v.length !== Number(bm[1]))
            throw new RangeError(`${t}: ${v.length} bytes`);
        w.bytes(v);
        return;
    }
    const m = /^u64\[(\d)\]$/.exec(t);
    if (m) {
        if (v.length !== Number(m[1]))
            throw new RangeError(`${t}: ${v.length} values`);
        for (const x of v)
            w.u64(x);
    }
    else if (t === "i64")
        w.uint(BigInt.asUintN(64, v), 8);
    else
        (w as any)[t](v);
}
export interface FloorEventV2 {
    name: string;
    fields: Record<string, any>;
}
export function decodeEventDataV2(data: Uint8Array): FloorEventV2 | null {
    const name = DISC().get(hex(data.slice(0, 8)));
    if (!name)
        return null;
    const r = new Reader(data.slice(8));
    const fields: Record<string, any> = {};
    for (const [f, t] of EVENTS_V2[name])
        fields[f] = read(r, t);
    if (r.o !== r.b.length)
        throw new RangeError(`${name}: ${r.b.length} body bytes, the schema reads ${r.o}`);
    return { name, fields };
}
export function encodeEventDataV2(e: FloorEventV2): Uint8Array {
    const w = new Writer().bytes(eventDiscriminator(e.name));
    for (const [f, t] of EVENTS_V2[e.name] ?? [])
        write(w, t, e.fields[f]);
    return w.done();
}
export function decodeEventCpiV2(ixData: Uint8Array): FloorEventV2 | null {
    if (ixData.length < 16 || hex(ixData.slice(0, 8)) !== hex(EVENT_IX_TAG_LE))
        return null;
    return decodeEventDataV2(ixData.slice(8));
}
export interface PlatformWithdrawalV2 {
    launch: string;
    platform: bigint;
    cut: bigint;
    paid: bigint;
    platformOwedAfter: bigint;
    cutOwedAfter: bigint;
}
export function platformWithdrawalsV2(events: readonly {
    name: string;
    fields: Record<string, any>;
}[]): PlatformWithdrawalV2[] {
    const by = new Map<string, PlatformWithdrawalV2>();
    const row = (launch: string) => {
        let r = by.get(launch);
        if (!r)
            by.set(launch, (r = { launch, platform: 0n, cut: 0n, paid: 0n, platformOwedAfter: 0n, cutOwedAfter: 0n }));
        return r;
    };
    for (const e of events) {
        if (e.name === "PlatformWithdrawn") {
            const r = row(e.fields.launch);
            r.platform += e.fields.amount;
            r.platformOwedAfter = e.fields.owedAfter;
        }
        else if (e.name === "CutWithdrawn") {
            const r = row(e.fields.launch);
            r.cut += e.fields.amount;
            r.cutOwedAfter = e.fields.cutOwedAfter;
        }
    }
    for (const r of by.values())
        r.paid = r.platform + r.cut;
    return [...by.values()];
}
