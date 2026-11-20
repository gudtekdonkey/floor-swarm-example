import { sha256 } from "../sha256.ts";
import { Address, beginCell, contractAddress, hexOf, readSnake } from "./cell.ts";
import type { Cell } from "./cell.ts";
import { addr } from "./addresses.ts";
import { StackError, getWalletAddress, parseRefMap } from "./reader.ts";
import type { StackItem, TonRpc } from "./reader.ts";
import type { AddressLike } from "./types.ts";
import type { TonGovQuoteEntry } from "./governance.ts";
export class TonQuoteError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "TonQuoteError";
        this.code = code;
    }
}
export type TonQuoteKind = "standard" | "stable" | "floor";
export const TON_QUOTE_WALLET_KIND: Record<TonQuoteKind, 1 | 3 | 4> = { standard: 1, stable: 3, floor: 4 };
export interface TonQuoteInput {
    kind: TonQuoteKind;
    master: Address;
    decimals: number;
    walletCode: Cell;
    createFee: bigint;
    issuerCanFreeze: boolean;
    createsEnabled: boolean;
    cap?: bigint;
}
export function buildTonQuoteEntry(i: TonQuoteInput): TonGovQuoteEntry {
    const walletKind = TON_QUOTE_WALLET_KIND[i.kind];
    if (walletKind === undefined)
        throw new TonQuoteError("Q-WALLET-KIND", `unknown quote kind "${String(i.kind)}"`);
    return {
        kind: 1,
        master: i.master,
        decimals: i.decimals,
        walletKind,
        walletCodeHash: BigInt("0x" + hexOf(i.walletCode.hash())),
        walletCode: i.walletCode,
        createFee: i.createFee,
        issuerCanFreeze: i.issuerCanFreeze,
        createsEnabled: i.createsEnabled,
        cap: i.cap ?? 0n,
    };
}
export function checkTonQuoteEntry(e: TonGovQuoteEntry): void {
    if (e.kind === 0) {
        if (e.master !== null || e.walletKind !== 0 || e.decimals !== 9 || e.walletCode !== null || e.issuerCanFreeze) {
            throw new TonQuoteError("Q-NATIVE", "native quote must have no master, wallet_kind 0, decimals 9, no wallet code and issuer_can_freeze false (the factory throws 300)");
        }
    }
    else {
        if (!e.master || e.master.workchain !== 0)
            throw new TonQuoteError("Q-MASTER-WC", "quote master must be a basechain address (the factory throws 300)");
        if (e.walletKind !== 1 && e.walletKind !== 3 && e.walletKind !== 4) {
            throw new TonQuoteError("Q-WALLET-KIND", `wallet_kind ${e.walletKind} cannot be listed: 1 standard, 3 stablecoin, 4 FLOOR launch token (2, Jetton 2.0, is refused by add_quote)`);
        }
        if (!Number.isInteger(e.decimals) || e.decimals < 0 || e.decimals > 30 || (e.walletKind === 4 && e.decimals !== 6)) {
            throw new TonQuoteError("Q-DECIMALS", "decimals must be at most 30; a FLOOR launch token has 6 decimals");
        }
        if (!e.walletCode || BigInt("0x" + hexOf(e.walletCode.hash())) !== e.walletCodeHash) {
            throw new TonQuoteError("Q-CODE", "wallet_code is missing or its hash differs from wallet_code_hash: pass the library cell itself for a library wallet");
        }
    }
    if (e.createFee <= 0n || e.createFee >= 1n << 120n) {
        throw new TonQuoteError("Q-FEE", "create_fee must be positive and fit Coins (derive it from the USD fee and the price; never type it)");
    }
    if (e.kind === 1 && e.walletKind === 3 && !e.issuerCanFreeze) {
        throw new TonQuoteError("Q-FREEZE", "a stablecoin wallet (kind 3) can be locked by its admin: set issuer_can_freeze true so the site shows the flag");
    }
    if (e.kind === 1 && e.walletKind === 4 && e.issuerCanFreeze) {
        throw new TonQuoteError("Q-FLOOR-FREEZE", "a FLOOR launch token cannot be frozen: issuer_can_freeze must be false");
    }
}
export function tonQuoteWalletOf(e: TonGovQuoteEntry, owner: AddressLike): Address {
    if (e.kind !== 1 || !e.master || !e.walletCode)
        throw new TonQuoteError("Q-CODE", "only a jetton entry with a master and a wallet code has a wallet");
    const o = addr(owner);
    const b = beginCell();
    switch (e.walletKind) {
        case 1:
            b.storeCoins(0).storeAddress(o).storeAddress(e.master).storeRef(e.walletCode);
            break;
        case 3:
            b.storeUint(0, 4).storeCoins(0).storeAddress(o).storeAddress(e.master);
            break;
        case 4:
            b.storeCoins(0).storeAddress(o).storeAddress(e.master).storeRef(beginCell().endCell());
            break;
        default:
            throw new TonQuoteError("Q-WALLET-KIND", `wallet_kind ${e.walletKind} cannot be listed: 1 standard, 3 stablecoin, 4 FLOOR launch token (2, Jetton 2.0, is refused by add_quote)`);
    }
    return contractAddress(e.walletCode, b.endCell());
}
export interface TonJettonMaster {
    totalSupply: bigint;
    content: Cell | null;
    walletCode: Cell | null;
}
export async function getTonJettonMaster(rpc: TonRpc, master: AddressLike): Promise<TonJettonMaster> {
    const s: StackItem[] = await rpc.runGetMethod(addr(master), "get_jetton_data", []);
    if (s.length < 5)
        throw new StackError(`get_jetton_data: ${s.length} stack items, expected 5`);
    const supply = s[0];
    if (!supply || supply.type !== "int")
        throw new StackError("total_supply: expected an int at 0");
    const cellAt = (i: number, name: string): Cell | null => {
        const x = s[i];
        if (!x)
            throw new StackError(`${name}: missing item ${i}`);
        if (x.type === "null")
            return null;
        if (x.type !== "cell" && x.type !== "slice")
            throw new StackError(`${name}: expected a cell at ${i}`);
        return x.cell;
    };
    return { totalSupply: supply.value, content: cellAt(3, "content"), walletCode: cellAt(4, "wallet_code") };
}
export function readTonContentDecimals(content: Cell): number | null {
    const s = content.beginParse();
    if (s.remainingBits < 8)
        return null;
    if (s.loadUint(8) !== 0n)
        return null;
    if (s.remainingBits < 1 || !s.loadBit())
        return null;
    const map = parseRefMap(s.loadRef(), 256);
    const key = BigInt("0x" + hexOf(sha256(new TextEncoder().encode("decimals"))));
    const v = map.get(key);
    if (!v)
        return null;
    const bad = (t: string): TonQuoteError => new TonQuoteError("Q-CONTENT", `the master's on-chain decimals value "${t}" is not an integer from 0 to 30`);
    if (v.len < 8 || v.bits[0] !== 0)
        throw bad("(not a snake value)");
    const head = new Uint8Array(v.bits.subarray(1, v.len >> 3));
    let text = new TextDecoder().decode(head);
    if (v.refs[0])
        text += readSnake(v.refs[0]);
    if (!/^\d{1,3}$/.test(text) || Number(text) > 30)
        throw bad(text.length > 40 ? text.slice(0, 40) + "\u2026" : text);
    return Number(text);
}
export interface TonDerivation {
    owner: Address;
    derived: Address;
    fromMaster: Address | null;
    match: boolean;
}
export async function deriveTonQuoteWallets(rpc: TonRpc, entry: TonGovQuoteEntry, owners: AddressLike[]): Promise<TonDerivation[]> {
    if (!entry.master)
        throw new TonQuoteError("Q-MASTER-WC", "quote master must be a basechain address (the factory throws 300)");
    const out: TonDerivation[] = [];
    for (const o of owners) {
        const owner = addr(o);
        const derived = tonQuoteWalletOf(entry, owner);
        const fromMaster = await getWalletAddress(rpc, entry.master, owner);
        out.push({ owner, derived, fromMaster, match: fromMaster !== null && fromMaster.equals(derived) });
    }
    return out;
}
