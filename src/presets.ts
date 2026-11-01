// Saved presets: a name for a set of command flags (count, pick, split, timing, slippage, group, and for a buy the amount).
// `--use <name>` merges a preset's flags under the command's own: whatever the command line names wins.
import type { Store } from "./store/db.ts";

/** The flags a preset may hold, and whether each takes a value. Anything else is refused. */
export const PRESET_FLAGS: Record<string, "value" | "bool"> = {
  count: "value",
  pick: "value",
  split: "value",
  instant: "bool",
  random: "value",
  retries: "value",
  slippage: "value",
  seed: "value",
  group: "value",
  ids: "value",
  chain: "value",
  token: "value",
  from: "value",
  quote: "value",
  "team-buy": "value",
  times: "value",
};

/** Flags that set the same knob: naming one on the command line drops the preset's others. */
const EXCLUSIVE: string[][] = [["instant", "random"], ["group", "ids"]];

export interface Preset {
  name: string;
  /** Flag tokens as typed: ["--count", "most:40", "--instant"]. */
  flags: string[];
  /** A buy's amount (quote units, as typed), used when the command line gives none. */
  amount?: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const KEY = "preset:";

/** `--name` or `--name=value` → "name"; anything else → null. */
const flagName = (t: string): string | null => {
  const m = /^--([A-Za-z][A-Za-z0-9-]*)(=|$)/.exec(t);
  return m ? m[1]! : null;
};

/** Flags as [name, tokens] groups. A token that is not a flag belongs to the flag before it. */
function groups(tokens: string[]): { name: string; tokens: string[] }[] {
  const out: { name: string; tokens: string[] }[] = [];
  for (const t of tokens) {
    const n = flagName(t);
    if (n) out.push({ name: n, tokens: [t] });
    else if (out.length) out.at(-1)!.tokens.push(t);
    else throw new Error(`"${t}" is not a flag`);
  }
  return out;
}

/** Checks a preset's flag tokens and splits out `--amount`. Throws on anything a preset may not hold. */
export function parsePresetFlags(tokens: string[]): { flags: string[]; amount?: string } {
  const flags: string[] = [];
  let amount: string | undefined;
  for (const g of groups(tokens)) {
    if (g.name === "amount") {
      const v = g.tokens[0]!.includes("=") ? g.tokens[0]!.split("=").slice(1).join("=") : g.tokens[1];
      if (!v || !/^\d+(\.\d+)?$/.test(v)) throw new Error("--amount takes a number");
      amount = v;
      continue;
    }
    const kind = PRESET_FLAGS[g.name];
    if (!kind) throw new Error(`--${g.name} cannot be saved in a preset (allowed: ${Object.keys(PRESET_FLAGS).join(", ")}, amount)`);
    const eq = g.tokens[0]!.includes("=");
    const nValues = g.tokens.length - 1 + (eq ? 1 : 0);
    if (kind === "bool" && nValues !== 0) throw new Error(`--${g.name} takes no value`);
    if (kind === "value" && nValues !== 1) throw new Error(`--${g.name} takes one value`);
    flags.push(...g.tokens);
  }
  return { flags, ...(amount ? { amount } : {}) };
}

/** The preset's flags under the command's own `argv`: a flag the command names (or a sibling of it) replaces the preset's. */
export function mergeFlags(presetFlags: string[], argv: string[]): string[] {
  const own = new Set(argv.map(flagName).filter((x): x is string => x !== null));
  const dropped = new Set(own);
  for (const set of EXCLUSIVE) if (set.some((f) => own.has(f))) set.forEach((f) => dropped.add(f));
  const kept = groups(presetFlags).filter((g) => !dropped.has(g.name)).flatMap((g) => g.tokens);
  return [...kept, ...argv];
}

export function savePreset(store: Store, name: string, tokens: string[]): Preset {
  if (!NAME.test(name)) throw new Error(`bad preset name "${name}" (letters, digits, - and _, up to 32)`);
  const { flags, amount } = parsePresetFlags(tokens);
  if (flags.length === 0 && !amount) throw new Error("a preset needs at least one flag");
  const p: Preset = { name, flags, ...(amount ? { amount } : {}) };
  store.setSetting(KEY + name, { flags, ...(amount ? { amount } : {}) });
  return p;
}

export function getPreset(store: Store, name: string): Preset | undefined {
  const v = store.getSetting<{ flags: string[]; amount?: string }>(KEY + name);
  return v ? { name, flags: v.flags, ...(v.amount ? { amount: v.amount } : {}) } : undefined;
}

export function listPresets(store: Store): Preset[] {
  return Object.entries(store.settings())
    .filter(([k]) => k.startsWith(KEY))
    .map(([k, v]) => ({ name: k.slice(KEY.length), ...(v as { flags: string[]; amount?: string }) }));
}

export function removePreset(store: Store, name: string): boolean {
  const had = getPreset(store, name) !== undefined;
  store.db.prepare("delete from settings where key = ?").run(KEY + name);
  return had;
}

/** `--use name` (or `--use=name`) out of `argv`; the name, and the rest. */
export function takeUse(argv: string[]): { name: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let name: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--use") name = argv[++i];
    else if (a.startsWith("--use=")) name = a.slice(6);
    else rest.push(a);
  }
  return { name, rest };
}

/** The command line with its `--use` replaced by the preset's flags (and its amount, for a buy with no amount typed). */
export function applyPreset(store: Store, argv: string[]): string[] {
  const { name, rest } = takeUse(argv);
  if (!name) return argv;
  const p = getPreset(store, name);
  if (!p) throw new Error(`no preset "${name}" (swarm preset list)`);
  const merged = mergeFlags(p.flags, rest);
  // a buy typed as `buy <target>` takes the preset's amount in front of the target
  if (p.amount) {
    const pos = positionals(merged);
    if (pos.length === 2 && merged[pos[0]!] === "buy") merged.splice(pos[1]!, 0, p.amount);
  }
  return merged;
}

/** Indices of the tokens that are neither flags nor flag values (all our value flags take one value). */
function positionals(argv: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const n = flagName(a);
    if (n) {
      if (!a.includes("=") && PRESET_FLAGS[n] !== "bool" && !["dry-run", "json", "off", "help"].includes(n)) i++;
    } else out.push(i);
  }
  return out;
}

/** `swarm preset save|list|rm`. `rest` is what follows the subcommand. */
export function presetCommand(store: Store, sub: string | undefined, rest: string[], log: (s: string) => void): unknown {
  if (sub === "save") {
    const [name, ...tokens] = rest;
    if (!name) throw new Error("swarm preset save <name> -- <flags…>   e.g. -- --count most:40 --pick least_used --amount 10");
    const p = savePreset(store, name, tokens);
    log(`preset ${p.name}: ${[...p.flags, ...(p.amount ? ["amount " + p.amount] : [])].join(" ")}`);
    return p;
  }
  if (sub === "rm") {
    if (!rest[0]) throw new Error("swarm preset rm <name>");
    const had = removePreset(store, rest[0]);
    log(had ? `removed ${rest[0]}` : `no preset ${rest[0]}`);
    return { removed: had };
  }
  if (sub === "list" || sub === undefined) {
    const ps = listPresets(store);
    for (const p of ps) log(`${p.name}  ${p.flags.join(" ")}${p.amount ? `  amount ${p.amount}` : ""}`);
    if (ps.length === 0) log("no presets");
    return ps;
  }
  throw new Error(`unknown preset command "${sub}" (save, list, rm)`);
}
