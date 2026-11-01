import { hex } from "../../codec.ts";
import { EVENT_IX_TAG_LE, eventDiscriminator } from "../instruction.ts";
import { Reader } from "./borsh.ts";
type B = "pubkey" | "bool" | "u8" | "u16" | "u32" | "u64" | "i64" | "u128" | `bytes:${number}` | `u64[${number}]` | `pubkey[${number}]`;
type T = B | `${B}?`;
const S = (...f: [
    string,
    T
][]): [
    string,
    T
][] => f;
export const EVENTS: Record<string, [
    string,
    T
][]> = {
    LaunchCreated: S(["launch", "pubkey"], ["mint", "pubkey"], ["quoteMint", "pubkey"], ["creator", "pubkey"], ["id", "u64"], ["presetId", "u8"], ["presetVersion", "u32"], ["presetHash", "bytes:32"], ["p0X64", "u128"], ["raise", "u64"], ["windowTokens", "u64"], ["creatorBuyTokens", "u64"], ["createFee", "u64"], ["name", "bytes:32"], ["symbol", "bytes:10"], ["slot", "u64"], ["ts", "i64"], ["listed", "bool"], ["quoteUsdCentsX64", "u128"], ["nativeCreateFee", "u64"]),
    Graduated: S(["launch", "pubkey"], ["priceX64", "u128"], ["windowRaised", "u64"], ["windowTokens", "u64"], ["slot", "u64"], ["ts", "i64"]),
    PotsSwept: S(["launch", "pubkey"], ["amount", "u64"], ["reason", "u8"]),
    Claimed: S(["wallet", "pubkey"], ["sender", "pubkey"], ["launch", "pubkey"], ["quoteMint", "pubkey"], ["types", "u8"], ["creator", "u64"], ["creatorRef", "u64"], ["teamSlot", "u64"], ["traderRef", "u64"], ["extra", "u64"], ["amount", "u64"], ["teamBuy", "u64?"], ["shareBought", "u64?"], ["typesHi", "u8?"]),
    TeamShareBought: S(["launch", "pubkey"], ["member", "pubkey"], ["place", "u8"], ["spent", "u64"], ["refund", "u64"], ["tokens", "u64"], ["shareLeft", "u64"], ["boughtOwed", "u64"], ["day", "u64"], ["firstToday", "bool"], ["ts", "i64"]),
    PlatformWithdrawn: S(["launch", "pubkey"], ["quoteMint", "pubkey"], ["destination", "pubkey"], ["amount", "u64"], ["owedAfter", "u64"]),
    HolderWithdrawn: S(["launch", "pubkey"], ["quoteMint", "pubkey"], ["destination", "pubkey"], ["amount", "u64"], ["owedAfter", "u64"]),
    PresetWritten: S(["id", "u8"], ["rowVersion", "u32"], ["enabled", "bool"], ["deleted", "bool"]),
    QuoteWritten: S(["mint", "pubkey"], ["enabled", "bool"], ["createFee", "u64"], ["usdCentsX64", "u128"], ["admittedCaps", "u32"]),
    ConfigWritten: S(["authority", "pubkey"], ["pendingAuthority", "pubkey"], ["timelock", "pubkey"], ["referralAuthority", "pubkey"], ["createPaused", "bool"], ["holderDest", "pubkey"], ["nativeCreateFee", "u64"], ["treasury", "pubkey?"], ["priceUpdater", "pubkey?"]),
    MetadataBaseSet: S(["base", "bytes:72"], ["len", "u8"]),
    TeamSlotOpened: S(["launch", "pubkey"], ["rateBps", "u16"], ["price", "u64"]),
    TeamSlotMember: S(["launch", "pubkey"], ["index", "u8"], ["key", "bytes:32"], ["kind", "u8"], ["state", "u8"], ["paid", "u64"], ["requested", "u64"], ["bought", "u64"], ["boughtPpm", "u32"]),
    TraderRefOpened: S(["trader", "pubkey"], ["quoteMint", "pubkey"], ["tiers", "pubkey[3]"]),
    TraderLinkOpened: S(["trader", "pubkey"], ["tiers", "pubkey[3]"]),
    TraderRefCleared: S(["trader", "pubkey"], ["records", "u16"]),
    CreatorBuyUnlocked: S(["launch", "pubkey"], ["creator", "pubkey"], ["tokens", "u64"], ["members", "u64[10]?"], ["paid", "u64?"]),
    RefOwedOpened: S(["referrer", "pubkey"], ["quoteMint", "pubkey"]),
    RefsRolled: S(["quoteMint", "pubkey"], ["traderRefs", "u16"], ["amount", "u64"]),
    GenesisAccepted: S(["oldSale", "pubkey"], ["count", "u16"], ["totalMigrated", "u64"], ["donation", "u64"]),
    HandleBound: S(["launch", "pubkey"], ["index", "u8"], ["handle", "bytes:32"], ["wallet", "pubkey"]),
    QuoteShort: S(["launch", "pubkey"], ["quoteVault", "u64"], ["quoteBooked", "u64"], ["short", "u64"], ["slot", "u64"]),
    BackingCredited: S(["launch", "pubkey"], ["donor", "pubkey"], ["amount", "u64"], ["fAfter", "u64"], ["slot", "u64"]),
    CutWithdrawn: S(["launch", "pubkey"], ["amount", "u64"], ["cutOwedAfter", "u64"]),
    RoleRegistered: S(["wallet", "pubkey"], ["page", "u16"], ["launch", "pubkey"], ["roles", "u8"]),
    ClaimsLutSet: S(["wallet", "pubkey"], ["lookupTable", "pubkey"]),
    NativeFeesWithdrawn: S(["destination", "pubkey"], ["amount", "u64"], ["owedAfter", "u64"]),
    GenesisContributed: S(["wallet", "pubkey"], ["amount", "u64"], ["walletTotal", "u64"], ["liveTotal", "u64"]),
    GenesisMigratedRefunded: S(["wallet", "pubkey"], ["amount", "u64"], ["liveTotal", "u64"]),
    GenesisOpened: S(["launch", "pubkey"], ["mint", "pubkey"], ["raised", "u64"], ["tokens", "u64"], ["donation", "u64"], ["p0X64", "u128"], ["weightTotal", "u64"], ["slotRateBps", "u16"], ["quoteMint", "pubkey?"], ["floorUsdcIn", "u64?"], ["refund", "u64?"], ["usdcExcess", "u64?"], ["solConverted", "u64?"], ["usdcConverted", "u64?"], ["solUnconverted", "u64?"], ["usdcRefund", "u64?"]),
    GenesisClaimed: S(["wallet", "pubkey"], ["migratedCredit", "u64"], ["phase3Credit", "u64"], ["tokens", "u64"], ["refund", "u64?"], ["listedCredit", "u64?"], ["usdcRefund", "u64?"]),
    GenesisRefundOwed: S(["wallet", "pubkey"], ["amount", "u64"], ["usdc", "u64?"]),
    GenesisRefundPaid: S(["wallet", "pubkey"], ["to", "pubkey"], ["amount", "u64"], ["usdc", "u64?"], ["usdcTo", "pubkey?"]),
    GenesisDustSwept: S(["launch", "pubkey"], ["amount", "u64"], ["usdc", "u64?"]),
    GenesisSolConverted: S(["caller", "pubkey"], ["lamports", "u64"], ["usdc", "u64"], ["solUsdCentsX64", "u128"], ["usdcUsdCentsX64", "u128"], ["discountBps", "u16"], ["solConverted", "u64"], ["usdcConverted", "u64"], ["usdcCaps", "u64"]),
    GenesisWagmiBought: S(["floorLaunch", "pubkey"], ["usdcIn", "u64"], ["floorOut", "u64"]),
    GenesisWagmiOpened: S(["launch", "pubkey"], ["mint", "pubkey"], ["floorIn", "u64"], ["tokens", "u64"], ["floorRefund", "u64"], ["p0X64", "u128"], ["quoteUsdCentsX64", "u128?"], ["capTokens", "u64?"], ["overCapFloor", "u64?"], ["overCapTokens", "u64?"]),
    GenesisWagmiClaimed: S(["wallet", "pubkey"], ["tokens", "u64"], ["floorBack", "u64"]),
    GenesisWagmiDustSwept: S(["launch", "pubkey"], ["floor", "u64"]),
    GenesisListedContributed: S(["wallet", "pubkey"], ["amount", "u64"], ["walletListed", "u64"], ["allowanceLeft", "u64"], ["liveTotal", "u64"]),
    GenesisListRootSet: S(["signer", "pubkey"], ["oldRoot", "bytes:32"], ["newRoot", "bytes:32"]),
    BurnsSynced: S(["launch", "pubkey"], ["incinerated", "u64"], ["supply", "u64"], ["sOut", "u64"], ["floorAfterX64", "u128"], ["slot", "u64"]),
    TokensBurned: S(["launch", "pubkey"], ["wallet", "pubkey"], ["role", "u8"], ["place", "u8"], ["fromTeamBuy", "u64"], ["fromWallet", "u64"], ["balanceBefore", "u64"], ["owedAfter", "u64"], ["split", "u64[10]"], ["supply", "u64"], ["sOut", "u64"], ["floorAfterX64", "u128"], ["slot", "u64"], ["fromShareBought", "u64?"]),
};
export const SWEPT_BURN = 0;
export const SWEPT_EXIT = 1;
export const SWEPT_DUST = 3;
let disc: Map<string, string> | undefined;
const DISC = (): Map<string, string> => (disc ??= new Map(Object.keys(EVENTS).map((n) => [hex(eventDiscriminator(n)), n])));
function readField(r: Reader, t: B): unknown {
    switch (t) {
        case "pubkey":
            return r.pubkey();
        case "bool":
            return r.bool();
        case "u8":
            return r.u8();
        case "u16":
            return r.u16();
        case "u32":
            return r.u32();
        case "u64":
            return r.u64();
        case "i64":
            return r.i64();
        case "u128":
            return r.u128();
    }
    const m = /^(\w+)[:[](\d+)\]?$/.exec(t)!;
    const n = Number(m[2]);
    if (m[1] === "bytes")
        return r.bytes(n);
    if (m[1] === "u64")
        return Array.from({ length: n }, () => r.u64());
    return Array.from({ length: n }, () => r.pubkey());
}
export interface FloorEvent {
    name: string;
    fields: Record<string, any>;
}
export function decodeEventData(data: Uint8Array): FloorEvent | null {
    const name = DISC().get(hex(data.slice(0, 8)));
    if (!name)
        return null;
    const r = new Reader(data.slice(8));
    const fields: Record<string, any> = {};
    let ended = false;
    for (const [f, t] of EVENTS[name]) {
        if (t.endsWith("?")) {
            if (ended || r.o === r.b.length) {
                ended = true;
                fields[f] = null;
                continue;
            }
            fields[f] = readField(r, t.slice(0, -1) as B);
            continue;
        }
        if (ended)
            throw new RangeError(`${name}: a required field ${f} after an absent appended one`);
        fields[f] = readField(r, t as B);
    }
    if (r.o !== r.b.length)
        throw new RangeError(`${name}: ${r.b.length} body bytes, the schema reads ${r.o}`);
    return { name, fields };
}
export function decodeEventCpi(ixData: Uint8Array): FloorEvent | null {
    if (ixData.length < 16 || hex(ixData.slice(0, 8)) !== hex(EVENT_IX_TAG_LE))
        return null;
    return decodeEventData(ixData.slice(8));
}
