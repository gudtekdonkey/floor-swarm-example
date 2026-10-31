import { MULTICALL3_ADDRESS, aggregate3Call, decodeAggregate3Result } from "../evm/multicall.ts";
import { decodeCirculatingOf, decodeLaunchBook, decodeLaunchFeeCurve, decodeLaunchStateSupply, decodeBidMoney, evmSettleInputsV2, viewCall } from "./evm.ts";
import type { EvmCall, FeeCurveViewV2, LaunchBookV2 } from "./evm.ts";
import type { Book } from "../math/v2/book.ts";
import type { SplitRow } from "../math/v2/split.ts";
import type { Supply } from "../math/v2/supply.ts";
import { launchDisplayV2 } from "../math/v2/display.ts";
import type { LaunchDisplayV2 } from "../math/v2/display.ts";
export const EVM_TOKEN_SCALE = 1000000000000n;
export type EthCall = (call: EvmCall) => Promise<string>;
export const LAUNCH_READS_V2 = ["book", "state", "feeCurve", "circulating", "bidMoney"] as const;
export type LaunchReadKeyV2 = (typeof LAUNCH_READS_V2)[number];
const REQUIRED: ReadonlySet<LaunchReadKeyV2> = new Set(["book", "state", "feeCurve"]);
export function launchReadCallsV2(floorAmm: string, launchId: bigint): Record<LaunchReadKeyV2, EvmCall> {
    const v = (data: string): EvmCall => ({ to: floorAmm, data, value: 0n });
    return {
        book: v(viewCall("launchBook", [launchId])),
        state: v(viewCall("launchState", [launchId])),
        feeCurve: v(viewCall("launchFeeCurve", [launchId])),
        circulating: v(viewCall("circulatingOf", [launchId])),
        bidMoney: v(viewCall("bidMoney", [launchId])),
    };
}
export function launchMulticallV2(floorAmm: string, launchId: bigint, multicall: string = MULTICALL3_ADDRESS): EvmCall {
    const c = launchReadCallsV2(floorAmm, launchId);
    return aggregate3Call(LAUNCH_READS_V2.map((k) => ({ target: c[k].to, allowFailure: !REQUIRED.has(k), callData: c[k].data })), multicall);
}
export interface EvmLaunchV2 {
    book: LaunchBookV2;
    supply: bigint;
    curve: FeeCurveViewV2;
    circulating: {
        sCirc: bigint;
        sBelow: bigint;
        dead: bigint;
    } | null;
    bidMoney: bigint | null;
    math: {
        book: Book;
        row: SplitRow;
        sup: Supply;
    } | null;
    display: LaunchDisplayV2;
}
export function decodeLaunchReadsV2(r: Record<LaunchReadKeyV2, string | null>, opts: {
    row?: SplitRow;
    msCapPpm?: readonly number[];
} = {}): EvmLaunchV2 {
    if (r.book === null || r.state === null || r.feeCurve === null)
        throw new RangeError("launchBook / launchState / launchFeeCurve failed");
    const book = decodeLaunchBook(r.book);
    const supply = launchStateSupplyMath(decodeLaunchStateSupply(r.state).supply);
    const curve = decodeLaunchFeeCurve(r.feeCurve);
    const circulating = r.circulating === null ? null : decodeCirculatingOf(r.circulating);
    const math = opts.row !== undefined && circulating !== null ? evmSettleInputsV2(book, opts.row, { live: supply, dead: circulating.dead }, opts.msCapPpm, curve) : null;
    const displayBook = math?.book ?? evmSettleInputsV2(book, NO_ROW, { live: supply, dead: 0n }, opts.msCapPpm, curve).book;
    return {
        book,
        supply,
        curve,
        circulating,
        bidMoney: r.bidMoney === null ? null : decodeBidMoney(r.bidMoney),
        math,
        display: launchDisplayV2(displayBook, supply),
    };
}
export function launchStateSupplyMath(chain: bigint): bigint {
    if (chain % EVM_TOKEN_SCALE !== 0n)
        throw new RangeError(`launchState.supply ${chain} is not a whole math unit (CHAIN = math × ${EVM_TOKEN_SCALE})`);
    return chain / EVM_TOKEN_SCALE;
}
const NO_ROW: SplitRow = { phiBps: 0, ckBps: 0, wcBps: 0, cShareBps: 0, msClass: 0, platformMsBps: 0, floorMsBps: 0 };
export function decodeLaunchMulticallV2(data: string, opts: {
    row?: SplitRow;
    msCapPpm?: readonly number[];
} = {}): EvmLaunchV2 {
    const res = decodeAggregate3Result(data);
    if (res.length !== LAUNCH_READS_V2.length)
        throw new RangeError(`aggregate3: ${res.length} results, ${LAUNCH_READS_V2.length} calls`);
    const r = Object.fromEntries(LAUNCH_READS_V2.map((k, i) => [k, res[i].success ? res[i].returnData : null])) as Record<LaunchReadKeyV2, string | null>;
    return decodeLaunchReadsV2(r, opts);
}
export async function readLaunchV2(ethCall: EthCall, floorAmm: string, launchId: bigint, opts: {
    multicall?: string | null;
    row?: SplitRow;
    msCapPpm?: readonly number[];
} = {}): Promise<EvmLaunchV2> {
    if (opts.multicall !== null)
        return decodeLaunchMulticallV2(await ethCall(launchMulticallV2(floorAmm, launchId, opts.multicall ?? MULTICALL3_ADDRESS)), opts);
    const c = launchReadCallsV2(floorAmm, launchId);
    const got = await Promise.all(LAUNCH_READS_V2.map(async (k) => {
        try {
            return await ethCall(c[k]);
        }
        catch (e) {
            if (REQUIRED.has(k))
                throw e;
            return null;
        }
    }));
    return decodeLaunchReadsV2(Object.fromEntries(LAUNCH_READS_V2.map((k, i) => [k, got[i]])) as Record<LaunchReadKeyV2, string | null>, opts);
}
