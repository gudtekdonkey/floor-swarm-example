import { checksumAddress, decodeAbi, encodeCall, bytesToHex } from "./abi.ts";
import { MULTICALL3_ADDRESS, aggregate3Call, decodeAggregate3Result } from "./multicall.ts";
import type { EvmCall } from "./floor/calls.ts";
import { evmSignature } from "../generated/index.ts";
const BALANCE_OF = evmSignature("balanceOf");
export const balanceOfData = (owner: string): string => bytesToHex(encodeCall(BALANCE_OF, [checksumAddress(owner)]));
export function balancesCall(owner: string, tokens: readonly string[], multicall: string = MULTICALL3_ADDRESS): EvmCall {
    const data = balanceOfData(owner);
    return aggregate3Call(tokens.map((t) => ({ target: t, allowFailure: true, callData: data })), multicall);
}
export function holdersBalanceCall(token: string, owners: readonly string[], multicall: string = MULTICALL3_ADDRESS): EvmCall {
    return aggregate3Call(owners.map((o) => ({ target: token, allowFailure: true, callData: balanceOfData(o) })), multicall);
}
export function decodeBalances(data: string): (bigint | null)[] {
    return decodeAggregate3Result(data).map((r) => {
        if (!r.success || r.returnData.length < 2 + 64)
            return null;
        return (decodeAbi(["uint256"], r.returnData) as [
            bigint
        ])[0];
    });
}
