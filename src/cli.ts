// The CLI. Step 1 talks to the store and the chains directly; the daemon (step 4) takes over the same
// commands behind its HTTP API.
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { parseUnits } from "viem";
import { Swarm, fmt, perWalletKey, WALLETS_KEY } from "./swarm.ts";
import { buy, fund, sell, type Knobs } from "./commands/trade.ts";
import { creators, launch } from "./commands/launch.ts";
import { swap } from "./commands/swap.ts";
import { parseWithin, snipe } from "./commands/snipe.ts";
import { claim } from "./commands/claim.ts";
import { parseMembers, parseShares, teamSlotAdd, teamSlotBuy } from "./commands/teamslot.ts";
import { PlanError, type Count, type Pick, type Split } from "./plan/plan.ts";
import type { Timing } from "./exec/run.ts";
import type { WalletRow } from "./store/db.ts";
import { applyPreset, presetCommand } from "./presets.ts";
import { Alerts, alertsCommand } from "./alerts.ts";
import { pipelineCommand } from "./pipeline/cli.ts";

const USAGE = `swarm — drives many wallets through the FLOOR Program (testnets and local chains only)

  swarm init [--generate N] [--mnemonic "…"]          a new vault (HD seed), N wallets derived
  swarm wallets [--group g] [--chain c [--token t]]  list (with balances on a chain)
  swarm wallets add N [--group g]                     derive N more HD wallets
  swarm wallets import <key> [--group g]              import a raw key: 0x… (EVM), or a Solana secret
                                                      (solana-keygen JSON array or base58)
  swarm wallets tag <ids> <group> [--off]             ids: 1,2,5-9
  swarm chain add <name> --rpc URL --floor-amm 0x… --chain-id N [--native ETH]
  swarm chain add <name> --rpc URL --program-id <floor_amm id> [--hook-program-id <floor_hook id>]   (Solana: Surfpool, devnet)
  swarm chain list
  swarm target <token | chain:token>                  resolve a pasted address (0x… or a Solana mint)
  swarm settings                                      the general settings
  swarm settings per-wallet <chain>:<native|asset> MIN:MAX   (MAX may be -)
  swarm settings wallets MIN:MAX
  swarm fund <total | --each X> --chain c [--token <asset>] --from <group> (--group g | --ids …) [knobs]
  swarm buy <total> <target> (--group g | --ids …) [knobs]
  swarm sell <tokens | P%> <target> (--group g | --ids …) [knobs]
  swarm launch <name> <SYMBOL> --chain c --from <id | group> [--preset 3] [--quote native|<asset>]
               [--team-buy <amount | max>] [--slippage BPS] [--times N] [--dry-run]
                                                      create launches; a group's wallets take turns
  swarm swap <tokens | P%> <fromTarget> <toTarget> (--group g | --ids …) [knobs]
                                                      each wallet sells its part of A, then buys B with what the sell returned
                                                      (one chain, one quote asset)
  swarm snipe <total> --chain c (--creator <addr> | --symbol SYM | --any) (--group g | --ids …) [--within SECS (600)] [knobs]
                                                      wait for the next launch created on c that matches, then buy <total> of it
  swarm claim [target | --all-launches] (--group g | --ids …) [--to <address>] [--dry-run]
                                                      claim what the wallets are owed (Team Fees, Team Slot, holder, referrals,
                                                      Team Buy); wallets owed nothing are skipped
  swarm team-slot add <target> --from <creator id> (--member <0xaddr | wallet id | ids> | --handle <platform>:<handle>) --shares N
                                                      the creator adds members to a launch's Team Slot
  swarm team-slot buy <amount> <target> (--group g | --ids …) [knobs]
                                                      members spend their owed Team Share on the token (claim brings the tokens)
  swarm runs [id]
  swarm preset save <name> -- <flags…> | list | rm <name>      saved flags; use one with --use <name>
  swarm pipeline save <name> <file.json> | run <name> | list | show <name> | rm <name>
  swarm alerts [webhook <url> | off | test]
  swarm daemon [--port 7717]                          the local HTTP API and web UI (127.0.0.1 only)

knobs:
  --count most[:N] | min | exact:N | random:A:B | pct:P
  --pick random | least_used | fresh | holders | richest | ordered
  --split weights:MIN:MAX | balance | equal
  --instant | --random MINMS:MAXMS     (default --random 500:3000)
  --retries N (3) · --slippage BPS (300) · --seed S · --dry-run
  --use NAME                                          merge a saved preset's flags under these

output:
  --json      one JSON object on stdout: {"ok":true,"command":…,"result":…,"log":[…]}
              or {"ok":false,"error":{"kind":"plan"|"usage"|"error","message":…}}
              exit 0 ok · 1 error · 2 can't plan · 3 usage
  swarm help --json                                   every command as data (for scripts)

env: SWARM_HOME (./data), SWARM_NAME (default), SWARM_PASSPHRASE (else a prompt)`;

async function passphrase(confirm = false): Promise<string> {
  if (process.env.SWARM_PASSPHRASE) return process.env.SWARM_PASSPHRASE;
  if (!process.stdin.isTTY) throw new UsageError("no terminal to ask for the passphrase on: set SWARM_PASSPHRASE");
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
      out._writeToOutput = (s: string) => {
        if (s.startsWith(q)) out.output.write(q);
      };
      rl.question(q, (a) => {
        rl.close();
        process.stdout.write("\n");
        resolve(a);
      });
    });
  const p = await ask("vault passphrase: ");
  if (confirm && (await ask("again: ")) !== p) throw new Error("the passphrases differ");
  return p;
}

export function parseIds(s: string): number[] {
  return s.split(",").flatMap((x) => {
    const m = /^(\d+)-(\d+)$/.exec(x.trim());
    if (m) return [...Array(Number(m[2]) - Number(m[1]) + 1).keys()].map((k) => Number(m[1]) + k);
    if (!/^\d+$/.test(x.trim())) throw new Error(`bad id "${x}"`);
    return [Number(x)];
  });
}

export function parseCount(s: string): Count {
  const [k, a, b] = s.split(":");
  switch (k) {
    case "most":
      return a ? { kind: "most", max: Number(a) } : { kind: "most" };
    case "min":
      return { kind: "min" };
    case "exact":
      return { kind: "exact", n: Number(a) };
    case "random":
      return { kind: "random", min: Number(a), max: Number(b) };
    case "pct":
      return { kind: "pct", pct: Number(a) };
  }
  throw new Error(`bad --count "${s}"`);
}

export function parseSplit(s: string): Split {
  const [k, a, b] = s.split(":");
  if (k === "weights") return { kind: "weights", min: Number(a ?? 0), max: Number(b ?? 1) };
  if (k === "balance" || k === "by_balance") return { kind: "by_balance" };
  if (k === "equal") return { kind: "equal" };
  throw new Error(`bad --split "${s}"`);
}

/** A bad command line (exit 3 under --json). */
export class UsageError extends Error {}

/** Every command as data: `swarm help --json`. Keep in step with USAGE. */
export const COMMANDS = [
  { cmd: "init", args: "[--generate N] [--mnemonic …] [--group g]", does: "create the vault (HD seed) and derive N wallets", unlocks: true },
  { cmd: "wallets", args: "[--group g] [--ids …] [--chain c [--token 0x…]]", does: "list wallets, with balances on a chain", unlocks: false },
  { cmd: "wallets add", args: "N [--group g]", does: "derive N more HD wallets", unlocks: true },
  { cmd: "wallets import", args: "<key> [--group g]", does: "import a raw key: 0x… is EVM; a solana-keygen JSON array or base58 secret is Solana", unlocks: true },
  { cmd: "wallets tag", args: "<ids> <group> [--off]", does: "add or remove a group tag", unlocks: false },
  { cmd: "chain add", args: "<name> --rpc URL (--floor-amm 0x… --chain-id N [--native SYM] | --program-id <id> [--hook-program-id <id>])", does: "add an EVM chain (loopback anvil or known testnet) or a Solana cluster (loopback node, devnet or testnet)", unlocks: false },
  { cmd: "chain list", args: "", does: "list chains", unlocks: false },
  { cmd: "target", args: "<token | chain:token>", does: "resolve a pasted address (0x… or a Solana mint) to a launch", unlocks: false },
  { cmd: "settings", args: "[per-wallet <chain>:<native|0xasset> MIN:MAX | wallets MIN:MAX]", does: "read or set the general settings", unlocks: false },
  { cmd: "fund", args: "<total | --each X> --chain c [--token 0x…] --from <group> (--group g | --ids …) [knobs]", does: "send quote from a treasury wallet to the selected wallets", unlocks: true },
  { cmd: "buy", args: "<total> <target> (--group g | --ids …) [knobs]", does: "spread a buy of <total> quote across wallets", unlocks: true },
  { cmd: "sell", args: "<tokens | P%> <target> (--group g | --ids …) [knobs]", does: "sell tokens (or P % of each holding) across wallets", unlocks: true },
  { cmd: "launch", args: "<name> <SYMBOL> --chain c --from <id | group> [--preset 3] [--quote native|0x…] [--team-buy <amount | max>] [--times N] [--dry-run]", does: "create launches from the wallet(s) --from names; the Team Buy is priced from the chain's row", unlocks: true },
  { cmd: "swap", args: "<tokens | P%> <fromTarget> <toTarget> (--group g | --ids …) [knobs]", does: "each picked wallet sells its part of launch A and buys launch B with what the sell returned (same chain and quote)", unlocks: true },
  { cmd: "snipe", args: "<total> --chain c (--creator <addr> | --symbol SYM | --any) (--group g | --ids …) [--within SECS] [knobs]", does: "wait for the next launch created on the chain that matches the filter, then buy <total> of it across wallets (instant by default)", unlocks: true },
  { cmd: "claim", args: "[target | --all-launches] (--group g | --ids …) [--to <address>] [--dry-run]", does: "claim what the wallets are owed on a launch (or every launch the swarm touched or made); wallets owed nothing are skipped", unlocks: true },
  { cmd: "team-slot add", args: "<target> --from <creator id> (--member <0xaddr | wallet id | ids> | --handle <platform>:<handle>) --shares N [--dry-run]", does: "the creator wallet adds members to a launch's Team Slot", unlocks: true },
  { cmd: "team-slot buy", args: "<amount> <target> (--group g | --ids …) [knobs]", does: "spend the wallets' owed Team Share on the launch's token (the tokens arrive with claim)", unlocks: true },
  { cmd: "runs", args: "[id]", does: "list runs, or one run's ledger", unlocks: false },
  { cmd: "preset save", args: "<name> -- <flags…> [--amount X]", does: "save count / pick / split / timing / slippage / group flags (and a buy's amount) under a name; use it with --use <name>", unlocks: false },
  { cmd: "preset list", args: "", does: "list saved presets", unlocks: false },
  { cmd: "preset rm", args: "<name>", does: "remove a preset", unlocks: false },
  { cmd: "pipeline save", args: "<name> <file.json>", does: "save a pipeline: ordered steps, each a swarm command with an optional gate", unlocks: false },
  { cmd: "pipeline run", args: "<name>", does: "run a saved pipeline step by step", unlocks: true },
  { cmd: "pipeline list", args: "", does: "list pipelines and their steps", unlocks: false },
  { cmd: "pipeline rm", args: "<name>", does: "remove a pipeline", unlocks: false },
  { cmd: "alerts", args: "[webhook <url> | off | test]", does: "show or set the alert webhook (a POST of JSON when a run ends or a pipeline step fails)", unlocks: false },
  { cmd: "daemon", args: "[--port 7717]", does: "serve the HTTP API and web UI on 127.0.0.1", unlocks: false },
] as const;

const PICKS: Pick[] = ["random", "least_used", "fresh", "holders", "richest", "ordered"];

const OPTIONS = {
  generate: { type: "string" },
  mnemonic: { type: "string" },
  group: { type: "string" },
  ids: { type: "string" },
  chain: { type: "string" },
  token: { type: "string" },
  from: { type: "string" },
  each: { type: "string" },
  rpc: { type: "string" },
  "floor-amm": { type: "string" },
  "chain-id": { type: "string" },
  "program-id": { type: "string" },
  "hook-program-id": { type: "string" },
  native: { type: "string" },
  off: { type: "boolean" },
  count: { type: "string" },
  pick: { type: "string" },
  split: { type: "string" },
  instant: { type: "boolean" },
  random: { type: "string" },
  retries: { type: "string" },
  slippage: { type: "string" },
  seed: { type: "string" },
  preset: { type: "string" },
  quote: { type: "string" },
  "slot-bps": { type: "string" },
  "team-buy": { type: "string" },
  within: { type: "string" },
  creator: { type: "string" },
  symbol: { type: "string" },
  any: { type: "boolean" },
  "all-launches": { type: "boolean" },
  to: { type: "string" },
  member: { type: "string" },
  handle: { type: "string" },
  shares: { type: "string" },
  times: { type: "string" },
  "dry-run": { type: "boolean" },
  use: { type: "string" },
  port: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

function knobs(v: Values): Knobs {
  if (v.pick && !PICKS.includes(v.pick as Pick)) throw new Error(`bad --pick "${v.pick}" (${PICKS.join(", ")})`);
  let timing: Timing = { kind: "random", minMs: 500, maxMs: 3000 };
  if (v.instant) timing = { kind: "instant" };
  else if (v.random) {
    const [a, b] = v.random.split(":").map(Number);
    timing = { kind: "random", minMs: a!, maxMs: b ?? a! };
  }
  return {
    count: v.count ? parseCount(v.count) : { kind: "most" },
    pick: v.pick as Pick | undefined,
    split: v.split ? parseSplit(v.split) : undefined,
    timing,
    retries: v.retries ? Number(v.retries) : 3,
    slippageBps: v.slippage ? Number(v.slippage) : 300,
    seed: v.seed,
    dryRun: v["dry-run"],
  };
}

function selected(s: Swarm, v: Values): WalletRow[] {
  if (!v.group && !v.ids) throw new Error("name the wallets: --group g or --ids 1,2,5-9");
  const ws = s.store.wallets({ group: v.group, ids: v.ids ? parseIds(v.ids) : undefined });
  if (ws.length === 0) throw new Error("no wallet matches");
  return ws;
}

/** Runs one command. Human lines go to `log`; the return value is the command's result as data (what `--json` prints). */
/** `ctx.swarm`: an already-open (and possibly unlocked) swarm, as the daemon holds one; the CLI opens its own. */
export interface MainContext {
  swarm?: Swarm;
}

export async function main(argv: string[], log: (s: string) => void = console.log, ctx: MainContext = {}): Promise<unknown> {
  const parse = (args: string[]) => {
    try {
      return parseArgs({ args, options: OPTIONS, allowPositionals: true });
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
  };
  let parsed = parse(argv);
  if (parsed.values.use && parsed.positionals[0] !== "preset") {
    // `--use name`: the preset's flags go under the command's own
    const sw = (ctx = { ...ctx, swarm: ctx.swarm ?? new Swarm(process.env.SWARM_NAME ?? "default") }).swarm!;
    try {
      parsed = parse(applyPreset(sw.store, argv));
    } catch (e) {
      throw e instanceof UsageError ? e : new UsageError((e as Error).message);
    }
  }
  const { values: v, positionals: pos } = parsed;
  const [cmd, sub, ...rest] = pos;
  if (cmd === "help" || v.help || !cmd) {
    log(USAGE);
    return { usage: USAGE, commands: COMMANDS };
  }
  const s = ctx.swarm ?? new Swarm(process.env.SWARM_NAME ?? "default");
  const unlock = async (): Promise<void> => {
    if (s.unlocked) return;
    if (!s.hasVault()) throw new Error(`no vault yet at ${s.vaultPath} (swarm init)`);
    s.unlock(await passphrase());
  };

  switch (cmd) {
    case "init": {
      if (s.hasVault()) throw new Error(`a vault already exists at ${s.vaultPath}`);
      s.createVault(await passphrase(true), v.mnemonic);
      const n = v.generate ? Number(v.generate) : 0;
      const ws = s.derive(n, v.group ? [v.group] : []);
      log(`vault created at ${s.vaultPath}${n ? `; ${n} wallets derived (ids ${ws[0]!.id}–${ws.at(-1)!.id})` : ""}`);
      return { vault: s.vaultPath, wallets: ws.map(walletJson) };
    }
    case "wallets": {
      if (sub === "add") {
        await unlock();
        const ws = s.derive(Number(rest[0]), v.group ? [v.group] : []);
        log(`derived ${ws.length} wallets (ids ${ws[0]!.id}–${ws.at(-1)!.id})`);
        return { wallets: ws.map(walletJson) };
      }
      if (sub === "import") {
        await unlock();
        const w = s.importKey(rest[0]!, v.group ? [v.group] : []);
        log(`wallet ${w.id} ${w.evm ?? w.sol} [${w.groups.join(", ")}]`);
        return walletJson(w);
      }
      if (sub === "tag") {
        if (!rest[0] || !rest[1]) throw new UsageError("swarm wallets tag <ids> <group> [--off]");
        s.store.tag(parseIds(rest[0]), rest[1], !v.off);
        log(`${v.off ? "untagged" : "tagged"} ${rest[0]} ${v.off ? "from" : "as"} ${rest[1]}`);
        return { ids: parseIds(rest[0]), group: rest[1], on: !v.off };
      }
      const ws = s.store.wallets({ group: v.group, ids: v.ids ? parseIds(v.ids) : undefined });
      const src = (w: WalletRow): string => (w.ref.source === "hd" ? `hd/${w.ref.index}` : `key/${w.ref.keyId}`);
      if (!v.chain) {
        for (const w of ws) log(`${String(w.id).padStart(4)}  ${w.evm ?? "-".padEnd(42)}  ${w.sol ?? "-"}  ${src(w)}  [${w.groups.join(", ")}]`);
        return ws.map((w) => ({ ...walletJson(w), source: src(w) }));
      }
      const c = await s.chain(v.chain);
      const tok = v.token ? await c.quoteInfo(v.token) : null;
      const out = [];
      for (const w of ws) {
        const a = c.addressOf(w);
        if (!a) continue;
        const nat = await c.balanceOf(c.native, a);
        const tb = tok ? await c.balanceOf(tok.address, a) : null;
        const t = tok && tb !== null ? `  ${fmt(tb, tok.decimals, tok.symbol)}` : "";
        log(`${String(w.id).padStart(4)}  ${a}  ${fmt(nat, c.nativeDecimals, c.nativeSymbol)}${t}  [${w.groups.join(", ")}]`);
        out.push({ id: w.id, address: a, source: src(w), groups: w.groups, native: nat, ...(tok ? { token: tok.address, tokenBalance: tb } : {}) });
      }
      return out;
    }
    case "chain": {
      if (sub === "add") {
        const name = rest[0];
        if (!name || !v.rpc) throw new UsageError("swarm chain add <name> --rpc URL (--floor-amm 0x… --chain-id N | --program-id <id>)");
        if (v["program-id"]) s.addChain(name, { family: "solana", rpc: v.rpc, programId: v["program-id"], ...(v["hook-program-id"] ? { hookProgramId: v["hook-program-id"] } : {}) });
        else if (v["floor-amm"] && v["chain-id"]) s.addChain(name, { family: "evm", chainId: Number(v["chain-id"]), rpc: v.rpc, floorAmm: v["floor-amm"], native: v.native });
        else throw new UsageError("an EVM chain takes --floor-amm 0x… --chain-id N; a Solana cluster takes --program-id <id>");
        const why = await (await s.chain(name)).verify();
        const cfg = s.chains()[name]!;
        log(`chain ${name}: ${why}, ${cfg.family === "evm" ? `FloorAmm ${cfg.floorAmm}` : `floor_amm ${cfg.programId}`}`);
        return { chain: name, verified: why, ...cfg };
      }
      for (const [n, c] of Object.entries(s.chains())) log(c.family === "evm" ? `${n}  chain id ${c.chainId}  ${c.rpc}  FloorAmm ${c.floorAmm}` : `${n}  solana  ${c.rpc}  floor_amm ${c.programId}`);
      return s.chains();
    }
    case "target": {
      if (!sub) throw new UsageError("swarm target <0xtoken | chain:0xtoken>");
      const l = await s.resolve(sub);
      log(`${l.chain}:${l.token} · launch ${l.launchId} · quote ${l.quote.symbol} (${l.quote.address})`);
      return l;
    }
    case "settings": {
      if (sub === "per-wallet") {
        const [chain, asset] = rest[0]!.split(":") as [string, string];
        const [min, max] = rest[1]!.split(":") as [string, string];
        s.store.setSetting(perWalletKey(chain, asset), { min, max: max === "-" || max === undefined ? null : max });
      } else if (sub === "wallets") {
        const [min, max] = rest[0]!.split(":").map(Number);
        if (!(min! >= 1 && max! >= min!)) throw new Error("wallets MIN:MAX with 1 ≤ MIN ≤ MAX");
        s.store.setSetting(WALLETS_KEY, { min, max });
      }
      const all = s.store.settings();
      if (!(WALLETS_KEY in all)) all[WALLETS_KEY] = { min: 1, max: 1000, default: true };
      for (const [k, x] of Object.entries(all)) log(`${k} = ${JSON.stringify(x)}`);
      return all;
    }
    case "fund": {
      if (!v.chain || !v.from) throw new UsageError("swarm fund <total | --each X> --chain c [--token 0x…] --from <group> (--group g | --ids …)");
      await unlock();
      const treasury = s.store.wallets({ group: v.from })[0];
      if (!treasury) throw new Error(`no wallet in group ${v.from}`);
      const c = await s.chain(v.chain);
      const q = await c.quoteInfo(v.token ?? c.native);
      const amount = v.each ? { each: parseUnits(v.each, q.decimals) } : { total: parseUnits(sub!, q.decimals) };
      return fund(s, v.chain, q.address, treasury, selected(s, v), amount, knobs(v), log);
    }
    case "buy": {
      if (!sub || !rest[0]) throw new UsageError("swarm buy <total> <target> (--group g | --ids …) [knobs]");
      await unlock();
      const l = await s.resolve(rest[0]!);
      return buy(s, l, selected(s, v), parseUnits(sub, l.quote.decimals), knobs(v), log);
    }
    case "sell": {
      if (!sub || !rest[0]) throw new UsageError("swarm sell <tokens | P%> <target> (--group g | --ids …) [knobs]");
      await unlock();
      const l = await s.resolve(rest[0]!);
      const amount = sub.endsWith("%") ? { pct: Number(sub.slice(0, -1)) } : parseUnits(sub, l.tokenDecimals);
      return sell(s, l, selected(s, v), amount, knobs(v), log);
    }
    case "launch": {
      if (!sub || !rest[0] || !v.chain || !v.from) throw new UsageError("swarm launch <name> <SYMBOL> --chain c --from <id | group> [--preset 3] [--quote native|0x…]");
      if (v["slot-bps"] !== undefined) throw new UsageError("--slot-bps is gone: the Team Slot always opens at the preset row's max");
      await unlock();
      const quote = v.quote ?? "native";
      const made = await launch(s, creators(s, v.from), {
        chain: v.chain,
        preset: v.preset ? Number(v.preset) : 3,
        quote,
        name: sub,
        symbol: rest[0]!,
        teamBuy: v["team-buy"],
        times: v.times ? Number(v.times) : 1,
        slippageBps: v.slippage ? Number(v.slippage) : 300,
        dryRun: v["dry-run"],
      }, log);
      return { launches: made };
    }
    case "preset":
      return asUsage(() => presetCommand(s.store, sub, rest, log));
    case "alerts":
      return asUsage(() => alertsCommand(new Alerts(s.store), sub, rest, log));
    case "pipeline":
      return pipelineCommand(s, sub, rest, log, async (a, onLine) => (await runJson(a, { swarm: s }, onLine)).out);
    case "daemon": {
      const { startDaemon } = await import("./daemon/server.ts");
      const d = await startDaemon({ swarm: s, port: v.port ? Number(v.port) : undefined });
      log(`swarm daemon on 127.0.0.1:${d.port} (stop with ctrl-c)`);
      log(`open ${d.url}`);
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
      await d.close();
      return { stopped: true };
    }
    case "swap": {
      if (!sub || !rest[0] || !rest[1]) throw new UsageError("swarm swap <tokens | P%> <fromTarget> <toTarget> (--group g | --ids …) [knobs]");
      await unlock();
      const [from, to] = [await s.resolve(rest[0]!), await s.resolve(rest[1]!)];
      const amount = sub.endsWith("%") ? { pct: Number(sub.slice(0, -1)) } : parseUnits(sub, from.tokenDecimals);
      return swap(s, from, to, selected(s, v), amount, knobs(v), log);
    }
    case "snipe": {
      if (!sub || !v.chain) throw new UsageError("swarm snipe <total> --chain c (--creator <addr> | --symbol SYM | --any) (--group g | --ids …) [--within SECS]");
      await unlock();
      const k = knobs(v);
      if (!v.instant && !v.random) k.timing = { kind: "instant" };
      return snipe(s, { chain: v.chain, total: sub, filter: { creator: v.creator, symbol: v.symbol, any: v.any }, withinSecs: parseWithin(v.within) }, selected(s, v), k, log);
    }
    case "claim": {
      if (!sub === !v["all-launches"]) throw new UsageError("swarm claim [target | --all-launches] (--group g | --ids …) [--to <address>]");
      await unlock();
      const target = sub ? await s.resolve(sub) : undefined;
      return claim(s, { target, allLaunches: v["all-launches"], to: v.to, dryRun: v["dry-run"], seed: v.seed }, selected(s, v), log);
    }
    case "team-slot": {
      if (sub === "add") {
        if (!rest[0] || !v.from || !/^\d+$/.test(v.from)) throw new UsageError("swarm team-slot add <target> --from <creator wallet id> (--member <0xaddr | wallet id> | --handle <platform>:<handle>) --shares N");
        await unlock();
        const l = await s.resolve(rest[0]!);
        const c = await s.chain(l.chain);
        const creator = s.store.wallet(Number(v.from));
        if (!creator) throw new Error(`no wallet ${v.from}`);
        const specs = parseMembers({ member: v.member, handle: v.handle }, (id) => { const w = s.store.wallet(id); return w ? c.addressOf(w) : null; }, (x) => c.isAddress(x));
        return teamSlotAdd(s, l, creator, specs, parseShares(v.shares), !!v["dry-run"], log);
      }
      if (sub === "buy") {
        if (!rest[0] || !rest[1]) throw new UsageError("swarm team-slot buy <amount> <target> (--group g | --ids …) [knobs]");
        await unlock();
        const l = await s.resolve(rest[1]!);
        return teamSlotBuy(s, l, selected(s, v), parseUnits(rest[0]!, l.quote.decimals), knobs(v), log);
      }
      throw new UsageError("swarm team-slot add … | swarm team-slot buy …");
    }
    case "runs": {
      if (sub) {
        const r = s.store.run(Number(sub));
        log(JSON.stringify(r, jsonSafe, 2));
        return r;
      }
      const rs = s.store.runs();
      for (const r of rs) log(`${String(r.id).padStart(4)}  ${r.kind}  ${r.status}  ${r.target ?? ""}  seed ${r.seed}`);
      return rs;
    }
  }
  throw new UsageError(`unknown command "${cmd}" (swarm help)`);
}

/** A failure in a plain-argument command (preset, alerts, pipeline) is a usage error, exit 3. */
async function asUsage<T>(f: () => T | Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw e instanceof PlanError || e instanceof UsageError ? e : new UsageError((e as Error).message);
  }
}

/** A wallet as data: both addresses (null where its key has none). */
const walletJson = (w: WalletRow) => ({ id: w.id, address: w.evm ?? w.sol, evm: w.evm, sol: w.sol, groups: w.groups });

/** JSON.stringify's replacer: bigints as decimal strings. */
export const jsonSafe = (_k: string, x: unknown): unknown => (typeof x === "bigint" ? x.toString() : x);

/** Exit codes: 0 ok · 1 error · 2 can't plan · 3 usage. */
export const exitCode = (e: unknown): number => (e instanceof PlanError ? 2 : e instanceof UsageError ? 3 : 1);
const errorKind = (e: unknown): string => (e instanceof PlanError ? "plan" : e instanceof UsageError ? "usage" : "error");

/** The JSON envelope `--json` prints, for one command's outcome. */
export async function runJson(argv: string[], ctx: MainContext = {}, onLine?: (l: string) => void): Promise<{ out: string; code: number }> {
  const lines: string[] = [];
  const command = argv.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ");
  try {
    const result = await main(argv, (l) => (lines.push(l), onLine?.(l)), ctx);
    return { out: JSON.stringify({ ok: true, command, result: result ?? null, log: lines }, jsonSafe), code: 0 };
  } catch (e) {
    return { out: JSON.stringify({ ok: false, command, error: { kind: errorKind(e), message: (e as Error).message }, log: lines }, jsonSafe), code: exitCode(e) };
  }
}

export async function cli(argv: string[]): Promise<void> {
  if (argv.includes("--json")) {
    const { out, code } = await runJson(argv);
    process.stdout.write(out + "\n");
    process.exitCode = code;
    return;
  }
  try {
    await main(argv);
  } catch (e) {
    console.error(e instanceof PlanError ? `can't plan: ${e.message}` : `error: ${(e as Error).message}`);
    process.exitCode = exitCode(e);
  }
}
