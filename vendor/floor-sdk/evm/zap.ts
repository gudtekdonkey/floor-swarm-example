import { bytesToHex, checksumAddress, encodeAbi, hexToBytes } from "./abi.ts";
import { encodeFunctionData } from "./items.ts";
export type ZapFamily = "uniswap-ur" | "v3-router" | "v3-router02" | "algebra" | "v2-router" | "aerodrome-v2";
export type ZapUrFork = "uniswap" | "aerodrome" | "pancake" | "ramses";
export const AERODROME_SLIPSTREAM_KEY = 1048576;
export const UR_V3_SWAP_EXACT_IN = 0;
export const UR_V2_SWAP_EXACT_IN = 8;
export const UR_WRAP_ETH = 11;
export const UR_UNWRAP_WETH = 12;
export const UR_SWEEP = 4;
export const UR_V4_SWAP = 16;
export const UR_MSG_SENDER = "0x0000000000000000000000000000000000000001";
export const UR_ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
export const V4_SWAP_EXACT_IN_SINGLE = 6;
export const V4_SETTLE = 11;
export const V4_TAKE = 14;
export const V4_OPEN_DELTA = 0n;
export const V4_NATIVE = "0x0000000000000000000000000000000000000000";
export interface ZapV4Pool {
    fee: number;
    tickSpacing: number;
    hooks?: string;
    hookData?: string;
}
export interface V4PoolKey {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
}
export interface ZapRoute {
    tokens: readonly string[];
    fees?: readonly number[];
    stable?: readonly boolean[];
    factory?: string;
    v4?: ZapV4Pool;
}
export interface ZapSwapParams {
    family: ZapFamily;
    route: ZapRoute;
    amountIn: bigint;
    minQuoteOut: bigint;
    zap: string;
    deadline: bigint;
    input?: "native" | "token";
    output?: "token" | "native";
    router?: string;
    urFork?: ZapUrFork;
}
const fn = (name: string, inputs: readonly {
    name: string;
    type: string;
    components?: any;
}[]) => ({ type: "function", name, inputs, outputs: [], stateMutability: "payable" }) as const;
const tup = (fields: [
    string,
    string
][]) => fields.map(([name, type]) => ({ name, type }));
export function v3Path(tokens: readonly string[], fees: readonly number[]): string {
    if (tokens.length < 2 || fees.length !== tokens.length - 1)
        throw new RangeError("a V3 path is n tokens and n \u2212 1 fees");
    let out = "0x";
    tokens.forEach((t, i) => {
        out += bytesToHex(hexToBytes(t)).slice(2);
        if (i < fees.length) {
            const f = fees[i];
            if (!Number.isInteger(f) || f < 0 || f >= 1 << 24)
                throw new RangeError(`fee ${f} is not a uint24`);
            out += f.toString(16).padStart(6, "0");
        }
    });
    return out;
}
export function algebraPath(tokens: readonly string[]): string {
    if (tokens.length < 2)
        throw new RangeError("a path is at least two tokens");
    return "0x" + tokens.map((t) => bytesToHex(hexToBytes(t)).slice(2)).join("");
}
const UR_FORKS: readonly ZapUrFork[] = ["uniswap", "aerodrome", "pancake", "ramses"];
interface Ends {
    nativeIn: boolean;
    nativeOut: boolean;
}
const isNative = (a: string): boolean => BigInt(checksumAddress(a)) === 0n;
const checkRoute = (p: ZapSwapParams): Ends => {
    if (p.amountIn <= 0n)
        throw new RangeError("amountIn must be > 0");
    if (p.minQuoteOut <= 0n)
        throw new RangeError("minQuoteOut must be > 0 (the NO_MINIMUM rule)");
    const { tokens } = p.route;
    if (tokens.length < 2)
        throw new RangeError("a route is at least two tokens");
    if (p.input !== undefined && p.input !== "native" && p.input !== "token")
        throw new RangeError(`input ${String(p.input)} is "native" or "token"`);
    if (p.output !== undefined && p.output !== "native" && p.output !== "token")
        throw new RangeError(`output ${String(p.output)} is "native" or "token"`);
    if (p.urFork !== undefined && (p.family !== "uniswap-ur" || !UR_FORKS.includes(p.urFork))) {
        throw new RangeError(`urFork ${String(p.urFork)} names a uniswap-ur row's router: ${UR_FORKS.join(", ")}`);
    }
    const [first, last] = [tokens[0], tokens[tokens.length - 1]];
    if (BigInt(checksumAddress(first)) === BigInt(checksumAddress(last)))
        throw new RangeError("a route swaps a coin into itself");
    if (p.route.v4) {
        if (p.family !== "uniswap-ur")
            throw new RangeError("a v4 route goes through the Universal Router (uniswap-ur)");
        if ((p.urFork ?? "uniswap") !== "uniswap")
            throw new RangeError("a v4 route goes through Uniswap's own Universal Router");
        const ends = { nativeIn: isNative(first), nativeOut: isNative(last) };
        if (p.input !== undefined && (p.input === "native") !== ends.nativeIn)
            throw new RangeError(`input "${p.input}" is not the v4 route's first currency`);
        if (p.output !== undefined && (p.output === "native") !== ends.nativeOut)
            throw new RangeError(`output "${p.output}" is not the v4 route's last currency`);
        return ends;
    }
    if (tokens.some(isNative))
        throw new RangeError("a V2 / V3 route names the wrapped native, never address(0) (only a v4 route holds the native coin)");
    const ends = { nativeIn: (p.input ?? "native") === "native", nativeOut: (p.output ?? "token") === "native" };
    if (ends.nativeIn && ends.nativeOut)
        throw new RangeError("a route swaps the native coin into itself");
    return ends;
};
export function v4PoolKey(tokenIn: string, tokenOut: string, pool: ZapV4Pool): {
    key: V4PoolKey;
    zeroForOne: boolean;
} {
    const a = checksumAddress(tokenIn);
    const b = checksumAddress(tokenOut);
    if (BigInt(a) === BigInt(b))
        throw new RangeError("a v4 swap is between two different currencies");
    if (!Number.isInteger(pool.fee) || pool.fee < 0 || pool.fee >= 1 << 24)
        throw new RangeError(`fee ${pool.fee} is not a uint24`);
    if (!Number.isInteger(pool.tickSpacing) || pool.tickSpacing < 1 || pool.tickSpacing > 32767)
        throw new RangeError(`tick spacing ${pool.tickSpacing} is not 1 ..= 32767`);
    const zeroForOne = BigInt(a) < BigInt(b);
    const hooks = checksumAddress(pool.hooks ?? V4_NATIVE);
    return { key: { currency0: zeroForOne ? a : b, currency1: zeroForOne ? b : a, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks }, zeroForOne };
}
const UINT128 = 1n << 128n;
const UR_EXECUTE = [fn("execute", [{ name: "commands", type: "bytes" }, { name: "inputs", type: "bytes[]" }, { name: "deadline", type: "uint256" }])];
const cmds = (cs: readonly number[]): string => "0x" + cs.map((c) => c.toString(16).padStart(2, "0")).join("");
function universalRouterV4(p: ZapSwapParams, pool: ZapV4Pool): string {
    const { tokens } = p.route;
    if (tokens.length !== 2)
        throw new RangeError("a v4 route is one pool: [currency in, currency out]");
    if (p.route.fees || p.route.stable || p.route.factory)
        throw new RangeError("a v4 route names its pool in `v4` only");
    if (p.amountIn >= UINT128 || p.minQuoteOut >= UINT128)
        throw new RangeError("a v4 amount is a uint128");
    const [tokenIn, tokenOut] = tokens;
    const { key, zeroForOne } = v4PoolKey(tokenIn, tokenOut, pool);
    const nativeOut = isNative(tokenOut);
    const swap = encodeAbi(["((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)"], [[[key.currency0, key.currency1, BigInt(key.fee), BigInt(key.tickSpacing), key.hooks], zeroForOne, p.amountIn, p.minQuoteOut, 0n, pool.hookData ?? "0x"]]);
    const settle = encodeAbi(["address", "uint256", "bool"], [checksumAddress(tokenIn), V4_OPEN_DELTA, false]);
    const take = encodeAbi(["address", "address", "uint256"], [checksumAddress(tokenOut), nativeOut ? UR_ADDRESS_THIS : UR_MSG_SENDER, V4_OPEN_DELTA]);
    const v4 = bytesToHex(encodeAbi(["bytes", "bytes[]"], [cmds([V4_SWAP_EXACT_IN_SINGLE, V4_SETTLE, V4_TAKE]), [swap, settle, take]]));
    const nativeIn = isNative(tokenIn);
    const sweep = (min: bigint): string => bytesToHex(encodeAbi(["address", "address", "uint256"], [V4_NATIVE, UR_MSG_SENDER, min]));
    const inputs = nativeOut ? [v4, sweep(p.minQuoteOut)] : nativeIn ? [v4, sweep(0n)] : [v4];
    return encodeFunctionData(UR_EXECUTE, "execute", { commands: cmds(nativeOut ? [UR_V4_SWAP, UR_SWEEP] : nativeIn ? [UR_V4_SWAP, UR_SWEEP] : [UR_V4_SWAP]), inputs, deadline: p.deadline });
}
const UR_SWAP_HEAD = ["address", "uint256", "uint256", "bytes", "bool"];
function aerodromeKey(k: number): number {
    if (!Number.isInteger(k) || k < 1 || k >= 1 << 24)
        throw new RangeError(`Aerodrome key ${k} is not a tick spacing`);
    if (k < AERODROME_SLIPSTREAM_KEY)
        return AERODROME_SLIPSTREAM_KEY | k;
    if (k >>> 20 !== 1)
        throw new RangeError(`Aerodrome key ${k} names another factory than Slipstream's (0x100000 | tickSpacing)`);
    return k;
}
function universalRouter(p: ZapSwapParams, e: Ends): string {
    const fork = p.urFork ?? "uniswap";
    const to = e.nativeOut ? UR_ADDRESS_THIS : UR_MSG_SENDER;
    const commands: number[] = [];
    const inputs: string[] = [];
    if (e.nativeIn) {
        commands.push(UR_WRAP_ETH);
        inputs.push(bytesToHex(encodeAbi(["address", "uint256"], [UR_ADDRESS_THIS, p.amountIn])));
    }
    if (p.route.fees) {
        const keys = fork === "aerodrome" ? p.route.fees.map(aerodromeKey) : p.route.fees;
        const head = [to, p.amountIn, p.minQuoteOut, v3Path(p.route.tokens, keys), false];
        const swap = fork === "uniswap" ? encodeAbi([...UR_SWAP_HEAD, "uint256[]"], [...head, []])
            : fork === "aerodrome" ? encodeAbi([...UR_SWAP_HEAD, "bool"], [...head, false])
                : encodeAbi(UR_SWAP_HEAD, head);
        commands.push(UR_V3_SWAP_EXACT_IN);
        inputs.push(bytesToHex(swap));
    }
    else {
        if (fork !== "uniswap")
            throw new RangeError(`a V2 leg through ${fork}'s Universal Router is not spelled (its V2_SWAP_EXACT_IN input is its own)`);
        commands.push(UR_V2_SWAP_EXACT_IN);
        inputs.push(bytesToHex(encodeAbi(["address", "uint256", "uint256", "address[]", "bool", "uint256[]"], [to, p.amountIn, p.minQuoteOut, [...p.route.tokens], false, []])));
    }
    if (e.nativeOut) {
        commands.push(UR_UNWRAP_WETH);
        inputs.push(bytesToHex(encodeAbi(["address", "uint256"], [UR_MSG_SENDER, p.minQuoteOut])));
    }
    if (e.nativeIn) {
        commands.push(UR_SWEEP);
        inputs.push(bytesToHex(encodeAbi(["address", "address", "uint256"], [V4_NATIVE, UR_MSG_SENDER, 0n])));
    }
    return encodeFunctionData(UR_EXECUTE, "execute", { commands: cmds(commands), inputs, deadline: p.deadline });
}
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const REFUND_ETH = [fn("refundETH", [])];
const REFUND_NATIVE = [fn("refundNativeToken", [])];
const UNWRAP = (name: string) => [fn(name, [{ name: "amountMinimum", type: "uint256" }, { name: "recipient", type: "address" }])];
const peripheryTail = (p: ZapSwapParams, e: Ends, refund: string, unwrap: string): string[] => e.nativeIn ? [encodeFunctionData(refund === "refundETH" ? REFUND_ETH : REFUND_NATIVE, refund)]
    : e.nativeOut ? [encodeFunctionData(UNWRAP(unwrap), unwrap, { amountMinimum: p.minQuoteOut, recipient: p.zap })]
        : [];
function v3Router(p: ZapSwapParams, v02: boolean, e: Ends): string {
    const fees = p.route.fees;
    if (!fees)
        throw new RangeError("a V3 router route needs its fees");
    if (e.nativeOut && !v02 && !p.router)
        throw new RangeError("a SwapRouter v1 native out is paid to the router, then unwrapped: pass the zap's `router`");
    const recipient = !e.nativeOut ? p.zap : v02 ? UR_ADDRESS_THIS : checksumAddress(p.router as string);
    const [tokenIn, tokenOut] = [p.route.tokens[0], p.route.tokens[p.route.tokens.length - 1]];
    let swap: string;
    if (p.route.tokens.length === 2) {
        const fields: [
            string,
            string
        ][] = v02
            ? [["tokenIn", "address"], ["tokenOut", "address"], ["fee", "uint24"], ["recipient", "address"], ["amountIn", "uint256"], ["amountOutMinimum", "uint256"], ["sqrtPriceLimitX96", "uint160"]]
            : [["tokenIn", "address"], ["tokenOut", "address"], ["fee", "uint24"], ["recipient", "address"], ["deadline", "uint256"], ["amountIn", "uint256"], ["amountOutMinimum", "uint256"], ["sqrtPriceLimitX96", "uint160"]];
        const abi = [fn("exactInputSingle", [{ name: "params", type: "tuple", components: tup(fields) }])];
        swap = encodeFunctionData(abi, "exactInputSingle", { params: { tokenIn, tokenOut, fee: BigInt(fees[0]), recipient, deadline: p.deadline, amountIn: p.amountIn, amountOutMinimum: p.minQuoteOut, sqrtPriceLimitX96: 0n } });
    }
    else {
        const fields: [
            string,
            string
        ][] = v02
            ? [["path", "bytes"], ["recipient", "address"], ["amountIn", "uint256"], ["amountOutMinimum", "uint256"]]
            : [["path", "bytes"], ["recipient", "address"], ["deadline", "uint256"], ["amountIn", "uint256"], ["amountOutMinimum", "uint256"]];
        const abi = [fn("exactInput", [{ name: "params", type: "tuple", components: tup(fields) }])];
        swap = encodeFunctionData(abi, "exactInput", { params: { path: v3Path(p.route.tokens, fees), recipient, deadline: p.deadline, amountIn: p.amountIn, amountOutMinimum: p.minQuoteOut } });
    }
    const data = [swap, ...peripheryTail(p, e, "refundETH", "unwrapWETH9")];
    if (v02)
        return encodeFunctionData([fn("multicall", [{ name: "deadline", type: "uint256" }, { name: "data", type: "bytes[]" }])], "multicall", { deadline: p.deadline, data });
    return encodeFunctionData([fn("multicall", [{ name: "data", type: "bytes[]" }])], "multicall", { data });
}
function algebra(p: ZapSwapParams, e: Ends): string {
    const recipient = e.nativeOut ? ADDRESS_ZERO : p.zap;
    const [tokenIn, tokenOut] = [p.route.tokens[0], p.route.tokens[p.route.tokens.length - 1]];
    let swap: string;
    if (p.route.tokens.length === 2) {
        const fields: [
            string,
            string
        ][] = [["tokenIn", "address"], ["tokenOut", "address"], ["recipient", "address"], ["deadline", "uint256"], ["amountIn", "uint256"], ["amountOutMinimum", "uint256"], ["limitSqrtPrice", "uint160"]];
        swap = encodeFunctionData([fn("exactInputSingle", [{ name: "params", type: "tuple", components: tup(fields) }])], "exactInputSingle", { params: { tokenIn, tokenOut, recipient, deadline: p.deadline, amountIn: p.amountIn, amountOutMinimum: p.minQuoteOut, limitSqrtPrice: 0n } });
    }
    else {
        const fields: [
            string,
            string
        ][] = [["path", "bytes"], ["recipient", "address"], ["deadline", "uint256"], ["amountIn", "uint256"], ["amountOutMinimum", "uint256"]];
        swap = encodeFunctionData([fn("exactInput", [{ name: "params", type: "tuple", components: tup(fields) }])], "exactInput", { params: { path: algebraPath(p.route.tokens), recipient, deadline: p.deadline, amountIn: p.amountIn, amountOutMinimum: p.minQuoteOut } });
    }
    return encodeFunctionData([fn("multicall", [{ name: "data", type: "bytes[]" }])], "multicall", { data: [swap, ...peripheryTail(p, e, "refundNativeToken", "unwrapWNativeToken")] });
}
const v2Name = (e: Ends): string => (e.nativeIn ? "swapExactETHForTokens" : e.nativeOut ? "swapExactTokensForETH" : "swapExactTokensForTokens");
function v2Router(p: ZapSwapParams, e: Ends): string {
    const name = v2Name(e);
    const head: [
        string,
        string
    ][] = e.nativeIn ? [] : [["amountIn", "uint256"]];
    const abi = [fn(name, tup([...head, ["amountOutMin", "uint256"], ["path", "address[]"], ["to", "address"], ["deadline", "uint256"]]))];
    return encodeFunctionData(abi, name, { amountIn: p.amountIn, amountOutMin: p.minQuoteOut, path: [...p.route.tokens], to: p.zap, deadline: p.deadline });
}
function aerodromeV2(p: ZapSwapParams, e: Ends): string {
    const { tokens, stable, factory } = p.route;
    if (!stable || stable.length !== tokens.length - 1 || !factory)
        throw new RangeError("an Aerodrome route needs a stable flag per hop and the factory");
    const route = { name: "routes", type: "tuple[]", components: tup([["from", "address"], ["to", "address"], ["stable", "bool"], ["factory", "address"]]) };
    const name = v2Name(e);
    const head = e.nativeIn ? [] : [{ name: "amountIn", type: "uint256" }];
    const abi = [fn(name, [...head, { name: "amountOutMin", type: "uint256" }, route, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }])];
    const routes = stable.map((s, i) => ({ from: tokens[i], to: tokens[i + 1], stable: s, factory }));
    return encodeFunctionData(abi, name, { amountIn: p.amountIn, amountOutMin: p.minQuoteOut, routes, to: p.zap, deadline: p.deadline });
}
export function zapSwapData(p: ZapSwapParams): string {
    const e = checkRoute(p);
    checksumAddress(p.zap);
    switch (p.family) {
        case "uniswap-ur":
            return p.route.v4 ? universalRouterV4(p, p.route.v4) : universalRouter(p, e);
        case "v3-router":
            return v3Router(p, false, e);
        case "v3-router02":
            return v3Router(p, true, e);
        case "algebra":
            return algebra(p, e);
        case "v2-router":
            return v2Router(p, e);
        case "aerodrome-v2":
            return aerodromeV2(p, e);
    }
}
