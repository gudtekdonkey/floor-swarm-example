import { FloorError } from "../errors.ts";
import { createEvmClient } from "./evm/index.ts";
import { createSolanaClient } from "./solana/index.ts";
import type { FloorClient, FloorClientOptions, FloorFamily } from "./types.ts";
export { DEFAULT_SLIPPAGE_BPS } from "./types.ts";
export type * from "./types.ts";
export { createEvmClient } from "./evm/index.ts";
export type { EvmFloorClient } from "./evm/index.ts";
export { createSolanaClient } from "./solana/index.ts";
export function createFloorClient(opts: FloorClientOptions<"solana">): FloorClient<"solana">;
export function createFloorClient(opts: FloorClientOptions<"evm">): FloorClient<"evm">;
export function createFloorClient<F extends FloorFamily>(opts: FloorClientOptions<F>): FloorClient<F>;
export function createFloorClient<F extends FloorFamily>(opts: FloorClientOptions<F>): FloorClient<F> {
    const family = opts.chain?.family;
    if (!opts.transport?.rpc)
        throw new FloorError("BadArgument", "createFloorClient: transport.rpc is required", { source: "sdk" });
    if (family === "solana")
        return createSolanaClient(opts as FloorClientOptions<"solana">) as unknown as FloorClient<F>;
    if (family === "evm")
        return createEvmClient(opts as FloorClientOptions<"evm">) as unknown as FloorClient<F>;
    throw new FloorError("BadArgument", `createFloorClient: chain.family ${String(family)}`, { source: "sdk" });
}
