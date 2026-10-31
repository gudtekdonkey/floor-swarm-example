export type V2ErrorCode = "RowInvalid" | "Zero" | "Overflow" | "SupplyShort" | "TargetUnreachable" | "NotOwner" | "WExceedsSupply" | "NotHeld";
export class V2MathError extends Error {
    readonly code: V2ErrorCode;
    readonly stackIndex: number | undefined;
    constructor(code: V2ErrorCode, stack?: number) {
        super(`floor-math v2: ${code}${stack === undefined ? "" : `(${stack})`}`);
        this.name = "V2MathError";
        this.code = code;
        this.stackIndex = stack;
    }
}
export function v2Fail(code: V2ErrorCode, stack?: number): never {
    throw new V2MathError(code, stack);
}
