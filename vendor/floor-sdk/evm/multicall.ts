import { checksumAddress, decodeAbi, encodeAbi, encodeCall, bytesToHex, functionSelector, hexToBytes } from "./abi.ts";
import type { AbiValue } from "./abi.ts";
import type { EvmCall } from "./floor/calls.ts";
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const AGGREGATE3 = "aggregate3((address,bool,bytes)[])";
const RESULTS = ["(bool,bytes)[]"] as const;
export const AGGREGATE3_SELECTOR = bytesToHex(functionSelector(AGGREGATE3));
export interface Call3 {
    target: string;
    allowFailure: boolean;
    callData: string;
}
export interface Call3Result {
    success: boolean;
    returnData: string;
}
export function aggregate3Call(calls: readonly Call3[], multicall: string = MULTICALL3_ADDRESS): EvmCall {
    const data = encodeCall(AGGREGATE3, [calls.map((c): AbiValue => [checksumAddress(c.target), c.allowFailure, c.callData])]);
    return { to: checksumAddress(multicall), data: bytesToHex(data), value: 0n };
}
export function decodeAggregate3Result(data: string): Call3Result[] {
    const [rows] = decodeAbi(RESULTS, data) as [
        [
            boolean,
            string
        ][]
    ];
    return rows.map(([success, returnData]) => ({ success, returnData }));
}
export function decodeAggregate3Call(data: string): Call3[] {
    const b = hexToBytes(data);
    if (bytesToHex(b.slice(0, 4)) !== AGGREGATE3_SELECTOR)
        throw new RangeError("not aggregate3 calldata");
    const [rows] = decodeAbi(["(address,bool,bytes)[]"], b.slice(4)) as [
        [
            string,
            boolean,
            string
        ][]
    ];
    return rows.map(([target, allowFailure, callData]) => ({ target, allowFailure, callData }));
}
export const encodeAggregate3Result = (results: readonly Call3Result[]): string => bytesToHex(encodeAbi(RESULTS, [results.map((r): AbiValue => [r.success, r.returnData])]));
