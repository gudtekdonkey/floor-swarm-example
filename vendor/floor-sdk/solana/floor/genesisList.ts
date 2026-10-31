import { addressBytes, concatBytes, hex } from "../../codec.ts";
import { sha256 } from "../../sha256.ts";
export const GENESIS_MAX_PROOF_LEN = 24;
const cmp = (a: Uint8Array, b: Uint8Array): number => {
    for (let i = 0; i < 32; i++)
        if (a[i] !== b[i])
            return a[i]! - b[i]!;
    return 0;
};
export function genesisListLeaf(wallet: Uint8Array): Uint8Array {
    if (wallet.length !== 32)
        throw new RangeError("genesisListLeaf: a wallet is 32 bytes");
    return sha256(concatBytes(new Uint8Array([0]), wallet));
}
export function genesisListParent(a: Uint8Array, b: Uint8Array): Uint8Array {
    const [lo, hi] = cmp(a, b) <= 0 ? [a, b] : [b, a];
    return sha256(concatBytes(new Uint8Array([1]), lo, hi));
}
export function verifyGenesisListProof(root: Uint8Array, wallet: Uint8Array, proof: readonly Uint8Array[]): boolean {
    if (root.every((x) => x === 0) || proof.length > GENESIS_MAX_PROOF_LEN)
        return false;
    let node = genesisListLeaf(wallet);
    for (const sib of proof)
        node = genesisListParent(node, sib);
    return cmp(node, root) === 0;
}
export interface GenesisListTree {
    readonly root: Uint8Array;
    proofFor(wallet: string | Uint8Array): Uint8Array[] | null;
}
export function genesisListTree(wallets: readonly (string | Uint8Array)[]): GenesisListTree {
    if (wallets.length === 0)
        throw new RangeError("genesisListTree: at least one wallet");
    if (wallets.length > 2 ** GENESIS_MAX_PROOF_LEN)
        throw new RangeError(`genesisListTree: at most 2^${GENESIS_MAX_PROOF_LEN} wallets`);
    const keys = wallets.map((w) => (typeof w === "string" ? addressBytes(w) : Uint8Array.from(w)));
    const index = new Map<string, number>();
    keys.forEach((k, i) => {
        if (k.length !== 32)
            throw new RangeError(`genesisListTree: wallet #${i} is not 32 bytes`);
        const h = hex(k);
        if (index.has(h))
            throw new RangeError(`genesisListTree: wallet #${i} repeats #${index.get(h)}`);
        index.set(h, i);
    });
    const levels: Uint8Array[][] = [keys.map(genesisListLeaf)];
    while (levels[levels.length - 1]!.length > 1) {
        const cur = levels[levels.length - 1]!;
        const next: Uint8Array[] = [];
        for (let i = 0; i < cur.length; i += 2)
            next.push(i + 1 < cur.length ? genesisListParent(cur[i]!, cur[i + 1]!) : cur[i]!);
        levels.push(next);
    }
    return {
        root: levels[levels.length - 1]![0]!,
        proofFor(wallet) {
            let pos = index.get(hex(typeof wallet === "string" ? addressBytes(wallet) : wallet));
            if (pos === undefined)
                return null;
            const proof: Uint8Array[] = [];
            for (let l = 0; l < levels.length - 1; l++) {
                const sib = pos ^ 1;
                if (sib < levels[l]!.length)
                    proof.push(levels[l]![sib]!);
                pos >>= 1;
            }
            return proof;
        },
    };
}
export const GENESIS_LISTED_WALLET_CAP_LAMPORTS = 5000000000n;
export function genesisListedAllowance(alloc: {
    listedOld: bigint;
    listed: bigint;
} | null): bigint {
    const used = alloc ? alloc.listedOld + alloc.listed : 0n;
    return used >= GENESIS_LISTED_WALLET_CAP_LAMPORTS ? 0n : GENESIS_LISTED_WALLET_CAP_LAMPORTS - used;
}
