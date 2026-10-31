import { EVM_ERRORS, solanaErrorByCode } from "./abi/index.ts";
import { decodeFloorError } from "./evm/floor/calls.ts";
import { V2_ERRORS_ARGS_EVM, V2_ERRORS_EVM, decodeErrorV2 } from "./v2/evm.ts";
import { FLOOR_AMM_ABI, FLOOR_TOKEN_ABI, FLOOR_ZAP_ABI } from "./evm/floor/iface.ts";
import { bytesToHex, decodeAbi, functionSelector } from "./evm/abi.ts";
import { FLOOR_HOOK_ERRORS, FLOOR_HOOK_PROGRAM_ID } from "./v2/solana.ts";
import { FLOOR_AMM_PROGRAM_ID } from "./solana/floor/program.ts";
export const FLOOR_ERROR_CODES = [
    "SlippageExceeded",
    "DeadlineExpired",
    "NothingToDo",
    "Zero",
    "NothingToBuy",
    "OutOfReach",
    "SellTooLarge",
    "Overflow",
    "MathFailed",
    "BadArgument",
    "BadAccount",
    "QuoteNotListed",
    "TransferFailed",
    "CreatesPaused",
    "PresetUnavailable",
    "TeamBuyTooLarge",
    "Locked",
    "Metadata",
    "OverOwed",
    "UnknownClaimType",
    "TeamSlot",
    "Referral",
    "BurnTooLarge",
    "PageFull",
    "NotAuthorized",
    "NotConfigured",
    "Genesis",
    "Hook",
    "Transport",
    "NoSend",
    "Unknown",
] as const;
export type FloorErrorCode = (typeof FLOOR_ERROR_CODES)[number];
export type FloorErrorSource = "solana" | "evm" | "sdk";
export interface FloorErrorInit {
    source?: FloorErrorSource;
    name?: string | null;
    programCode?: number;
    programId?: string;
    selector?: string;
    args?: Record<string, unknown>;
    mathError?: string;
    cause?: unknown;
}
export class FloorError extends Error {
    readonly code: FloorErrorCode;
    readonly source: FloorErrorSource;
    readonly errorName: string | null;
    readonly programCode: number | undefined;
    readonly programId: string | undefined;
    readonly selector: string | undefined;
    readonly args: Record<string, unknown> | undefined;
    readonly mathError: string | undefined;
    constructor(code: FloorErrorCode, message?: string, init: FloorErrorInit = {}) {
        super(message ?? `floor: ${code}${init.name && init.name !== code ? ` (${init.name})` : ""}`, init.cause === undefined ? undefined : { cause: init.cause });
        this.name = "FloorError";
        this.code = code;
        this.source = init.source ?? "sdk";
        this.errorName = init.name ?? null;
        this.programCode = init.programCode;
        this.programId = init.programId;
        this.selector = init.selector;
        this.args = init.args;
        this.mathError = init.mathError;
    }
}
export function isFloorError(e: unknown, code?: FloorErrorCode): e is FloorError {
    return e instanceof FloorError && (code === undefined || e.code === code);
}
export type QuoteErrorCode = "Zero" | "Overflow" | "SlippageExceeded" | "NothingToBuy" | "OutOfReach";
export class FloorQuoteError extends FloorError {
    declare readonly code: QuoteErrorCode;
    constructor(code: QuoteErrorCode, detail?: string) {
        super(code, `floor quote: ${code}${detail ? ` (${detail})` : ""}`, { source: "sdk", name: code });
        this.name = "FloorQuoteError";
    }
}
export const SOLANA_ERROR_NAMES = [
    "NotAuthority",
    "NotUpgradeAuthority",
    "PresetInvalid",
    "PresetIdNotNext",
    "PresetDeleted",
    "PresetDisabled",
    "QuoteNotListed",
    "CreatesPaused",
    "CreatorBuyTooLarge",
    "SlippageExceeded",
    "NothingToDo",
    "Overflow",
    "MathFailed",
    "BadAccount",
    "ClaimsShort",
    "Locked",
    "OverOwed",
    "UnknownClaimType",
    "TeamSlotRateOverMax",
    "TeamSlotFull",
    "TeamSlotPaid",
    "TeamSlotExists",
    "TeamSlotNoRequest",
    "SellTooLarge",
    "TraderRefMismatch",
    "BadArgument",
    "BadDecimals",
    "GenesisMismatch",
    "NotPendingHandle",
    "NobodyBacked",
    "PageFull",
    "RoleNotHeld",
    "GenesisWrongState",
    "GenesisNotMigrated",
    "GenesisBadRecord",
    "GenesisRaiseEnded",
    "GenesisRaiseNotEnded",
    "GenesisNotMigratedWallet",
    "GenesisBadPreset",
    "GenesisOpenFailed",
    "GenesisVaultShort",
    "MetadataBaseUnset",
    "MetadataBaseInvalid",
    "TreasuryNotSet",
    "NotPriceUpdater",
    "BadMember",
    "GenesisNotListed",
    "GenesisListedAllowanceUsed",
    "QuoteRowCannotOpen",
    "QuoteTransferShort",
    "PresetUnchecked",
    "GenesisRefundUnderRent",
    "GenesisDustNotYet",
    "GenesisConvertCapped",
    "GenesisPriceStale",
    "GenesisConvertSlippage",
    "GenesisSolNotConverted",
    "GenesisWagmiWrongState",
    "GenesisWagmiNoPreset",
    "GenesisWagmiQuoteNotListed",
    "HolderDestNotSet",
    "NotTeamMember",
    "BurnTooLarge",
    "NothingToSettle",
    "HolderPositionExists",
    "HolderPositionNotEmpty",
    "HolderBookMismatch",
    "DeadAccountNotDead",
    "HookAccountsMissing",
    "RowTooManyRanges",
    "RowNotFeasible",
] as const;
export const SOLANA_ERROR_BASE = 6000;
const EXACT: Readonly<Record<string, FloorErrorCode>> = {
    SlippageExceeded: "SlippageExceeded",
    GenesisConvertSlippage: "SlippageExceeded",
    QuoteShort: "SlippageExceeded",
    Expired: "DeadlineExpired",
    NothingToDo: "NothingToDo",
    NothingToSettle: "NothingToDo",
    NothingToUnlock: "NothingToDo",
    NobodyBacked: "NothingToDo",
    SellTooLarge: "SellTooLarge",
    Overflow: "Overflow",
    MathFailed: "MathFailed",
    BadArgument: "BadArgument",
    BadValue: "BadArgument",
    BadDecimals: "BadArgument",
    SwapDataNotEmpty: "BadArgument",
    BadAccount: "BadAccount",
    HolderBookMismatch: "BadAccount",
    HookAccountsMissing: "BadAccount",
    DeadAccountNotDead: "BadAccount",
    HolderPositionExists: "BadAccount",
    HolderPositionNotEmpty: "BadAccount",
    UnknownLaunch: "BadAccount",
    QuoteNotListed: "QuoteNotListed",
    QuoteDisabled: "QuoteNotListed",
    QuoteListed: "QuoteNotListed",
    QuoteRowCannotOpen: "QuoteNotListed",
    QuoteTransferShort: "TransferFailed",
    NativeTransferFailed: "TransferFailed",
    SwapFailed: "TransferFailed",
    Reentrancy: "TransferFailed",
    CreatesPaused: "CreatesPaused",
    PresetInvalid: "PresetUnavailable",
    PresetIdNotNext: "PresetUnavailable",
    PresetDeleted: "PresetUnavailable",
    PresetDisabled: "PresetUnavailable",
    PresetUnchecked: "PresetUnavailable",
    RowTooManyRanges: "PresetUnavailable",
    RowNotFeasible: "PresetUnavailable",
    CreatorBuyTooLarge: "TeamBuyTooLarge",
    Locked: "Locked",
    MetadataBaseUnset: "Metadata",
    MetadataBaseInvalid: "Metadata",
    OverOwed: "OverOwed",
    ClaimsShort: "OverOwed",
    UnknownClaimType: "UnknownClaimType",
    TeamSlotRateOverMax: "TeamSlot",
    TeamSlotFull: "TeamSlot",
    TeamSlotPaid: "TeamSlot",
    TeamSlotExists: "TeamSlot",
    TeamSlotNoRequest: "TeamSlot",
    NotPendingHandle: "TeamSlot",
    BadMember: "TeamSlot",
    HandleAlreadyBound: "TeamSlot",
    TraderRefMismatch: "Referral",
    TraderRefSet: "Referral",
    BadReferralSig: "Referral",
    BadSignature: "Referral",
    ReferralSigExpired: "Referral",
    BurnTooLarge: "BurnTooLarge",
    PageFull: "PageFull",
    NotAuthority: "NotAuthorized",
    NotUpgradeAuthority: "NotAuthorized",
    NotPriceUpdater: "NotAuthorized",
    RoleNotHeld: "NotAuthorized",
    NotTeamMember: "NotAuthorized",
    NotCreator: "NotAuthorized",
    NotTimelock: "NotAuthorized",
    NotReferralAuthority: "NotAuthorized",
    NotRouter: "NotAuthorized",
    NotProgram: "NotAuthorized",
    NotToken: "NotAuthorized",
    TreasuryNotSet: "NotConfigured",
    TreasuryUnset: "NotConfigured",
    HolderDestNotSet: "NotConfigured",
    HolderDestUnset: "NotConfigured",
};
export function errorCodeOf(name: string): FloorErrorCode {
    return EXACT[name] ?? (name.startsWith("Genesis") ? "Genesis" : "Unknown");
}
const HOOK_NAMES: ReadonlyMap<number, string> = new Map(Object.entries(FLOOR_HOOK_ERRORS).map(([n, c]) => [c, n]));
export function solanaErrorOf(code: number, programId: string = FLOOR_AMM_PROGRAM_ID, ids: {
    programId?: string;
    hookProgramId?: string;
} = {}): FloorError | null {
    const amm = ids.programId ?? FLOOR_AMM_PROGRAM_ID;
    const hook = ids.hookProgramId ?? FLOOR_HOOK_PROGRAM_ID;
    if (programId === hook) {
        const name = HOOK_NAMES.get(code);
        return name === undefined ? null : new FloorError("Hook", undefined, { source: "solana", name, programCode: code, programId });
    }
    if (programId !== amm)
        return null;
    const name = SOLANA_ERROR_NAMES[code - SOLANA_ERROR_BASE] ?? solanaErrorByCode(code)?.name;
    if (name === undefined)
        return null;
    return new FloorError(errorCodeOf(name), undefined, { source: "solana", name, programCode: code, programId });
}
const LOG_FAILED = /^Program (\w+) failed: custom program error: 0x([0-9a-fA-F]+)/;
const LOG_ANCHOR = /Error Number: (\d+)\./;
const LOG_INVOKE = /^Program (\w+) invoke \[\d+\]/;
export function decodeSolanaProgramError(raw: unknown, ids: {
    programId?: string;
    hookProgramId?: string;
} = {}): FloorError | null {
    const amm = ids.programId ?? FLOOR_AMM_PROGRAM_ID;
    if (raw instanceof FloorError)
        return raw;
    if (typeof raw === "number")
        return solanaErrorOf(raw, amm, ids);
    if (Array.isArray(raw) && raw.every((l) => typeof l === "string"))
        return fromLogs(raw as string[], ids);
    if (raw === null || typeof raw !== "object")
        return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.code === "number")
        return solanaErrorOf(o.code, typeof o.programId === "string" ? o.programId : amm, ids);
    if (Array.isArray(o.InstructionError)) {
        const custom = (o.InstructionError[1] as {
            Custom?: unknown;
        } | undefined)?.Custom;
        if (typeof custom === "number")
            return solanaErrorOf(custom, typeof o.programId === "string" ? o.programId : amm, ids);
        return null;
    }
    if (Array.isArray(o.logs)) {
        const e = fromLogs(o.logs.filter((l): l is string => typeof l === "string"), ids);
        if (e)
            return e;
    }
    if (o.err !== undefined)
        return decodeSolanaProgramError(o.err, ids);
    return null;
}
function fromLogs(logs: readonly string[], ids: {
    programId?: string;
    hookProgramId?: string;
}): FloorError | null {
    let current: string | undefined;
    for (const l of logs) {
        const inv = LOG_INVOKE.exec(l);
        if (inv)
            current = inv[1];
        const f = LOG_FAILED.exec(l);
        if (f) {
            const e = solanaErrorOf(parseInt(f[2], 16), f[1], ids);
            if (e)
                return e;
        }
        const a = LOG_ANCHOR.exec(l);
        if (a && l.includes("AnchorError")) {
            const e = solanaErrorOf(Number(a[1]), current ?? ids.programId ?? FLOOR_AMM_PROGRAM_ID, ids);
            if (e)
                return e;
        }
    }
    return null;
}
const HEX = /^0x[0-9a-fA-F]*$/;
function revertData(raw: unknown, depth = 0): string | null {
    if (typeof raw === "string")
        return HEX.test(raw) && raw.length >= 10 ? raw : null;
    if (raw === null || typeof raw !== "object" || depth > 4)
        return null;
    const o = raw as Record<string, unknown>;
    for (const k of ["data", "error", "cause"]) {
        const d = revertData(o[k], depth + 1);
        if (d)
            return d;
    }
    return null;
}
export const LIBRARY_ERRORS_EVM: Readonly<Record<string, FloorErrorCode>> = Object.freeze({
    "ERC20InsufficientAllowance(address,uint256,uint256)": "TransferFailed",
    "ERC20InsufficientBalance(address,uint256,uint256)": "TransferFailed",
    "ERC20InvalidApprover(address)": "TransferFailed",
    "ERC20InvalidReceiver(address)": "TransferFailed",
    "ERC20InvalidSender(address)": "TransferFailed",
    "ERC20InvalidSpender(address)": "TransferFailed",
    "SafeERC20FailedOperation(address)": "TransferFailed",
    "InsufficientBalance(uint256,uint256)": "TransferFailed",
    "ZeroAddress()": "BadArgument",
    "ERC2612ExpiredSignature(uint256)": "DeadlineExpired",
    "ERC2612InvalidSigner(address,address)": "BadArgument",
    "InvalidAccountNonce(address,uint256)": "BadArgument",
    "ECDSAInvalidSignature()": "BadArgument",
    "ECDSAInvalidSignatureLength(uint256)": "BadArgument",
    "ECDSAInvalidSignatureS(bytes32)": "BadArgument",
    "StringsInsufficientHexLength(uint256,uint256)": "BadArgument",
    "AddressEmptyCode(address)": "Unknown",
    "FailedCall()": "Unknown",
    "FailedDeployment()": "Unknown",
    "ERC1967InvalidImplementation(address)": "Unknown",
    "ERC1967NonPayable()": "Unknown",
    "InvalidInitialization()": "Unknown",
    "NotInitializing()": "Unknown",
    "UUPSUnauthorizedCallContext()": "Unknown",
    "UUPSUnsupportedProxiableUUID(bytes32)": "Unknown",
    "Error(string)": "Unknown",
    "Panic(uint256)": "Unknown",
});
interface Sig {
    name: string;
    types: string[];
    argNames: string[];
}
let sigs: Map<string, Sig> | undefined;
function sigTable(): Map<string, Sig> {
    if (sigs)
        return sigs;
    sigs = new Map();
    const add = (sig: string, argNames: string[] = []): void => {
        const name = sig.slice(0, sig.indexOf("("));
        const inner = sig.slice(sig.indexOf("(") + 1, -1);
        const sel = bytesToHex(functionSelector(sig));
        if (!sigs!.has(sel))
            sigs!.set(sel, { name, types: inner === "" ? [] : inner.split(","), argNames });
    };
    type Item = {
        type: string;
        name?: string;
        inputs?: readonly {
            name?: string;
            type: string;
        }[];
    };
    for (const abi of [FLOOR_AMM_ABI, FLOOR_ZAP_ABI, FLOOR_TOKEN_ABI] as unknown as readonly Item[][]) {
        for (const it of abi)
            if (it.type === "error")
                add(`${it.name}(${(it.inputs ?? []).map((i) => i.type).join(",")})`, (it.inputs ?? []).map((i, k) => i.name || String(k)));
    }
    for (const n of V2_ERRORS_EVM)
        add(`${n}()`);
    for (const s of V2_ERRORS_ARGS_EVM)
        add(s);
    for (const s of Object.keys(LIBRARY_ERRORS_EVM))
        add(s, s === "Panic(uint256)" ? ["code"] : []);
    for (const r of EVM_ERRORS)
        if (r.signature)
            add(r.signature);
    return sigs;
}
export function decodeEvmProgramError(raw: unknown): FloorError | null {
    if (raw instanceof FloorError)
        return raw;
    const data = revertData(raw);
    if (!data)
        return null;
    const selector = data.slice(0, 10).toLowerCase();
    let e: ReturnType<typeof decodeFloorError> = null;
    try {
        e = decodeFloorError(data);
    }
    catch {
        e = null;
    }
    if (e)
        return new FloorError(errorCodeOf(e.name), undefined, { source: "evm", name: e.name, selector, args: e.args, mathError: e.mathError });
    const v2 = decodeErrorV2(data);
    if (v2)
        return new FloorError(errorCodeOf(v2), undefined, { source: "evm", name: v2, selector });
    const s = sigTable().get(selector);
    if (!s)
        return null;
    let args: Record<string, unknown> | undefined;
    if (s.types.length > 0 && data.length > 10) {
        try {
            const vals = decodeAbi(s.types, "0x" + data.slice(10));
            args = Object.fromEntries(vals.map((v, i) => [s.argNames[i] ?? String(i), v]));
        }
        catch {
            args = undefined;
        }
    }
    const sig = `${s.name}(${s.types.join(",")})`;
    const code = LIBRARY_ERRORS_EVM[sig] ?? errorCodeOf(s.name);
    return new FloorError(code, undefined, { source: "evm", name: s.name, selector, args });
}
export const decodeProgramError: Readonly<{
    solana: typeof decodeSolanaProgramError;
    evm: typeof decodeEvmProgramError;
}> = Object.freeze({
    solana: decodeSolanaProgramError,
    evm: decodeEvmProgramError,
});
