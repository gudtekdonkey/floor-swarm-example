import { bytesToHex, hexToBytes } from "../evm/abi.ts";
import { keccak256 } from "../evm/keccak.ts";
export function evmCodeHash(code: string): string {
    if (typeof code !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(code) || /^0x0*$/.test(code))
        throw new Error(`evmCodeHash: not runtime code: ${String(code).slice(0, 20)}`);
    return bytesToHex(keccak256(hexToBytes(code))).toLowerCase();
}
