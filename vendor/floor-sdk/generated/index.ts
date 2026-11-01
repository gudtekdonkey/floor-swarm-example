import { EVM_FUNCTION_SELECTORS } from "./interface.gen.ts";
import type { EvmFunctionSelectorRow } from "./interface.gen.ts";
export { CLAIM_BITS, CLAIM_KNOWN_MASKS, CLAIM_RESERVED, EVM_FUNCTION_SELECTORS, PROGRAM_IDS } from "./interface.gen.ts";
export type { EvmFunctionSelectorRow } from "./interface.gen.ts";
import { CLAIM_BITS, CLAIM_RESERVED } from "./interface.gen.ts";
export const CLAIM_CREATOR = CLAIM_BITS.solana.creator;
export const CLAIM_CREATOR_REF = CLAIM_BITS.solana.creatorRef;
export const CLAIM_TEAM_SLOT = CLAIM_BITS.solana.teamSlot;
export const CLAIM_TRADER_REF = CLAIM_BITS.solana.traderRef;
export const CLAIM_RESERVED_HOLDER = CLAIM_RESERVED.solana.holderV1;
export const CLAIM_EXTRA = CLAIM_RESERVED.solana.extra;
export const CLAIM_TEAM_BUY = CLAIM_BITS.solana.teamBuy;
export const CLAIM_SHARE_BOUGHT = CLAIM_BITS.solana.shareBought;
export function evmFunction(name: string, source?: string): EvmFunctionSelectorRow {
    const rows = EVM_FUNCTION_SELECTORS.filter((r) => r.name === name && (source === undefined || r.sources.includes(source)));
    if (rows.length === 0)
        throw new Error(`no printed EVM function ${name}${source ? ` in ${source}` : ""}`);
    if (rows.length > 1)
        throw new Error(`${name} is overloaded (${rows.map((r) => r.signature).join(", ")}): pass the source module`);
    return rows[0];
}
export const evmSignature = (name: string, source?: string): string => evmFunction(name, source).signature;
