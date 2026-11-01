import { base58Decode } from "../codec.ts";
import type { Instruction } from "../solana/instruction.ts";
import type { EdgeLeg } from "./edge.ts";
export interface JupiterInstruction {
    programId: string;
    accounts: {
        pubkey: string;
        isSigner: boolean;
        isWritable: boolean;
    }[];
    data: string;
}
export interface JupiterSwapInstructions {
    computeBudgetInstructions?: JupiterInstruction[];
    setupInstructions?: JupiterInstruction[];
    swapInstruction: JupiterInstruction;
    cleanupInstruction?: JupiterInstruction | null;
    otherInstructions?: JupiterInstruction[];
    addressLookupTableAddresses?: string[];
}
export interface JupiterQuote {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    slippageBps: number;
    swapMode?: string;
}
export function jupiterSwapInstructionsBody(p: {
    quote: JupiterQuote;
    trader: string;
    destinationTokenAccount?: string;
}): string {
    return JSON.stringify({ quoteResponse: p.quote, userPublicKey: p.trader, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, ...(p.destinationTokenAccount ? { destinationTokenAccount: p.destinationTokenAccount } : {}) });
}
function base64Decode(s: string): Uint8Array {
    const b = atob(s);
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++)
        out[i] = b.charCodeAt(i);
    return out;
}
export function fromJupiter(j: JupiterInstruction): Instruction {
    base58Decode(j.programId);
    return {
        programAddress: j.programId,
        accounts: j.accounts.map((a) => ({ address: a.pubkey, role: ((a.isSigner ? 2 : 0) | (a.isWritable ? 1 : 0)) as 0 | 1 | 2 | 3 })),
        data: base64Decode(j.data),
    };
}
export function jupiterLeg(j: JupiterSwapInstructions): Instruction[] {
    return [...(j.setupInstructions ?? []), j.swapInstruction, ...(j.cleanupInstruction ? [j.cleanupInstruction] : []), ...(j.otherInstructions ?? [])].map(fromJupiter);
}
export function jupiterEdgeLeg(j: JupiterSwapInstructions): EdgeLeg {
    const jb = (j.computeBudgetInstructions ?? []).map(fromJupiter);
    const limit = jb.find((ix) => ix.data[0] === 2 && ix.data.length >= 5);
    const price = jb.find((ix) => ix.data[0] === 3 && ix.data.length >= 9);
    const dv = (ix: Instruction): DataView => new DataView(ix.data.buffer, ix.data.byteOffset);
    return {
        setup: (j.setupInstructions ?? []).map(fromJupiter),
        swap: [fromJupiter(j.swapInstruction)],
        cleanup: [...(j.cleanupInstruction ? [j.cleanupInstruction] : []), ...(j.otherInstructions ?? [])].map(fromJupiter),
        lookupTableAddresses: [...(j.addressLookupTableAddresses ?? [])],
        ...(limit ? { computeUnits: dv(limit).getUint32(1, true) } : {}),
        ...(price ? { computeUnitPrice: dv(price).getBigUint64(1, true) } : {}),
    };
}
