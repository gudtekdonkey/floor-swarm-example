import { COMPUTE_BUDGET_PROGRAM_ID } from "../solana/instruction.ts";
import type { Instruction } from "../solana/instruction.ts";
export interface EdgeLeg {
    setup: Instruction[];
    swap: Instruction[];
    cleanup: Instruction[];
    lookupTableAddresses: string[];
    computeUnits?: number;
    computeUnitPrice?: bigint;
}
export const EDGE_UNKNOWN_CU = 400000;
export function edgeLegInstructions(leg: EdgeLeg): Instruction[] {
    const ixs = [...leg.setup, ...leg.swap, ...leg.cleanup];
    for (const ix of ixs)
        if (ix.programAddress === COMPUTE_BUDGET_PROGRAM_ID)
            throw new RangeError("a compute budget instruction outside the budget slot");
    return ixs;
}
