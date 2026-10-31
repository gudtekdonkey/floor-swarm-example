import { readUintLE } from "../../codec.ts";
import { FloorError, decodeSolanaProgramError, errorCodeOf } from "../../errors.ts";
import { FloorMathError } from "../../math/index.ts";
import { nextBuyPriceX64 } from "../../math/v2/display.ts";
import { LEG_BACKING, LEG_FLOOR, LEG_HOLDER, LEG_PLATFORM, LEG_TEAM } from "../../math/v2/fees.ts";
import { priceImpactV2, quoteSellImpactV2 } from "../../math/v2/receipt.ts";
import { sCirc } from "../../math/v2/supply.ts";
import { CLAIM_SHARE_BOUGHT, CLAIM_TEAM_BUY, CLAIM_TRADER_REF } from "../../solana/floor/instructions.ts";
import { FLOOR_AMM_PROGRAM_ID, configPda, launchPda, refOwedPda, refOwedVault, teamSlotPda, traderRefEscrow, traderRefPda } from "../../solana/floor/program.ts";
import { MAX_COMPUTE_UNIT_LIMIT, computeUnitLimitInstruction } from "../../solana/instruction.ts";
import type { Instruction } from "../../solana/instruction.ts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WSOL_MINT, associatedTokenAddress } from "../../solana/pda.ts";
import { closeAccountInstruction, createAssociatedTokenAccountIdempotentInstruction, syncNativeInstruction, systemTransferInstruction } from "../../solana/tx.ts";
import { CLAIM_COMPUTE_UNIT_LIMIT_V2 } from "../../v2/claims.ts";
import { FLOOR_HOOK_PROGRAM_ID, buyWithPositionInstructions, claimInstructionV2, holderPositionPda, sellInstructionV2 } from "../../v2/solana.ts";
import type { ClaimLaunchV2, TradeAccountsV2 } from "../../v2/solana.ts";
import { quoteBuySolanaV2, solanaSettleInputsV2 } from "../../v2/solanaSettle.ts";
import { buyLessIn, buyMinTokens } from "../../math/v2/trade.ts";
import { SOL_BUY_WALK_STEPS } from "../../math/v2/book.ts";
import { MAX_SLIPPAGE_BPS, minOutAt } from "../../v2/press.ts";
import { fillsNothing } from "../../v2/route.ts";
import { decodeQuoteTransferFeeV2, quoteReceivedV2, quoteTransferFeeV2 } from "../../v2/quoteMint.ts";
import type { QuoteTransferFeeV2 } from "../../v2/quoteMint.ts";
import { decodeLaunchV2Typed } from "../../v2/types.ts";
import type { LaunchV2Account } from "../../v2/types.ts";
import { DEFAULT_SLIPPAGE_BPS } from "../types.ts";
import type { BuildBuyParams, BuildSellParams, ClaimParams, FeeLegs, FloorClient, FloorClientOptions, Quote, QuoteBuyParams, QuoteSellParams, SolanaAccount, SolanaTx } from "../types.ts";
const MINT_SUPPLY_AT = 36;
function asFloorError(e: unknown): FloorError {
    if (e instanceof FloorError)
        return e;
    if (e instanceof FloorMathError) {
        const code = errorCodeOf(e.code);
        return new FloorError(code === "Unknown" || code === "Genesis" ? "MathFailed" : code, e.message, { source: "sdk", name: e.code, mathError: e.code, cause: e });
    }
    if (e instanceof RangeError)
        return new FloorError("BadArgument", e.message, { source: "sdk", cause: e });
    return new FloorError("Unknown", e instanceof Error ? e.message : String(e), { source: "sdk", cause: e });
}
async function guard<T>(f: () => Promise<T>): Promise<T> {
    try {
        return await f();
    }
    catch (e) {
        throw asFloorError(e);
    }
}
const bad = (message: string): FloorError => new FloorError("BadArgument", message, { source: "sdk" });
function slippageOf(bps: number | undefined): number {
    const s = bps ?? DEFAULT_SLIPPAGE_BPS;
    if (!Number.isInteger(s) || s < 0 || s > MAX_SLIPPAGE_BPS)
        throw bad(`slippageBps ${s}: 0 ..= ${MAX_SLIPPAGE_BPS}`);
    return s;
}
const lessSlippage = (x: bigint, bps: number): bigint => (x > 0n ? minOutAt(x, bps) : 1n);
function feeLegs(f: readonly bigint[]): FeeLegs {
    return { backing: f[LEG_BACKING], team: f[LEG_TEAM], platform: f[LEG_PLATFORM], floor: f[LEG_FLOOR], holder: f[LEG_HOLDER], total: f.reduce((a, x) => a + x, 0n) };
}
const impactBps = (ppm: bigint | null): number | null => (ppm === null ? null : Number(ppm / 100n));
export function createSolanaClient(opts: FloorClientOptions<"solana">): FloorClient<"solana"> {
    const { chain, transport } = opts;
    if (chain?.family !== "solana")
        throw bad(`createSolanaClient: chain family ${String((chain as {
            family?: unknown;
        } | undefined)?.family)}`);
    const pid = chain.programId ?? FLOOR_AMM_PROGRAM_ID;
    const hid = chain.hookProgramId ?? FLOOR_HOOK_PROGRAM_ID;
    const ids = { programId: pid, hookProgramId: hid };
    async function get(address: string): Promise<SolanaAccount | null> {
        try {
            return await transport.rpc.getAccount(address);
        }
        catch (e) {
            throw new FloorError("Transport", `getAccount ${address}: ${e instanceof Error ? e.message : String(e)}`, { source: "sdk", cause: e });
        }
    }
    async function launchOf(mint: string): Promise<{
        address: string;
        l: LaunchV2Account;
    }> {
        const address = launchPda(mint, pid)[0];
        const a = await get(address);
        if (a === null)
            throw new FloorError("BadAccount", `no launch for mint ${mint} (${address})`, { source: "sdk" });
        if (a.owner !== pid)
            throw new FloorError("BadAccount", `launch ${address} is owned by ${a.owner}, not ${pid}`, { source: "sdk" });
        let l: LaunchV2Account;
        try {
            l = decodeLaunchV2Typed(a.data);
        }
        catch (e) {
            throw new FloorError("BadAccount", `launch ${address}: ${e instanceof Error ? e.message : String(e)}`, { source: "sdk", cause: e });
        }
        if (l.baseMint !== mint)
            throw new FloorError("BadAccount", `launch ${address} holds mint ${l.baseMint}, not ${mint}`, { source: "sdk" });
        const m = await get(mint);
        if (m !== null && m.data.length >= MINT_SUPPLY_AT + 8) {
            const live = readUintLE(m.data, MINT_SUPPLY_AT, 8);
            if (live < l.supply)
                l = { ...l, supply: live };
        }
        return { address, l };
    }
    async function tradeAccounts(address: string, l: LaunchV2Account, trader: string, baseOwner: string, quoteOwner: string): Promise<TradeAccountsV2 & {
        programId: string;
        hookProgramId: string;
    }> {
        const ref = traderRefPda(trader, l.quoteMint, pid)[0];
        const hasRef = (await get(ref)) !== null;
        return {
            programId: pid,
            hookProgramId: hid,
            trader,
            launch: address,
            baseMint: l.baseMint,
            quoteMint: l.quoteMint,
            tokenVault: l.tokenVault,
            quoteVault: l.quoteVault,
            traderBase: associatedTokenAddress(baseOwner, l.baseMint, TOKEN_2022_PROGRAM_ID),
            traderQuote: associatedTokenAddress(quoteOwner, l.quoteMint, l.quoteTokenProgram),
            quoteTokenProgram: l.quoteTokenProgram,
            traderRef: hasRef ? ref : null,
            escrow: hasRef ? traderRefEscrow(ref, l.quoteMint, l.quoteTokenProgram) : null,
            baseOwner,
            quoteOwner,
        };
    }
    async function wsolLegs(l: LaunchV2Account, owner: string, payer: string): Promise<{
        account: string;
        open: Instruction;
        close: Instruction | null;
    } | null> {
        if (l.quoteMint !== WSOL_MINT)
            return null;
        const account = associatedTokenAddress(owner, WSOL_MINT, l.quoteTokenProgram);
        const existed = (await get(account)) !== null;
        return {
            account,
            open: createAssociatedTokenAccountIdempotentInstruction({ payer, owner, mint: WSOL_MINT, tokenProgram: l.quoteTokenProgram }),
            close: existed || owner !== payer ? null : closeAccountInstruction({ account, destination: owner, owner, tokenProgram: l.quoteTokenProgram }),
        };
    }
    async function quoteFeeOf(l: LaunchV2Account): Promise<{
        fee: QuoteTransferFeeV2;
        epoch: bigint;
    } | null> {
        if (l.quoteTokenProgram !== TOKEN_2022_PROGRAM_ID)
            return null;
        const m = await get(l.quoteMint);
        const fee = m === null ? null : decodeQuoteTransferFeeV2(m.data);
        if (fee === null || (fee.older.basisPoints === 0 && fee.newer.basisPoints === 0))
            return null;
        if (transport.rpc.getEpoch) {
            try {
                return { fee, epoch: await transport.rpc.getEpoch() };
            }
            catch (e) {
                throw new FloorError("Transport", `getEpoch: ${e instanceof Error ? e.message : String(e)}`, { source: "sdk", cause: e });
            }
        }
        const newerHigher = fee.newer.basisPoints >= fee.older.basisPoints;
        return { fee, epoch: newerHigher || fee.newer.epoch === 0n ? fee.newer.epoch : fee.newer.epoch - 1n };
    }
    const client: FloorClient<"solana"> = {
        family: "solana",
        chain,
        quoteBuy: (p: QuoteBuyParams<"solana">): Promise<Quote> => guard(async () => {
            const slippageBps = slippageOf(p.slippageBps);
            const { l } = await launchOf(p.launch);
            const tf = await quoteFeeOf(l);
            const r = quoteBuySolanaV2(l, p.amountIn, { quoteTransferFee: tf });
            const s = solanaSettleInputsV2(l);
            const less = buyLessIn(p.amountIn, slippageBps);
            const lessFee = tf ? quoteTransferFeeV2(tf.fee, tf.epoch, less) : 0n;
            let m = 0n;
            if (less > lessFee) {
                try {
                    m = buyMinTokens(s.book, s.row, s.sup, less - lessFee, 0, SOL_BUY_WALK_STEPS);
                }
                catch (e) {
                    if (!fillsNothing(e))
                        throw e;
                }
            }
            const minOut = m > 0n ? m : 1n;
            const spot = nextBuyPriceX64(s.book);
            return {
                family: "solana",
                chainId: null,
                side: "buy",
                launch: p.launch,
                amountIn: p.amountIn,
                amountOut: r.buy.tokens,
                minOut,
                slippageBps,
                fees: feeLegs(r.buy.fees),
                priceImpactBps: impactBps(priceImpactV2(spot, r.buy.net, r.buy.tokens, "buy").ppm),
                refund: r.refundReceived,
                graduates: r.buy.graduatedNow,
            };
        }),
        quoteSell: (p: QuoteSellParams<"solana">): Promise<Quote> => guard(async () => {
            const slippageBps = slippageOf(p.slippageBps);
            if (p.tokensIn <= 0n)
                throw bad("tokensIn must be > 0");
            const { l } = await launchOf(p.launch);
            const s = solanaSettleInputsV2(l);
            const { quote, impact } = quoteSellImpactV2(s.book, p.tokensIn, sCirc(s.book, s.sup));
            const tf = await quoteFeeOf(l);
            const amountOut = tf ? quoteReceivedV2(tf.fee, tf.epoch, quote.out) : quote.out;
            return {
                family: "solana",
                chainId: null,
                side: "sell",
                launch: p.launch,
                amountIn: p.tokensIn,
                amountOut,
                minOut: lessSlippage(quote.out, slippageBps),
                slippageBps,
                fees: feeLegs(quote.fees),
                priceImpactBps: impactBps(impact.ppm),
                refund: quote.unfilled,
                graduates: false,
            };
        }),
        buildBuy: (p: BuildBuyParams<"solana">): Promise<SolanaTx> => guard(async () => {
            if (p.amountIn <= 0n)
                throw bad("amountIn must be > 0");
            const { address, l } = await launchOf(p.launch);
            const owner = p.recipient ?? p.trader;
            const a = await tradeAccounts(address, l, p.trader, owner, p.trader);
            const hasPosition = owner !== p.trader || (await get(holderPositionPda(address, owner, hid)[0])) !== null;
            const wsol = await wsolLegs(l, p.trader, p.trader);
            const instructions: Instruction[] = [
                computeUnitLimitInstruction(MAX_COMPUTE_UNIT_LIMIT),
                createAssociatedTokenAccountIdempotentInstruction({ payer: p.trader, owner, mint: l.baseMint, tokenProgram: TOKEN_2022_PROGRAM_ID }),
                ...(wsol ? [wsol.open, systemTransferInstruction({ from: p.trader, to: wsol.account, lamports: p.amountIn }), syncNativeInstruction(wsol.account)] : []),
                ...buyWithPositionInstructions({ ...a, amountIn: p.amountIn, minOut: p.minOut, hasPosition }),
                ...(wsol?.close ? [wsol.close] : []),
            ];
            return { family: "solana", instructions };
        }),
        buildSell: (p: BuildSellParams<"solana">): Promise<SolanaTx> => guard(async () => {
            if (p.tokensIn <= 0n)
                throw bad("tokensIn must be > 0");
            const { address, l } = await launchOf(p.launch);
            const to = p.recipient ?? p.trader;
            const a = await tradeAccounts(address, l, p.trader, p.trader, to);
            const wsol = await wsolLegs(l, to, p.trader);
            const instructions: Instruction[] = [
                computeUnitLimitInstruction(MAX_COMPUTE_UNIT_LIMIT),
                wsol ? wsol.open : createAssociatedTokenAccountIdempotentInstruction({ payer: p.trader, owner: to, mint: l.quoteMint, tokenProgram: l.quoteTokenProgram }),
                sellInstructionV2({ ...a, tokensIn: p.tokensIn, minOut: p.minOut }),
                ...(wsol?.close ? [wsol.close] : []),
            ];
            return { family: "solana", instructions };
        }),
        claim: (p: ClaimParams<"solana">): Promise<SolanaTx> => guard(async () => {
            const tok = (p.types & (CLAIM_TEAM_BUY | CLAIM_SHARE_BOUGHT)) !== 0;
            const launches: ClaimLaunchV2[] = [];
            let qtp: string | null = null;
            for (const mint of p.launches) {
                const { address, l } = await launchOf(mint);
                if (l.quoteMint !== p.quote)
                    throw bad(`launch ${mint} trades in ${l.quoteMint}, not ${p.quote}`);
                qtp = l.quoteTokenProgram;
                const slot = teamSlotPda(address, pid)[0];
                launches.push({
                    launch: address,
                    quoteVault: l.quoteVault,
                    teamSlot: (await get(slot)) !== null ? slot : null,
                    baseMint: l.baseMint,
                    ...(tok ? { teamBuy: { baseMint: l.baseMint, tokenVault: l.tokenVault, walletBase: associatedTokenAddress(p.wallet, l.baseMint, TOKEN_2022_PROGRAM_ID) } } : {}),
                });
            }
            if (qtp === null) {
                const m = await get(p.quote);
                if (m === null)
                    throw new FloorError("BadAccount", `no quote mint ${p.quote}`, { source: "sdk" });
                qtp = m.owner;
            }
            const ro = (p.types & CLAIM_TRADER_REF) !== 0 ? refOwedPda(p.wallet, p.quote, pid)[0] : null;
            const claim = claimInstructionV2({
                ...ids,
                sender: p.wallet,
                wallet: p.wallet,
                quoteMint: p.quote,
                quoteTokenProgram: qtp,
                destination: associatedTokenAddress(p.wallet, p.quote, qtp),
                config: configPda(pid)[0],
                refOwed: ro,
                refOwedVault: ro ? refOwedVault(ro, p.quote, qtp) : null,
                types: p.types,
                launches,
                unwrap: p.quote === WSOL_MINT && qtp === TOKEN_PROGRAM_ID,
            });
            return { family: "solana", instructions: [computeUnitLimitInstruction(CLAIM_COMPUTE_UNIT_LIMIT_V2), claim] };
        }),
        send: async (tx: SolanaTx): Promise<string[]> => {
            if (!transport.send)
                throw new FloorError("NoSend", "this client was given no transport.send", { source: "sdk" });
            try {
                return [await transport.send(tx)];
            }
            catch (e) {
                throw decodeSolanaProgramError(e, ids) ?? new FloorError("Transport", `send: ${e instanceof Error ? e.message : String(e)}`, { source: "sdk", cause: e });
            }
        },
        decodeError: (raw: unknown) => decodeSolanaProgramError(raw, ids),
    };
    return client;
}
