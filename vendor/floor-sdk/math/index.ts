export { log2X64, exp2X64 } from "./fixed.ts";
export const BPS = 10000n;
export type MathErrorCode = "VaultShareOutOfRange" | "Zero" | "Overflow" | "NotDue" | "NothingToDo" | "BookEmpty" | "StepBudget" | "SqrtRange" | "RowTooManyRanges" | "RowBands" | "RowShares" | "RowNotFeasible" | "TeamBuyOverShare" | "LotsFull" | "IndexGuard" | "NothingToSettle" | "SlippageExceeded" | "QuoteRowCannotOpen" | "RangeCover" | "RowLength" | "RowVersion" | "RowEdges" | "RowTail" | "RowBounds" | "RowFees" | "RowTeam" | "RowFlags" | "RowMsClass" | "RowNonCanonical";
export class FloorMathError extends Error {
    readonly code: MathErrorCode;
    constructor(code: MathErrorCode) {
        super(`floor-math: ${code}`);
        this.name = "FloorMathError";
        this.code = code;
    }
}
export function fail(code: MathErrorCode): never {
    throw new FloorMathError(code);
}
