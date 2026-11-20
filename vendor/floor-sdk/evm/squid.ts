import { bytesToHex, encodeAbi, encodeCall } from "./abi.ts";
export const SQUID_CALL = { Default: 0, FullTokenBalance: 1, FullNativeBalance: 2, CollectTokenBalance: 3 } as const;
export const SQUID_FULL = 0n;
const SOLANA_CHAINS: readonly (number | string)[] = [101, 1151111081099710, "solana", "solana-mainnet-beta"];
export type SquidHookCode = "SOLANA" | "RECIPIENT_IS_MULTICALL" | "BAD_RECIPIENT" | "NO_MINIMUM" | "NATIVE_QUOTE" | "NOT_WHOLE_UNITS" | "BAD_ADDRESS";
export class SquidHookError extends Error {
    readonly code: SquidHookCode;
    constructor(code: SquidHookCode, detail: string) {
        super(`squid: ${code}: ${detail}`);
        this.code = code;
        this.name = "SquidHookError";
    }
}
export type SquidHookCall = {
    chainType: "evm";
    callType: number;
    target: string;
    value: string;
    callData: string;
    payload: string;
    estimatedGas: string;
};
export type SquidHook = {
    provider: "FLOOR";
    description: string;
    calls: SquidHookCall[];
    fundToken?: string;
    fundAmount?: string;
};
export const SQUID_TOKEN_SCALE = 10n ** 12n;
export const SQUID_GAS = { transfer: 65000, buy: 1100000, sell: 850000, zapBuy: 1300000, passOn: 30000 } as const;
type Common = {
    chainId: number | string;
    multicall: string;
    floorAmm: string;
    launchId: bigint;
    user: string;
    deadline: bigint;
};
const ZERO = "0x" + "0".repeat(40);
const lc = (a: string, what: string): string => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a))
        throw new SquidHookError("BAD_ADDRESS", `${what} ${a}`);
    return a.toLowerCase();
};
function checkCommon(p: Common): void {
    if (SOLANA_CHAINS.includes(p.chainId))
        throw new SquidHookError("SOLANA", `chain ${p.chainId}: hooks run on EVM chains only`);
}
function checkUser(p: Common): string {
    const user = lc(p.user, "user");
    if (user === lc(p.multicall, "multicall"))
        throw new SquidHookError("RECIPIENT_IS_MULTICALL", "the tokens would stay on SquidMulticall");
    if (user === ZERO || user === lc(p.floorAmm, "floorAmm"))
        throw new SquidHookError("BAD_RECIPIENT", user);
    return user;
}
const call = (callType: number, target: string, value: bigint, callData: string, payload: string, gas: number): SquidHookCall => ({
    chainType: "evm",
    callType,
    target,
    value: value.toString(),
    callData,
    payload,
    estimatedGas: String(gas),
});
export function buyHookErc20(p: Common & {
    quote: string;
    minTokensOut: bigint;
}): SquidHook {
    checkCommon(p);
    const user = checkUser(p);
    const quote = lc(p.quote, "quote");
    if (quote === ZERO)
        throw new SquidHookError("NATIVE_QUOTE", "buyFromBalance refuses a native quote: use buyHookNative");
    if (p.minTokensOut <= 0n)
        throw new SquidHookError("NO_MINIMUM", "minTokensOut must be > 0");
    const amm = lc(p.floorAmm, "floorAmm");
    return {
        provider: "FLOOR",
        description: "Buy a FLOOR launch token",
        calls: [
            call(SQUID_CALL.FullTokenBalance, quote, 0n, bytesToHex(encodeCall("transfer(address,uint256)", [amm, SQUID_FULL])), bytesToHex(encodeAbi(["address", "uint256"], [quote, 1n])), SQUID_GAS.transfer),
            call(SQUID_CALL.Default, amm, 0n, bytesToHex(encodeCall("buyFromBalance(uint256,uint256,address,address,uint256)", [p.launchId, p.minTokensOut, user, user, p.deadline])), "0x", SQUID_GAS.buy),
        ],
    };
}
export function buyHookNative(p: Common & {
    zap: string;
    swapData: string;
    minQuoteIn: bigint;
    minTokensOut: bigint;
    quote: string;
}): SquidHook {
    checkCommon(p);
    const user = checkUser(p);
    if (p.minQuoteIn <= 0n || p.minTokensOut <= 0n)
        throw new SquidHookError("NO_MINIMUM", "minQuoteIn and minTokensOut must be > 0");
    const zap = lc(p.zap, "zap");
    const quote = lc(p.quote, "quote");
    const calls = [
        call(SQUID_CALL.FullNativeBalance, zap, 0n, bytesToHex(encodeCall("buyWithEth(uint256,bytes,uint256,uint256,address,uint256)", [p.launchId, p.swapData, p.minQuoteIn, p.minTokensOut, user, p.deadline])), "0x", SQUID_GAS.zapBuy),
        call(SQUID_CALL.FullNativeBalance, user, 0n, "0x", "0x", SQUID_GAS.passOn),
    ];
    if (quote !== ZERO)
        calls.push(call(SQUID_CALL.FullTokenBalance, quote, 0n, bytesToHex(encodeCall("transfer(address,uint256)", [user, SQUID_FULL])), bytesToHex(encodeAbi(["address", "uint256"], [quote, 1n])), SQUID_GAS.transfer));
    return { provider: "FLOOR", description: "Buy a FLOOR launch token with the native coin", calls };
}
export function sellHook(p: Common & {
    token: string;
    tokensIn: bigint;
    minQuoteOut: bigint;
    proceedsTo?: string;
}): SquidHook {
    checkCommon(p);
    lc(p.user, "user");
    if (p.tokensIn <= 0n || p.tokensIn % SQUID_TOKEN_SCALE !== 0n)
        throw new SquidHookError("NOT_WHOLE_UNITS", `${p.tokensIn} is not a positive multiple of ${SQUID_TOKEN_SCALE}`);
    if (p.minQuoteOut <= 0n)
        throw new SquidHookError("NO_MINIMUM", "minQuoteOut must be > 0");
    const to = lc(p.proceedsTo ?? p.multicall, "proceedsTo");
    if (to === ZERO)
        throw new SquidHookError("BAD_RECIPIENT", "proceedsTo");
    const token = lc(p.token, "token");
    const amm = lc(p.floorAmm, "floorAmm");
    return {
        provider: "FLOOR",
        description: "Sell a FLOOR launch token",
        calls: [
            call(SQUID_CALL.Default, token, 0n, bytesToHex(encodeCall("transfer(address,uint256)", [amm, p.tokensIn])), "0x", SQUID_GAS.transfer),
            call(SQUID_CALL.Default, amm, 0n, bytesToHex(encodeCall("sellFromBalance(uint256,uint256,address,uint256)", [p.launchId, p.minQuoteOut, to, p.deadline])), "0x", SQUID_GAS.sell),
        ],
        fundToken: token,
        fundAmount: p.tokensIn.toString(),
    };
}
export function encodeMulticallRun(calls: readonly SquidHookCall[]): string {
    const tuples = calls.map((c) => [BigInt(c.callType), c.target, BigInt(c.value), c.callData, c.payload]);
    return bytesToHex(encodeCall("run((uint8,address,uint256,bytes,bytes)[])", [tuples]));
}
