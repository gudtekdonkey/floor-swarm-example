import { AbiError, bytesToHex, decodeAbi, encodeAbi, parseType } from "./abi.ts";
import type { AbiValue } from "./abi.ts";
import { keccak256 } from "./keccak.ts";
export interface AbiParam {
    readonly name: string;
    readonly type: string;
    readonly internalType?: string;
    readonly indexed?: boolean;
    readonly components?: readonly AbiParam[];
}
export interface AbiItem {
    readonly type: "function" | "event" | "error" | "constructor" | "receive" | "fallback";
    readonly name?: string;
    readonly inputs?: readonly AbiParam[];
    readonly outputs?: readonly AbiParam[];
    readonly stateMutability?: "pure" | "view" | "nonpayable" | "payable";
    readonly anonymous?: boolean;
}
export type Abi = readonly AbiItem[];
type Prim<T extends string> = T extends `uint${string}` | `int${string}` ? bigint : T extends "bool" ? boolean : string;
type Elem<T extends string> = T extends `${infer E}[${string}]` ? Elem<E> : T;
type Wrap<T extends string, V> = T extends `${infer E}[${string}]` ? Wrap<E, V>[] : V;
export type ParamValue<P> = P extends {
    readonly type: infer T extends string;
    readonly components: infer C extends readonly AbiParam[];
} ? Wrap<T, Struct<C>> : P extends {
    readonly type: infer T extends string;
} ? Wrap<T, Prim<Elem<T>>> : never;
export type Struct<C extends readonly AbiParam[]> = {
    -readonly [K in C[number] as K["name"]]: ParamValue<K>;
};
type ItemOf<A extends Abi, N extends string, K extends AbiItem["type"]> = Extract<A[number], {
    readonly type: K;
    readonly name: N;
}>;
export type FunctionName<A extends Abi> = Extract<A[number], {
    readonly type: "function";
}>["name"] & string;
export type EventName<A extends Abi> = Extract<A[number], {
    readonly type: "event";
}>["name"] & string;
export type ArgsOf<A extends Abi, N extends string> = ItemOf<A, N, "function"> extends {
    readonly inputs: infer I extends readonly AbiParam[];
} ? Struct<I> : never;
export type ResultOf<A extends Abi, N extends string> = ItemOf<A, N, "function"> extends {
    readonly outputs: infer O extends readonly AbiParam[];
} ? Struct<O> : never;
export type EventArgsOf<A extends Abi, N extends string> = ItemOf<A, N, "event"> extends {
    readonly inputs: infer I extends readonly AbiParam[];
} ? Struct<I> : never;
export function paramType(p: AbiParam): string {
    if (!p.type.startsWith("tuple"))
        return p.type;
    if (!p.components)
        throw new AbiError(`tuple ${p.name} has no components`);
    return `(${p.components.map(paramType).join(",")})${p.type.slice("tuple".length)}`;
}
export function itemSignature(item: AbiItem): string {
    if (!item.name)
        throw new AbiError(`a ${item.type} has no signature`);
    return `${item.name}(${(item.inputs ?? []).map(paramType).join(",")})`;
}
const hash = (s: string): Uint8Array => keccak256(new TextEncoder().encode(s));
const TOPICS = new WeakMap<AbiItem, string>();
export const itemTopic = (item: AbiItem): string => {
    let t = TOPICS.get(item);
    if (t === undefined)
        TOPICS.set(item, (t = bytesToHex(hash(itemSignature(item)))));
    return t;
};
export const itemSelector = (item: AbiItem): string => itemTopic(item).slice(0, 10);
function arrayLevels(t: string): {
    base: string;
    dims: (number | null)[];
} {
    const dims: (number | null)[] = [];
    let s = t;
    while (s.endsWith("]")) {
        const i = s.lastIndexOf("[");
        const n = s.slice(i + 1, -1);
        dims.unshift(n === "" ? null : Number(n));
        s = s.slice(0, i);
    }
    return { base: s, dims };
}
function toValue(p: AbiParam, v: unknown, depth = 0): AbiValue {
    const { base, dims } = arrayLevels(p.type);
    if (depth < dims.length) {
        if (!Array.isArray(v))
            throw new AbiError(`${p.name}: expected an array`);
        return v.map((x) => toValue(p, x, depth + 1));
    }
    if (base === "tuple") {
        const c = p.components ?? [];
        if (Array.isArray(v))
            return c.map((q, i) => toValue(q, v[i]));
        if (v === null || typeof v !== "object")
            throw new AbiError(`${p.name}: expected a struct`);
        const o = v as Record<string, unknown>;
        return c.map((q, i) => {
            const key = q.name !== "" ? q.name : String(i);
            if (!(key in o))
                throw new AbiError(`${p.name}: missing ${key}`);
            return toValue(q, o[key]);
        });
    }
    if (/^u?int/.test(base)) {
        if (typeof v === "number" && Number.isSafeInteger(v))
            return BigInt(v);
        if (typeof v !== "bigint")
            throw new AbiError(`${p.name}: expected a bigint`);
        return v;
    }
    return v as AbiValue;
}
function fromValue(p: AbiParam, v: AbiValue, depth = 0): unknown {
    const { base, dims } = arrayLevels(p.type);
    if (depth < dims.length)
        return (v as AbiValue[]).map((x) => fromValue(p, x, depth + 1));
    if (base === "tuple")
        return named(p.components ?? [], v as AbiValue[]);
    return v;
}
export function named(params: readonly AbiParam[], values: readonly AbiValue[]): Record<string, any> {
    const out: Record<string, any> = {};
    params.forEach((p, i) => {
        out[p.name !== "" ? p.name : String(i)] = fromValue(p, values[i]);
    });
    return out;
}
export function encodeParams(params: readonly AbiParam[], args: Record<string, unknown> | readonly unknown[]): Uint8Array {
    const vals = params.map((p, i) => {
        if (Array.isArray(args))
            return toValue(p, args[i]);
        const o = args as Record<string, unknown>;
        const key = p.name !== "" ? p.name : String(i);
        if (!(key in o))
            throw new AbiError(`missing argument ${key}`);
        return toValue(p, o[key]);
    });
    return encodeAbi(params.map(paramType), vals);
}
export function decodeParams(params: readonly AbiParam[], data: Uint8Array | string): Record<string, any> {
    return named(params, decodeAbi(params.map(paramType), data));
}
export function findItem(abi: Abi, kind: AbiItem["type"], key: string): AbiItem {
    const all = abi.filter((i) => i.type === kind);
    const bySig = all.filter((i) => key.includes("(") && itemSignature(i) === key.replace(/\s+/g, ""));
    if (bySig.length === 1)
        return bySig[0];
    const byName = all.filter((i) => i.name === key);
    if (byName.length === 1)
        return byName[0];
    throw new AbiError(byName.length > 1 ? `${kind} ${key} is overloaded: name it by signature` : `no ${kind} ${key}`);
}
const INDEX = new WeakMap<Abi, {
    len: number;
    by: Partial<Record<"function" | "event", Map<string, AbiItem>>>;
}>();
function lookup(abi: Abi, kind: "function" | "event", key: string): AbiItem | undefined {
    let ix = INDEX.get(abi);
    if (!ix || ix.len !== abi.length)
        INDEX.set(abi, (ix = { len: abi.length, by: {} }));
    let m = ix.by[kind];
    if (!m) {
        m = new Map();
        for (const i of abi) {
            if (i.type !== kind || (kind === "event" && i.anonymous))
                continue;
            const k = kind === "event" ? itemTopic(i) : itemSelector(i);
            if (!m.has(k))
                m.set(k, i);
        }
        ix.by[kind] = m;
    }
    return m.get(key);
}
export function encodeFunctionData(abi: Abi, name: string, args: Record<string, unknown> | readonly unknown[] = {}): string {
    const f = findItem(abi, "function", name);
    const body = encodeParams(f.inputs ?? [], args);
    return itemSelector(f) + bytesToHex(body).slice(2);
}
export function decodeFunctionData(abi: Abi, data: string | Uint8Array): {
    name: string;
    args: Record<string, any>;
} {
    const hex = typeof data === "string" ? data.toLowerCase() : bytesToHex(data);
    const f = lookup(abi, "function", hex.slice(0, 10));
    if (!f)
        throw new AbiError(`no function with selector ${hex.slice(0, 10)}`);
    return { name: f.name as string, args: decodeParams(f.inputs ?? [], "0x" + hex.slice(10)) };
}
export function decodeFunctionResult(abi: Abi, name: string, data: string | Uint8Array): Record<string, any> {
    return decodeParams(findItem(abi, "function", name).outputs ?? [], data);
}
export function encodeFunctionResult(abi: Abi, name: string, result: Record<string, unknown> | readonly unknown[]): string {
    return bytesToHex(encodeParams(findItem(abi, "function", name).outputs ?? [], result));
}
export interface Log {
    topics: readonly string[];
    data: string;
    address?: string;
}
const isDynamicType = (t: string): boolean => {
    const at = parseType(t);
    return at.kind === "bytes" || at.kind === "string" || at.kind === "array" || at.kind === "tuple";
};
export function decodeEventLog(abi: Abi, log: Log): {
    name: string;
    args: Record<string, any>;
} | null {
    const t0 = (log.topics[0] ?? "").toLowerCase();
    const ev = lookup(abi, "event", t0);
    if (!ev)
        return null;
    const inputs = ev.inputs ?? [];
    const indexed = inputs.filter((p) => p.indexed);
    if (log.topics.length !== indexed.length + 1)
        throw new AbiError(`${ev.name}: expected ${indexed.length + 1} topics, got ${log.topics.length}`);
    const plain = inputs.filter((p) => !p.indexed);
    const body = decodeAbi(plain.map(paramType), log.data);
    const out: Record<string, any> = {};
    let ti = 1;
    let di = 0;
    inputs.forEach((p, i) => {
        const key = p.name !== "" ? p.name : String(i);
        if (p.indexed) {
            const topic = log.topics[ti++];
            out[key] = isDynamicType(paramType(p)) ? topic.toLowerCase() : fromValue(p, decodeAbi([paramType(p)], topic)[0]);
        }
        else
            out[key] = fromValue(p, body[di++]);
    });
    return { name: ev.name as string, args: out };
}
export function encodeEventLog(abi: Abi, name: string, args: Record<string, unknown>): Log {
    const ev = findItem(abi, "event", name);
    const inputs = ev.inputs ?? [];
    const topics = [itemTopic(ev)];
    for (const p of inputs.filter((q) => q.indexed)) {
        const t = paramType(p);
        if (isDynamicType(t))
            throw new AbiError(`${name}.${p.name}: an indexed dynamic value is hashed; pass the hash`);
        topics.push(bytesToHex(encodeAbi([t], [toValue(p, args[p.name])])));
    }
    const plain = inputs.filter((p) => !p.indexed);
    return { topics, data: bytesToHex(encodeParams(plain, args)) };
}
const ERROR_STRING: AbiItem = { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] };
const PANIC: AbiItem = { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] };
export function decodeErrorResult(abi: Abi, data: string | Uint8Array): {
    name: string;
    args: Record<string, any>;
} | null {
    const hex = typeof data === "string" ? data.toLowerCase() : bytesToHex(data);
    if (hex.length < 10)
        return null;
    const sel = hex.slice(0, 10);
    const e = abi.find((i) => i.type === "error" && itemSelector(i) === sel) ?? [ERROR_STRING, PANIC].find((i) => itemSelector(i) === sel);
    if (!e)
        return null;
    return { name: e.name as string, args: decodeParams(e.inputs ?? [], "0x" + hex.slice(10)) };
}
export function encodeErrorResult(abi: Abi, name: string, args: Record<string, unknown> = {}): string {
    const e = findItem(abi, "error", name);
    return itemSelector(e) + bytesToHex(encodeParams(e.inputs ?? [], args)).slice(2);
}
export function abiOfArtifact(json: unknown): Abi {
    const a = Array.isArray(json) ? json : (json as {
        abi?: unknown;
    })?.abi;
    if (!Array.isArray(a))
        throw new AbiError("not an ABI or a forge artifact");
    return a as Abi;
}
export function signatures(abi: Abi): {
    functions: string[];
    events: string[];
    errors: string[];
} {
    const of = (k: AbiItem["type"]): string[] => abi.filter((i) => i.type === k).map(itemSignature).sort();
    return { functions: of("function"), events: of("event"), errors: of("error") };
}
