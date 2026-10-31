import { accountDiscriminator } from "../../solana/instruction.ts";
import { Reader } from "../../solana/floor/borsh.ts";
import { decodeGenesisAllocation, decodeGenesisRaise } from "../../solana/floor/accounts.ts";
import { FLOOR_AMM_PROGRAM_ID, configPda, genesisAllocPda, genesisConvertBandPda, genesisRaisePda } from "../../solana/floor/program.ts";
import { genesisWalletClaim } from "../../solana/floor/genesis.ts";
import type { GenesisWalletClaim } from "../../solana/floor/genesis.ts";
export { openGenesisLaunchInstructionV2, openGenesisWagmiInstructionV2, claimGenesisInstructionV2, claimGenesisWagmiInstructionV2, sweepGenesisWagmiDustInstructionV2 } from "../genesis.ts";
export { setGenesisConvertBandInstruction } from "../solana.ts";
export { contributeGenesisInstruction, contributeGenesisListedInstruction, refundGenesisMigratedInstruction, claimGenesisRefundInstruction, convertGenesisSolInstruction } from "../../solana/floor/instructions.ts";
export { decodeGenesisRaise, decodeGenesisAllocation } from "../../solana/floor/accounts.ts";
export { genesisWalletClaim } from "../../solana/floor/genesis.ts";
export type { GenesisWalletClaim } from "../../solana/floor/genesis.ts";
export const GENESIS_CONVERT_BAND_SIZE = 8 + 1 + 16 * 4 + 8;
export interface GenesisConvertBand {
    bump: number;
    solPxMin: bigint;
    solPxMax: bigint;
    usdcPxMin: bigint;
    usdcPxMax: bigint;
    updatedAt: bigint;
}
export function decodeGenesisConvertBand(data: Uint8Array): GenesisConvertBand {
    if (data.length !== GENESIS_CONVERT_BAND_SIZE)
        throw new RangeError(`GenesisConvertBand is ${GENESIS_CONVERT_BAND_SIZE} bytes, got ${data.length}`);
    const d = accountDiscriminator("GenesisConvertBand");
    for (let i = 0; i < 8; i++)
        if (data[i] !== d[i])
            throw new RangeError("not a GenesisConvertBand account");
    const r = new Reader(data.subarray(8));
    return { bump: r.u8(), solPxMin: r.u128(), solPxMax: r.u128(), usdcPxMin: r.u128(), usdcPxMax: r.u128(), updatedAt: r.i64() };
}
export const genesisBandHolds = (b: GenesisConvertBand, solPx: bigint, usdcPx: bigint): boolean => b.solPxMin > 0n && b.usdcPxMin > 0n && solPx >= b.solPxMin && solPx <= b.solPxMax && usdcPx >= b.usdcPxMin && usdcPx <= b.usdcPxMax;
export function genesisAccountsV2(p: {
    wallet?: string;
    programId?: string;
}): {
    config: string;
    genesisRaise: string;
    convertBand: string;
    allocation: string | null;
} {
    const g = p.programId ?? FLOOR_AMM_PROGRAM_ID;
    return {
        config: configPda(g)[0],
        genesisRaise: genesisRaisePda(g)[0],
        convertBand: genesisConvertBandPda(g)[0],
        allocation: p.wallet ? genesisAllocPda(p.wallet, g)[0] : null,
    };
}
export interface GenesisReadV2 {
    raise: Record<string, any>;
    allocation: Record<string, any> | null;
    claim: GenesisWalletClaim | null;
    band: GenesisConvertBand | null;
}
export function readGenesisV2(p: {
    raise: Uint8Array;
    allocation?: Uint8Array | null;
    band?: Uint8Array | null;
    now: bigint;
}): GenesisReadV2 {
    const raise = decodeGenesisRaise(p.raise);
    const allocation = p.allocation ? decodeGenesisAllocation(p.allocation) : null;
    let claim: GenesisWalletClaim | null = null;
    if (allocation && BigInt(raise.raised_final ?? 0n) > 0n)
        claim = genesisWalletClaim(raise, allocation);
    const band = p.band ? decodeGenesisConvertBand(p.band) : null;
    return { raise, allocation, claim, band };
}
