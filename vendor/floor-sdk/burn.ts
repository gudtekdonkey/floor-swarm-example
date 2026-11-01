export const BURN_SCENE_BPS = 5000n;
export const BURN_SCENE_MIN_SUPPLY_BPS = 10n;
export const BURN_SCENE_COOLDOWN_SECS = 3600;
export type BurnRole = 0 | 1 | 2;
export interface BurnSceneInput {
    role: BurnRole;
    burned: bigint;
    balanceBefore: bigint;
    sOutBefore: bigint;
    now: number;
    lastSceneAt?: number | null;
}
export function burnPlaysScene(b: BurnSceneInput): boolean {
    if (b.role === 0 || b.burned <= 0n || b.balanceBefore <= 0n || b.sOutBefore <= 0n)
        return false;
    if (b.burned * 10000n <= b.balanceBefore * BURN_SCENE_BPS)
        return false;
    if (b.burned * 10000n < b.sOutBefore * BURN_SCENE_MIN_SUPPLY_BPS)
        return false;
    return b.lastSceneAt == null || b.now - b.lastSceneAt >= BURN_SCENE_COOLDOWN_SECS;
}
export function planBurn(amount: bigint, teamBuyPart: bigint, wallet: bigint): {
    fromTeamBuy: bigint;
    fromWallet: bigint;
} {
    if (amount <= 0n)
        throw new Error("planBurn: amount must be > 0");
    if (amount > teamBuyPart + wallet)
        throw new Error("planBurn: more than the balance");
    const fromTeamBuy = amount < teamBuyPart ? amount : teamBuyPart;
    return { fromTeamBuy, fromWallet: amount - fromTeamBuy };
}
