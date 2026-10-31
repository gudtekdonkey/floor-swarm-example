export interface ProgramErrorRow {
    readonly chain: "solana" | "evm";
    readonly name: string;
    readonly message: string;
    readonly code: number | null;
    readonly selector: string | null;
    readonly signature: string | null;
}
export { SOLANA_ERRORS, SOLANA_EVENT_SCHEMAS } from "./solana.gen.ts";
export type { SolanaEventSchema } from "./solana.gen.ts";
export { EVM_ERRORS, EVM_EVENT_SCHEMAS, EVM_UNNAMED_EVENT_SIGNATURES } from "./evm.gen.ts";
export type { EvmEventSchema } from "./evm.gen.ts";
export { ERC20_ABI, ERC20_DECIMALS_SELECTOR, FLOOR_AMM_ABI, FLOOR_AMM_V2_FUNCTIONS } from "./functions.gen.ts";
export type { EvmFunctionRow } from "./functions.gen.ts";
import { SOLANA_ERRORS } from "./solana.gen.ts";
import { EVM_ERRORS } from "./evm.gen.ts";
let byCode: Map<number, ProgramErrorRow> | undefined;
let bySel: Map<string, ProgramErrorRow> | undefined;
export const solanaErrorByCode = (code: number): ProgramErrorRow | undefined => (byCode ??= new Map(SOLANA_ERRORS.map((e) => [e.code!, e]))).get(code);
export const evmErrorBySelector = (selector: string): ProgramErrorRow | undefined => (bySel ??= new Map(EVM_ERRORS.map((e) => [e.selector!, e]))).get(selector.slice(0, 10).toLowerCase());
