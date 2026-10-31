import { addressBytes, base58Encode, hex } from "../../codec.ts";
import { accountDiscriminator } from "../instruction.ts";
type FieldType = string;
export type Layout = readonly (readonly [
    name: string,
    type: FieldType
])[];
export const SLOT_MEMBER: Layout = [
    ["key", "bytes:32"],
    ["kind", "u8"],
    ["state", "u8"],
    ["pad", "bytes:6"],
    ["paid", "u64"],
    ["requested", "u64"],
    ["earned", "u64"],
    ["withdrawn", "u64"],
    ["reserved", "bytes:8"],
];
export const CONFIG: Layout = [
    ["version", "u8"],
    ["bump", "u8"],
    ["create_paused", "u8"],
    ["next_preset_id", "u8"],
    ["pad0", "bytes:4"],
    ["authority", "pubkey"],
    ["pending_authority", "pubkey"],
    ["timelock", "pubkey"],
    ["referral_authority", "pubkey"],
    ["launch_count", "u64"],
    ["holder_dest", "pubkey"],
    ["native_create_fee", "u64"],
    ["native_fees_owed", "u64"],
    ["metadata_base", "bytes:72"],
    ["metadata_base_len", "u8"],
    ["pad_metadata_base_len", "bytes:7"],
    ["treasury", "pubkey"],
    ["price_updater", "pubkey"],
];
export const QUOTE_ENTRY: Layout = [
    ["version", "u8"],
    ["bump", "u8"],
    ["enabled", "u8"],
    ["decimals", "u8"],
    ["pad0", "bytes:4"],
    ["mint", "pubkey"],
    ["token_program", "pubkey"],
    ["create_fee", "u64"],
    ["usd_cents_x64", "u128l"],
    ["launches", "u64"],
    ["updated_at", "i64"],
    ["admitted_caps", "u32"],
    ["pad1", "u32"],
    ["reserved", "bytes:56"],
];
export const TEAM_SLOT: Layout = [
    ["version", "u8"],
    ["bump", "u8"],
    ["member_count", "u8"],
    ["flags", "u8"],
    ["rate_bps", "u16"],
    ["pad0", "bytes:2"],
    ["price", "u64"],
    ["bought", "u64"],
    ["reserved_total", "u64"],
    ["opened_at", "i64"],
    ["launch", "pubkey"],
    ["creator", "pubkey"],
    ["members", "SlotMember[10]"],
    ["reserved", "bytes:64"],
];
export const TRADER_REF: Layout = [
    ["trader", "pubkey"],
    ["quote_mint", "pubkey"],
    ["tiers", "pubkey[3]"],
    ["owed", "u64[3]"],
    ["rolled", "u64[3]"],
    ["bump", "u8"],
    ["escrow_bump", "u8"],
    ["revoked", "u8"],
    ["pad0", "bytes:5"],
    ["reserved", "bytes:24"],
];
export const TRADER_LINK: Layout = [
    ["wallet", "pubkey"],
    ["tiers", "pubkey[3]"],
    ["bump", "u8"],
    ["reserved", "bytes:24"],
];
export const REF_OWED: Layout = [
    ["referrer", "pubkey"],
    ["quote_mint", "pubkey"],
    ["owed", "u64"],
    ["paid", "u64"],
    ["bump", "u8"],
    ["pad0", "bytes:7"],
    ["reserved", "bytes:24"],
];
export const GENESIS_RAISE: Layout = [
    ["version", "u8"],
    ["bump", "u8"],
    ["accepted", "u8"],
    ["vault_bump", "u8"],
    ["count", "u16"],
    ["pad0", "bytes:2"],
    ["old_sale", "pubkey"],
    ["total_migrated", "u64"],
    ["donation", "u64"],
    ["accepted_at", "i64"],
    ["accepted_slot", "u64"],
    ["preset_id", "u8"],
    ["opened", "u8"],
    ["pad1", "bytes:6"],
    ["cap", "u64"],
    ["ends_at", "i64"],
    ["migrated_refunded", "u64"],
    ["phase3_total", "u64"],
    ["raised_final", "u64"],
    ["tokens_out", "u64"],
    ["tokens_claimed", "u64"],
    ["weight_total", "u64"],
    ["launch", "pubkey"],
    ["base_mint", "pubkey"],
    ["deployer", "pubkey"],
    ["refund_total", "u64"],
    ["refund_claimed", "u64"],
    ["credit_claimed", "u64"],
    ["refund_owed", "u64"],
    ["refund_dust", "u64"],
    ["creator", "pubkey"],
    ["list_root", "bytes:32"],
    ["listed_reserve", "u64"],
    ["listed_total", "u64"],
    ["wagmi_preset_id", "u8"],
    ["wagmi_opened", "u8"],
    ["pad2", "bytes:6"],
    ["usdc_converted", "u64"],
    ["sol_unconverted", "u64"],
    ["wagmi_usdc", "u64"],
    ["wagmi_floor_in", "u64"],
    ["wagmi_floor_refund", "u64"],
    ["wagmi_floor_refund_claimed", "u64"],
    ["wagmi_tokens_out", "u64"],
    ["wagmi_tokens_claimed", "u64"],
    ["wagmi_launch", "pubkey"],
    ["wagmi_mint", "pubkey"],
    ["sol_converted", "u64"],
    ["floor_usdc_in", "u64"],
    ["usdc_refund_total", "u64"],
    ["usdc_refund_claimed", "u64"],
    ["usdc_refund_owed", "u64"],
    ["usdc_excess", "u64"],
    ["wagmi_credit_claimed", "u64"],
    ["wagmi_floor_dust", "u64"],
    ["wagmi_cap_tokens", "u64"],
    ["wagmi_over_cap_floor", "u64"],
    ["wagmi_over_cap_out", "u64"],
    ["wagmi_buy_fees", "u64[5]"],
];
export const GENESIS_ALLOCATION: Layout = [
    ["wallet", "pubkey"],
    ["contributed", "u64"],
    ["claimed_tokens", "u64"],
    ["refunded", "u64"],
    ["bump", "u8"],
    ["flags", "u8"],
    ["pad0", "bytes:6"],
    ["migrated", "u64"],
    ["raise_refund", "u64"],
    ["refund_owed", "u64"],
    ["listed_old", "u64"],
    ["listed", "u64"],
    ["wagmi_claimed", "u64"],
    ["usdc_refund", "u64"],
    ["usdc_owed", "u64"],
];
export const GENESIS_ALLOC_MIGRATED = 1;
export const GENESIS_ALLOC_REFUNDED = 2;
export const GENESIS_ALLOC_CLAIMED = 4;
export const GENESIS_ALLOC_WAGMI_CLAIMED = 8;
const NESTED: Record<string, Layout> = { SlotMember: SLOT_MEMBER };
export const LAYOUTS = { Config: CONFIG, QuoteEntry: QUOTE_ENTRY, TeamSlot: TEAM_SLOT, SlotMember: SLOT_MEMBER, TraderRef: TRADER_REF, TraderLink: TRADER_LINK, RefOwed: REF_OWED, GenesisRaise: GENESIS_RAISE, GenesisAllocation: GENESIS_ALLOCATION } as const;
function scalarSize(t: string): number {
    switch (t) {
        case "u8":
            return 1;
        case "u16":
            return 2;
        case "u32":
            return 4;
        case "u64":
        case "i64":
            return 8;
        case "u128l":
            return 16;
        case "pubkey":
            return 32;
    }
    if (t.startsWith("bytes:"))
        return Number(t.slice(6));
    if (t in NESTED)
        return layoutSize(NESTED[t]);
    throw new Error(`unknown field type ${t}`);
}
export function fieldSize(t: FieldType): number {
    const m = /^(.+)\[(\d+)\]$/.exec(t);
    return m ? scalarSize(m[1]) * Number(m[2]) : scalarSize(t);
}
export function layoutOffsets(l: Layout): [
    string,
    number,
    number
][] {
    let o = 0;
    return l.map(([n, t]) => {
        const s = fieldSize(t);
        const r: [
            string,
            number,
            number
        ] = [n, o, s];
        o += s;
        return r;
    });
}
export function layoutSize(l: Layout): number {
    return l.reduce((a, [, t]) => a + fieldSize(t), 0);
}
const camel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
function readUint(b: Uint8Array, o: number, n: number): bigint {
    let v = 0n;
    for (let i = n - 1; i >= 0; i--)
        v = (v << 8n) | BigInt(b[o + i]);
    return v;
}
function readScalar(b: Uint8Array, o: number, t: string): unknown {
    switch (t) {
        case "u8":
        case "u16":
        case "u32":
            return Number(readUint(b, o, scalarSize(t)));
        case "u64":
            return readUint(b, o, 8);
        case "i64": {
            const v = readUint(b, o, 8);
            return v >= 1n << 63n ? v - (1n << 64n) : v;
        }
        case "u128l":
            return readUint(b, o, 16);
        case "pubkey":
            return base58Encode(b.slice(o, o + 32));
    }
    if (t.startsWith("bytes:"))
        return b.slice(o, o + Number(t.slice(6)));
    if (t in NESTED)
        return decodeStruct(NESTED[t], b, o);
    throw new Error(`unknown field type ${t}`);
}
export function decodeStruct(l: Layout, b: Uint8Array, o = 0): Record<string, any> {
    const out: Record<string, any> = {};
    let at = o;
    for (const [n, t] of l) {
        const m = /^(.+)\[(\d+)\]$/.exec(t);
        if (m) {
            const s = scalarSize(m[1]);
            out[camel(n)] = Array.from({ length: Number(m[2]) }, (_, i) => readScalar(b, at + i * s, m[1]));
        }
        else
            out[camel(n)] = readScalar(b, at, t);
        at += fieldSize(t);
    }
    return out;
}
function writeScalar(b: Uint8Array, o: number, t: string, v: any): void {
    if (v === undefined)
        return;
    if (t === "pubkey") {
        b.set(addressBytes(v), o);
        return;
    }
    if (t.startsWith("bytes:")) {
        b.set(v, o);
        return;
    }
    if (t in NESTED) {
        encodeStructInto(NESTED[t], v, b, o);
        return;
    }
    const n = scalarSize(t);
    let x = BigInt(v);
    if (t === "i64" && x < 0n)
        x += 1n << 64n;
    for (let i = 0; i < n; i++) {
        b[o + i] = Number(x & 0xffn);
        x >>= 8n;
    }
}
function encodeStructInto(l: Layout, v: Record<string, any>, b: Uint8Array, o: number): void {
    let at = o;
    for (const [n, t] of l) {
        const x = v[camel(n)];
        const m = /^(.+)\[(\d+)\]$/.exec(t);
        if (m && x !== undefined) {
            const s = scalarSize(m[1]);
            (x as any[]).forEach((e, i) => writeScalar(b, at + i * s, m[1], e));
        }
        else if (!m)
            writeScalar(b, at, t, x);
        at += fieldSize(t);
    }
}
export function encodeStruct(l: Layout, v: Record<string, any>): Uint8Array {
    const b = new Uint8Array(layoutSize(l));
    encodeStructInto(l, v, b, 0);
    return b;
}
export function encodeAccount(name: keyof typeof LAYOUTS, v: Record<string, any>): Uint8Array {
    const l = LAYOUTS[name];
    const b = new Uint8Array(8 + layoutSize(l));
    if (name !== "SlotMember")
        b.set(accountDiscriminator(name), 0);
    encodeStructInto(l, v, b, 8);
    return b;
}
export class AccountDecodeError extends Error {
    constructor(detail: string) {
        super(`floor_amm account: ${detail}`);
        this.name = "AccountDecodeError";
    }
}
export function decodeAccount(name: keyof typeof LAYOUTS, data: Uint8Array): Record<string, any> {
    const l = LAYOUTS[name];
    const d = accountDiscriminator(name);
    if (data.length !== 8 + layoutSize(l))
        throw new AccountDecodeError(`${name}: ${data.length} bytes, want ${8 + layoutSize(l)}`);
    if (hex(data.slice(0, 8)) !== hex(d))
        throw new AccountDecodeError(`${name}: wrong discriminator`);
    return decodeStruct(l, data, 8);
}
export const decodeConfig = (d: Uint8Array) => decodeAccount("Config", d);
export const decodeQuoteEntry = (d: Uint8Array) => decodeAccount("QuoteEntry", d);
export const decodeTeamSlot = (d: Uint8Array) => decodeAccount("TeamSlot", d);
export const decodeTraderRef = (d: Uint8Array) => decodeAccount("TraderRef", d);
export const decodeTraderLink = (d: Uint8Array) => decodeAccount("TraderLink", d);
export const decodeRefOwed = (d: Uint8Array) => decodeAccount("RefOwed", d);
export const decodeGenesisRaise = (d: Uint8Array) => decodeAccount("GenesisRaise", d);
export const decodeGenesisAllocation = (d: Uint8Array) => decodeAccount("GenesisAllocation", d);
export function accountKind(data: Uint8Array): keyof typeof LAYOUTS | null {
    const d = hex(data.slice(0, 8));
    for (const name of Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[]) {
        if (name === "SlotMember" || hex(accountDiscriminator(name)) !== d)
            continue;
        if (data.length !== 8 + layoutSize(LAYOUTS[name]))
            throw new AccountDecodeError(`${name}: ${data.length} bytes, want ${8 + layoutSize(LAYOUTS[name])}`);
        return name;
    }
    return null;
}
export const STATUS_LIVE = 1;
export const PRESET_CHECKED_ALL = 2;
export const PRESET_CHECKED_STEP1 = 1;
export const SLOT_ACTIVE = 1;
export const SLOT_FREE = 2;
export function metadataBaseOf(configData: Uint8Array): string {
    const c = decodeConfig(configData);
    const n = Math.min(Number(c.metadataBaseLen), 72);
    return new TextDecoder().decode((c.metadataBase as Uint8Array).slice(0, n));
}
