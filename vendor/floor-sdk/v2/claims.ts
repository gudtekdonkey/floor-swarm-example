import { addressBytes, base58Encode } from "../codec.ts";
import { computeUnitLimitInstruction, computeUnitPriceInstruction } from "../solana/instruction.ts";
import type { Instruction } from "../solana/instruction.ts";
import { PACKET_DATA_SIZE, compileV0Message, transactionSize } from "../solana/tx.ts";
import type { LookupTable } from "../solana/tx.ts";
import { decodeTeamSlot } from "../solana/floor/accounts.ts";
import { CLAIM_CREATOR, CLAIM_CREATOR_REF, CLAIM_SHARE_BOUGHT, CLAIM_TEAM_BUY, CLAIM_TEAM_SLOT, CLAIM_TRADER_REF } from "../solana/floor/instructions.ts";
import { FLOOR_AMM_PROGRAM_ID, configPda, refOwedPda, refOwedVault } from "../solana/floor/program.ts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WSOL_MINT, associatedTokenAddress } from "../solana/pda.ts";
import { CREATOR_BUY_LOCK_SECS, MAX_MEMBERS, splitTeamBuyV2 } from "../math/v2/team.ts";
import { holderSync, holderTake } from "../math/v2/holders.ts";
import { FloorMathError } from "../math/index.ts";
import { decodeHolderBook, decodeHolderPosition, decodeLaunchV2 } from "./layouts.ts";
import { CLAIM_HOLDER, claimInstructionV2 } from "./solana.ts";
import type { ClaimLaunchV2, Ctx } from "./solana.ts";
export const MAX_TX_ACCOUNT_LOCKS_V2 = 64;
export const CLAIM_COMPUTE_UNIT_LIMIT_V2 = 1400000;
const MEMBER_IN = 2;
const KIND_WALLET = 0;
export function teamBuyDueV2(createdAt: bigint, now: bigint): boolean {
    const c = createdAt < 0n ? 0n : createdAt;
    const due = c + CREATOR_BUY_LOCK_SECS > 0xffffffffffffffffn ? 0xffffffffffffffffn : c + CREATOR_BUY_LOCK_SECS;
    return now >= due;
}
export function holderOwedNowV2(p: {
    positionData: Uint8Array | null;
    bookData: Uint8Array;
    balance: bigint;
}): bigint {
    if (!p.positionData)
        return 0n;
    const pos = decodeHolderPosition(p.positionData) as any;
    const book = decodeHolderBook(p.bookData) as any;
    if (pos.launch !== book.launch)
        throw new RangeError("this HolderPosition is not the book's launch");
    const b = { index: book.index as bigint, w: book.w as bigint, carry: book.carry as bigint, bookedTotal: book.bookedTotal as bigint, paidTotal: book.paidTotal as bigint };
    const q = { amount: pos.amount as bigint, owed: pos.owed as bigint, indexSnap: pos.indexSnap as bigint, optedOut: false };
    holderSync(b, q, p.balance);
    return holderTake(b, q);
}
export interface OwedV2 {
    creator: bigint;
    creatorRef: bigint;
    teamSlot: bigint;
    teamBuy: bigint;
    shareBought: bigint;
    holder: bigint;
}
export interface LaunchOwedV2 {
    launch: string;
    quoteMint: string;
    quoteTokenProgram: string;
    quoteVault: string;
    baseMint: string;
    tokenVault: string;
    teamSlot: string | null;
    owed: OwedV2;
}
export const claimBitsV2 = (o: OwedV2): number => (o.creator > 0n ? CLAIM_CREATOR : 0) | (o.creatorRef > 0n ? CLAIM_CREATOR_REF : 0) | (o.teamSlot > 0n ? CLAIM_TEAM_SLOT : 0) |
    (o.teamBuy > 0n ? CLAIM_TEAM_BUY : 0) | (o.shareBought > 0n ? CLAIM_SHARE_BOUGHT : 0) | (o.holder > 0n ? CLAIM_HOLDER : 0);
const quoteOf = (o: OwedV2): bigint => o.creator + o.creatorRef + o.teamSlot + o.holder;
export function launchOwedV2(p: {
    wallet: string;
    launch: string;
    launchData: Uint8Array;
    teamSlot?: {
        address: string;
        data: Uint8Array;
    } | null;
    now: bigint;
    holderOwed?: bigint;
}): LaunchOwedV2 {
    const a = decodeLaunchV2(p.launchData);
    const owed: OwedV2 = { creator: 0n, creatorRef: 0n, teamSlot: 0n, teamBuy: 0n, shareBought: 0n, holder: p.holderOwed ?? 0n };
    const places: boolean[] = Array(MAX_MEMBERS).fill(false);
    if (a.creator === p.wallet) {
        owed.creator = a.creatorOwed;
        places[0] = true;
    }
    (a.creatorRef as string[]).forEach((r, i) => {
        if (r === p.wallet)
            owed.creatorRef += a.creatorRefOwed[i];
    });
    if (p.teamSlot) {
        const t = decodeTeamSlot(p.teamSlot.data);
        if (t.launch !== p.launch)
            throw new RangeError("this TeamSlot is not the launch's");
        const k = addressBytes(p.wallet);
        const i = (t.members as any[]).findIndex((m) => m.state === MEMBER_IN && m.kind === KIND_WALLET && (m.key as Uint8Array).every((x, j) => x === k[j]));
        if (i >= 0) {
            owed.teamSlot = a.slotOwed[i];
            places[i] = true;
        }
    }
    const createdAt = a.createdAt < 0n ? 0n : (a.createdAt as bigint);
    let buy: bigint[] = a.teamBuyOwed.slice();
    const due = teamBuyDueV2(a.createdAt, p.now);
    if (a.creatorLocked > 0n) {
        try {
            const split = splitTeamBuyV2(a.creatorLocked, a.slotWeightPpb, createdAt, p.now);
            buy = buy.map((x, i) => x + split[i]);
        }
        catch (e) {
            if (!(e instanceof FloorMathError && e.code === "NotDue"))
                throw e;
        }
    }
    for (let i = 0; i < MAX_MEMBERS; i++) {
        if (!places[i])
            continue;
        if (due)
            owed.teamBuy += buy[i];
        owed.shareBought += a.slotBoughtOwed[i];
    }
    return {
        launch: p.launch,
        quoteMint: a.quoteMint,
        quoteTokenProgram: a.quoteTokenProgram,
        quoteVault: a.quoteVault,
        baseMint: a.baseMint,
        tokenVault: a.tokenVault,
        teamSlot: p.teamSlot?.address ?? null,
        owed,
    };
}
export interface ClaimTxV2 {
    quoteMint: string;
    instructions: Instruction[];
    message: Uint8Array;
    size: number;
    locks: number;
    launches: string[];
    refOwed: boolean;
    types: number;
    unwrap: boolean;
    amount: bigint;
    tokens: bigint;
}
export interface ClaimPlanV2 {
    transactions: ClaimTxV2[];
    skipped: string[];
}
function locksOf(payer: string, ixs: Instruction[]): number {
    const s = new Set<string>([payer]);
    for (const ix of ixs) {
        s.add(ix.programAddress);
        for (const a of ix.accounts)
            s.add(a.address);
    }
    return s.size;
}
export function planClaimAllV2(p: {
    wallet: string;
    sender?: string;
    launches: readonly LaunchOwedV2[];
    refOwed?: readonly {
        quoteMint: string;
        quoteTokenProgram?: string;
        owed: bigint;
    }[];
    recentBlockhash: string;
    lookupTables?: LookupTable[];
    microLamports?: bigint;
    computeUnitLimit?: number;
    unwrapSol?: boolean;
    launchQuotes?: readonly string[];
} & Ctx): ClaimPlanV2 {
    const sender = p.sender ?? p.wallet;
    const skipped: string[] = [];
    type Group = {
        tp: string;
        classes: Map<number, LaunchOwedV2[]>;
        refs: bigint;
    };
    const byQuote = new Map<string, Group>();
    const group = (q: string, tp: string): Group => {
        let g = byQuote.get(q);
        if (!g)
            byQuote.set(q, (g = { tp, classes: new Map(), refs: 0n }));
        return g;
    };
    const classOf = (o: OwedV2): number => (o.teamBuy > 0n || o.shareBought > 0n ? 1 : 0) | (o.holder > 0n ? 2 : 0);
    for (const l of p.launches) {
        if (claimBitsV2(l.owed) === 0) {
            skipped.push(l.launch);
            continue;
        }
        const g = group(l.quoteMint, l.quoteTokenProgram);
        const c = classOf(l.owed);
        if (!g.classes.has(c))
            g.classes.set(c, []);
        g.classes.get(c)!.push(l);
    }
    for (const r of p.refOwed ?? []) {
        if (r.owed === 0n) {
            skipped.push(`ref_owed:${r.quoteMint}`);
            continue;
        }
        const known = byQuote.get(r.quoteMint);
        if (!known && !r.quoteTokenProgram)
            throw new RangeError(`the RefOwed in ${r.quoteMint} needs its quote's token program`);
        group(r.quoteMint, known?.tp ?? r.quoteTokenProgram!).refs = r.owed;
    }
    const pid = p.programId ?? FLOOR_AMM_PROGRAM_ID;
    const budget = (): Instruction[] => [computeUnitLimitInstruction(p.computeUnitLimit ?? CLAIM_COMPUTE_UNIT_LIMIT_V2), ...(p.microLamports !== undefined ? [computeUnitPriceInstruction(p.microLamports)] : [])];
    const fits = (t: ClaimTxV2): boolean => t.size <= PACKET_DATA_SIZE && t.locks <= MAX_TX_ACCOUNT_LOCKS_V2;
    const txs: ClaimTxV2[] = [];
    for (const [quoteMint, g] of byQuote) {
        const unwrap = (p.unwrapSol ?? true) && quoteMint === WSOL_MINT && g.tp === TOKEN_PROGRAM_ID;
        const build = (ls: LaunchOwedV2[], refs: bigint): ClaimTxV2 => {
            const types = ls.reduce((a, l) => a | claimBitsV2(l.owed), 0) | (refs > 0n ? CLAIM_TRADER_REF : 0);
            const tok = (types & (CLAIM_TEAM_BUY | CLAIM_SHARE_BOUGHT)) !== 0;
            const ro = refOwedPda(p.wallet, quoteMint, pid)[0];
            const claim = claimInstructionV2({
                sender,
                wallet: p.wallet,
                quoteMint,
                quoteTokenProgram: g.tp,
                destination: associatedTokenAddress(p.wallet, quoteMint, g.tp),
                config: configPda(pid)[0],
                refOwed: refs > 0n ? ro : null,
                refOwedVault: refs > 0n ? refOwedVault(ro, quoteMint, g.tp) : null,
                types,
                launches: ls.map((l): ClaimLaunchV2 => ({
                    launch: l.launch,
                    quoteVault: l.quoteVault,
                    teamSlot: l.teamSlot,
                    baseMint: l.baseMint,
                    ...(tok ? { teamBuy: { baseMint: l.baseMint, tokenVault: l.tokenVault, walletBase: associatedTokenAddress(p.wallet, l.baseMint, TOKEN_2022_PROGRAM_ID) } } : {}),
                })),
                unwrap,
                quoteIsLaunch: p.launchQuotes?.includes(quoteMint) ?? false,
                programId: p.programId,
                hookProgramId: p.hookProgramId,
            });
            const instructions = [...budget(), claim];
            const message = compileV0Message({ payer: sender, instructions, recentBlockhash: p.recentBlockhash, lookupTables: p.lookupTables });
            return {
                quoteMint,
                instructions,
                message,
                size: transactionSize(message),
                locks: locksOf(sender, instructions),
                launches: ls.map((l) => l.launch),
                refOwed: refs > 0n,
                types,
                unwrap,
                amount: ls.reduce((a, l) => a + quoteOf(l.owed), 0n) + refs,
                tokens: ls.reduce((a, l) => a + l.owed.teamBuy + l.owed.shareBought, 0n),
            };
        };
        const alone = (ls: LaunchOwedV2[], refs: bigint, what: string): ClaimTxV2 => {
            const t = build(ls, refs);
            if (!fits(t))
                throw new RangeError(`${what} alone does not fit one transaction`);
            return t;
        };
        let refs = g.refs;
        for (const c of [...g.classes.keys()].sort()) {
            let cur: LaunchOwedV2[] = [];
            let last: ClaimTxV2 | null = null;
            for (const l of g.classes.get(c)!) {
                const t = build([...cur, l], refs);
                if (fits(t)) {
                    cur.push(l);
                    last = t;
                    continue;
                }
                if (cur.length === 0 && refs > 0n) {
                    txs.push(alone([], refs, "the referral claim"));
                    refs = 0n;
                }
                else if (cur.length === 0)
                    throw new RangeError(`launch ${l.launch} alone does not fit one transaction`);
                else {
                    txs.push(last!);
                    refs = 0n;
                }
                cur = [l];
                last = alone(cur, 0n, `launch ${l.launch}`);
            }
            if (last) {
                txs.push(last);
                refs = 0n;
            }
        }
        if (refs > 0n)
            txs.push(alone([], refs, "the referral claim"));
    }
    return { transactions: txs, skipped };
}
export interface ClaimLaunchesPerTxV2 {
    plain: number;
    tokens: number;
    holder: number;
    both: number;
}
export function claimLaunchesPerTxV2(p: {
    quoteMint?: string;
    quoteTokenProgram?: string;
    lookupTables?: LookupTable[];
    microLamports?: bigint;
} & Ctx = {}): ClaimLaunchesPerTxV2 {
    const key = (i: number): string => {
        const b = new Uint8Array(32);
        b[0] = 241;
        b[1] = i & 255;
        b[2] = i >> 8;
        return base58Encode(b);
    };
    const quoteMint = p.quoteMint ?? key(65520);
    const quoteTokenProgram = p.quoteTokenProgram ?? TOKEN_PROGRAM_ID;
    const measure = (o: Partial<OwedV2>): number => {
        const launches = Array.from({ length: 64 }, (_, i): LaunchOwedV2 => ({
            launch: key(i),
            quoteMint,
            quoteTokenProgram,
            quoteVault: key(256 + i),
            baseMint: key(512 + i),
            tokenVault: key(768 + i),
            teamSlot: key(1024 + i),
            owed: { creator: 0n, creatorRef: 0n, teamSlot: 0n, teamBuy: 0n, shareBought: 0n, holder: 0n, ...o },
        }));
        const plan = planClaimAllV2({ wallet: key(65521), launches, recentBlockhash: key(65522), lookupTables: p.lookupTables, microLamports: p.microLamports, programId: p.programId, hookProgramId: p.hookProgramId });
        return plan.transactions[0].launches.length;
    };
    return { plain: measure({ creator: 1n, teamSlot: 1n }), tokens: measure({ creator: 1n, teamBuy: 1n }), holder: measure({ holder: 1n }), both: measure({ teamBuy: 1n, holder: 1n }) };
}
