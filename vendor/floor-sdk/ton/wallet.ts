import { base64Of, stateInitCell, toBoc } from "./cell.ts";
import type { TonTx } from "./types.ts";
export interface TonConnectMessage {
    address: string;
    amount: string;
    payload: string;
    stateInit?: string;
}
export interface TonConnectRequest {
    validUntil: number;
    messages: TonConnectMessage[];
}
const VALID_FOR_DEFAULT = 300;
const VALID_FOR_MAX = 600;
const MAX_MESSAGES_DEFAULT = 4;
export function tonConnectRequest(tx: TonTx, o: {
    nowS: number;
    validForS?: number;
    maxMessages?: number;
}): TonConnectRequest {
    const max = o.maxMessages ?? MAX_MESSAGES_DEFAULT;
    const n = tx.messages.length;
    if (n < 1 || n > max)
        throw new RangeError(`a request carries 1 to ${max} messages, got ${n}`);
    const validFor = o.validForS ?? VALID_FOR_DEFAULT;
    if (!Number.isInteger(validFor) || validFor < 1 || validFor > VALID_FOR_MAX)
        throw new RangeError("validForS must be 1 to 600");
    if (!Number.isInteger(o.nowS) || o.nowS < 0)
        throw new RangeError("nowS must be a non-negative integer (seconds)");
    const messages = tx.messages.map((m): TonConnectMessage => {
        const out: TonConnectMessage = {
            address: m.to.toString({ bounceable: m.bounce, urlSafe: true }),
            amount: m.value.toString(),
            payload: base64Of(toBoc(m.body)),
        };
        if (m.stateInit)
            out.stateInit = base64Of(toBoc(stateInitCell(m.stateInit.code, m.stateInit.data)));
        return out;
    });
    return { validUntil: o.nowS + validFor, messages };
}
