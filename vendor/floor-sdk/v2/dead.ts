export const SOLANA_DEAD_OWNERS: readonly string[] = [
    "1nc1nerator11111111111111111111111111111111",
    "11111111111111111111111111111111",
];
export const EVM_DEAD_ADDRESSES: readonly string[] = [
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    "0x0000000000000000000000000000000000000001",
    "0xdead000000000000000042069420694206942069",
];
export function isSolanaDeadOwner(owner: string): boolean {
    return SOLANA_DEAD_OWNERS.includes(owner);
}
export function isEvmDead(address: string): boolean {
    return EVM_DEAD_ADDRESSES.includes(address.toLowerCase());
}
