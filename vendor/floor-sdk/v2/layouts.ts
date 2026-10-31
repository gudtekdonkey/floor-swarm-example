import { hex } from "../codec.ts";
import { accountDiscriminator } from "../solana/instruction.ts";
import { AccountDecodeError, decodeStruct, encodeStruct, layoutSize } from "../solana/floor/accounts.ts";
import type { Layout } from "../solana/floor/accounts.ts";
import { BIDS_MAX } from "../math/v2/book.ts";
import { MAX_BANDS } from "../math/v2/rows.ts";
import { ROW_LEN } from "../math/v2/preset.ts";
export { BIDS_MAX, MAX_BANDS };
export { ROW_LEN, RANGES_MAX, decodeRowV2, encodeRowV2 } from "../math/v2/preset.ts";
export type { RowV2, RangeRowV2 } from "../math/v2/preset.ts";
export const PRESET_ROW_PAD = (4 - ((44 + ROW_LEN) % 4)) % 4;
export const PRESET_ROW_V2: Layout = [
    ["id", "u8"],
    ["bump", "u8"],
    ["enabled", "u8"],
    ["deleted", "u8"],
    ["checked", "u8"],
    ["genesis_row", "u8"],
    ["pad_version", "bytes:2"],
    ["version", "u32"],
    ["row_hash", "bytes:32"],
    ["row", `bytes:${ROW_LEN}`],
    ["pad_end", `bytes:${PRESET_ROW_PAD}`],
];
export const LAUNCH_V2: Layout = [
    ["version", "u8"],
    ["bump", "u8"],
    ["status", "u8"],
    ["graduated", "u8"],
    ["decimals", "u8"],
    ["quote_decimals", "u8"],
    ["preset_id", "u8"],
    ["own_fees", "u8"],
    ["ms_class", "u8"],
    ["flags", "u8"],
    ["n_ranges", "u8"],
    ["n_bands", "u8"],
    ["n_c", "u8"],
    ["team_buy_rule", "u8"],
    ["listed", "u8"],
    ["pad_slot_rate", "bytes:1"],
    ["slot_rate_bps", "u16"],
    ["pad_preset_version", "bytes:2"],
    ["preset_version", "u32"],
    ["id", "u64"],
    ["created_at", "i64"],
    ["created_slot", "u64"],
    ["creator_unlock_at", "i64"],
    ["base_mint", "pubkey"],
    ["quote_mint", "pubkey"],
    ["creator", "pubkey"],
    ["quote_token_program", "pubkey"],
    ["token_vault", "pubkey"],
    ["quote_vault", "pubkey"],
    ["preset_hash", "bytes:32"],
    ["phi_bps", "u16"],
    ["wc_bps", "u16"],
    ["psi_tail_bps", "u16"],
    ["team_buy_share_bps", "u16"],
    ["team_slot_max_bps", "u16"],
    ["platform_ms_bps", "u16"],
    ["floor_ms_bps", "u16"],
    ["ck_bps", "u16"],
    ["fee_ppm", "u32[5]"],
    ["fee_start_ppm", "u32[5]"],
    ["band_width_bps", "u16[4]"],
    ["band_share_bps", "u16[4]"],
    ["sqrt_p0", "u128l"],
    ["sqrt_p", "u128l"],
    ["sqrt_f", "u128l"],
    ["sqrt_l_max", "u128l"],
    ["sqrt_fee_a", "u128l"],
    ["sqrt_fee_b", "u128l"],
    ["quote_usd_cents_x64", "u128l"],
    ["band_edge", `u128l[${BIDS_MAX + 1}]`],
    ["rng_sqrt_a", "u128l[48]"],
    ["rng_sqrt_b", "u128l[48]"],
    ["rng_tokens", "u64[48]"],
    ["rng_ask_left", "u64[48]"],
    ["rng_back", "u64[48]"],
    ["rng_place", "u64[48]"],
    ["rng_ms_cap_ppm", "u32[48]"],
    ["rng_theta_bps", "u16[48]"],
    ["rng_psi_bps", "u16[48]"],
    ["rng_kind", "u8[48]"],
    ["rng_class", "u8[48]"],
    ["supply", "u64"],
    ["dead_tokens", "u64"],
    ["floor", "u64"],
    ["floor_tokens", "u64"],
    ["band_money", `u64[${BIDS_MAX}]`],
    ["band_tokens", `u64[${BIDS_MAX}]`],
    ["band_f", `u64[${BIDS_MAX}]`],
    ["band_f_claim", `u64[${BIDS_MAX}]`],
    ["ck_at_f", "u64"],
    ["ck_floor_tokens", "u64"],
    ["ms_booked", "u64[4]"],
    ["ms_paid", "u64[4]"],
    ["creator_owed", "u64"],
    ["platform_owed", "u64"],
    ["cut_owed", "u64"],
    ["holder_owed", "u64"],
    ["slot_owed_total", "u64"],
    ["slot_owed", "u64[10]"],
    ["slot_weight_ppb", "u32[10]"],
    ["creator_ref", "pubkey[3]"],
    ["creator_ref_owed", "u64[3]"],
    ["team_buy_owed", "u64[10]"],
    ["team_buy_claimed", "u64[10]"],
    ["slot_bought_owed", "u64[10]"],
    ["slot_bought_claimed", "u64[10]"],
    ["team_share_buy_day", "u64"],
    ["window_raised", "u64"],
    ["raise", "u64"],
    ["volume_buy", "u64"],
    ["volume_sell", "u64"],
    ["trades", "u64"],
    ["graduated_slot", "u64"],
    ["creator_locked", "u64"],
    ["backing_credited", "u64"],
    ["incinerated", "u64"],
    ["last_ts", "i64"],
    ["book_hash", "bytes:32"],
];
export const HOLDER_POSITION: Layout = [
    ["version", "u8"],
    ["bump", "u8"],
    ["ata_bump", "u8"],
    ["pad", "bytes:5"],
    ["launch", "pubkey"],
    ["owner", "pubkey"],
    ["amount", "u64"],
    ["index_snap", "u128l"],
    ["owed", "u64"],
    ["pad_end", "bytes:8"],
];
export const HOLDER_BOOK: Layout = [
    ["version", "u8"],
    ["bump", "u8"],
    ["pad", "bytes:6"],
    ["launch", "pubkey"],
    ["mint", "pubkey"],
    ["w", "u64"],
    ["index", "u128l"],
    ["carry", "u64"],
    ["booked_total", "u64"],
    ["paid_total", "u64"],
    ["pad_end", "bytes:8"],
];
export const DEAD_MARK: Layout = [
    ["version", "u8"],
    ["bump", "u8"],
    ["pad", "bytes:6"],
    ["counted", "u64"],
];
export const LOTS_MAX = 16;
export const MEMBERS_MAX = 10;
export const V2_VERSION = 2;
export const LAYOUTS_V2 = {
    PresetRowV2: PRESET_ROW_V2,
    LaunchV2: LAUNCH_V2,
    HolderPosition: HOLDER_POSITION,
    HolderBook: HOLDER_BOOK,
    DeadMark: DEAD_MARK,
} as const;
export type AccountNameV2 = keyof typeof LAYOUTS_V2;
export function decodeAccountV2(name: AccountNameV2, data: Uint8Array): Record<string, any> {
    const l = LAYOUTS_V2[name];
    if (data.length !== 8 + layoutSize(l))
        throw new AccountDecodeError(`${name}: ${data.length} bytes, want ${8 + layoutSize(l)}`);
    if (hex(data.slice(0, 8)) !== hex(accountDiscriminator(name)))
        throw new AccountDecodeError(`${name}: wrong discriminator`);
    return decodeStruct(l, data, 8);
}
export function encodeAccountV2(name: AccountNameV2, v: Record<string, any>): Uint8Array {
    const body = encodeStruct(LAYOUTS_V2[name], v);
    const b = new Uint8Array(8 + body.length);
    b.set(accountDiscriminator(name), 0);
    b.set(body, 8);
    return b;
}
export function accountKindV2(data: Uint8Array): AccountNameV2 | null {
    if (data.length < 8)
        return null;
    const d = hex(data.slice(0, 8));
    for (const n of Object.keys(LAYOUTS_V2) as AccountNameV2[]) {
        if (d === hex(accountDiscriminator(n)) && data.length === 8 + layoutSize(LAYOUTS_V2[n]))
            return n;
    }
    return null;
}
export const decodeLaunchV2 = (d: Uint8Array) => decodeAccountV2("LaunchV2", d);
export const decodePresetRowV2 = (d: Uint8Array) => decodeAccountV2("PresetRowV2", d);
export const decodeHolderPosition = (d: Uint8Array) => decodeAccountV2("HolderPosition", d);
export const decodeHolderBook = (d: Uint8Array) => decodeAccountV2("HolderBook", d);
export const decodeDeadMark = (d: Uint8Array) => decodeAccountV2("DeadMark", d);
