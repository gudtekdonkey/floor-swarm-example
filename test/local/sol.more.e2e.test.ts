// More end to end on the local Solana world (scripts/local-sol.sh, or scripts/fork-sol.sh's mainnet fork): the commands
// test/local/sol.e2e.test.ts does not reach — wallets with balances, team-slot add by --member and --handle and a real
// team-slot buy, swap between two launches on one quote, snipe, claim after the Team Buy unlocks (--to refused by name),
// runs. The claim moves the cluster clock a day on, which ages the registry prices past the SDK's 24 h: it runs last, and
// this file runs after sol.e2e.test.ts (the file order is sorted). Skips when the world is not up.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli.ts";
import { Swarm } from "../../src/swarm.ts";

type World = { rpc: string; programId: string; hookProgramId?: string; dUSDC: string; treasury: { address: string; key: number[] } };
const WORLD = process.env.SWARM_SOL_WORLD ?? join(import.meta.dirname, "../../data/local-sol.json");
const world = existsSync(WORLD) ? (JSON.parse(readFileSync(WORLD, "utf8")) as World) : null;
const w = world as World;

const up = async (): Promise<boolean> => {
  if (!world) return false;
  try {
    const r = await fetch(world.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [world.programId, { encoding: "base64" }] }) });
    return r.ok && ((await r.json()) as { result?: { value: unknown } }).result?.value != null;
  } catch {
    return false;
  }
};
const skip = !(await up()) && "the local Solana world is not up (scripts/local-sol.sh or scripts/fork-sol.sh)";

const sw = async (...args: string[]): Promise<string[]> => {
  const out: string[] = [];
  await main(args, (l: string) => out.push(l));
  return out;
};
const res = async (...args: string[]): Promise<any> => main(args, () => {});
const last = (xs: string[]): string => xs.at(-1) ?? "";
const rpc = async (method: string, params: unknown[]): Promise<any> => {
  const r = (await (await fetch(w.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as { result?: unknown; error?: { message: string } };
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
};
const PASS = "sol-more-e2e-pass";

before(() => {
  process.env.SWARM_HOME = mkdtempSync(join(tmpdir(), "swarm-sol-more-"));
  process.env.SWARM_PASSPHRASE = PASS;
  process.env.SWARM_NAME = "solmore";
});

let slotToken = "";

test("setup: init, chain add, fund, wallets with balances", { skip }, async () => {
  await sw("init", "--generate", "8", "--group", "swarm");
  await res("wallets", "import", JSON.stringify(w.treasury.key), "--group", "treasury"); // wallet 9
  assert.match(last(await sw("chain", "add", "sol", "--rpc", w.rpc, "--program-id", w.programId, ...(w.hookProgramId ? ["--hook-program-id", w.hookProgramId] : []))), /chain sol: /);
  assert.match(last(await sw("fund", "--each", "3", "--chain", "sol", "--from", "treasury", "--group", "swarm", "--instant")), /fund done: landed 24 SOL of 24/);
  assert.match(last(await sw("fund", "800", "--chain", "sol", "--token", w.dUSDC, "--from", "treasury", "--group", "swarm", "--split", "equal", "--instant")), /fund done: landed 800 /);
  const bal = (await res("wallets", "--chain", "sol", "--token", w.dUSDC, "--group", "swarm")) as { id: number; native: bigint; tokenBalance: bigint }[];
  assert.equal(bal.length, 8);
  for (const b of bal) {
    assert.ok(b.native >= 2_900_000_000n, `wallet ${b.id} holds ~3 SOL (${b.native})`);
    assert.equal(b.tokenBalance, 100_000_000n, `wallet ${b.id} holds 100 USDC`);
  }
  await sw("settings", "wallets", "1:16");
  await sw("settings", "per-wallet", "sol:native", "0.001:1");
});

test("team-slot: add by member and by handle, volume, then a real team-slot buy", { skip }, async () => {
  const made = (await res("launch", "Sol Slot", "SSL", "--chain", "sol", "--from", "9", "--quote", "native", "--team-buy", "max")) as { launches: { token: string; paid: bigint }[] };
  slotToken = made.launches[0]!.token;
  assert.ok(made.launches[0]!.paid > 0n, "the Team Buy was paid");
  const add = await sw("team-slot", "add", `sol:${slotToken}`, "--from", "9", "--member", "1,2", "--shares", "1");
  assert.equal(add.filter((l) => /✓/.test(l)).length, 2, add.join("\n"));
  const h = await sw("team-slot", "add", `sol:${slotToken}`, "--from", "9", "--handle", "x:sol_more_alice", "--shares", "1");
  assert.equal(h.filter((l) => /✓/.test(l)).length, 1, h.join("\n"));
  for (let i = 0; i < 3; i++) {
    assert.match(last(await sw("buy", "3", `sol:${slotToken}`, "--ids", "3-8", "--split", "equal", "--instant")), /buy done/);
    assert.match(last(await sw("sell", "90%", `sol:${slotToken}`, "--ids", "3-8", "--instant")), /sell done/);
  }
  const s = new Swarm("solmore");
  s.unlock(PASS);
  const c = await s.chain("sol");
  const l = await s.resolve(`sol:${slotToken}`);
  const [m1, m2] = s.store.wallets({ ids: [1, 2] });
  const [o1, o2] = [await c.teamShareOwed(m1, l), await c.teamShareOwed(m2, l)];
  assert.ok(o1 > 0n && o2 > 0n, `members are owed a Team Share (${o1}, ${o2})`);
  const sol = (x: bigint): string => { const t = x.toString().padStart(10, "0"); return `${t.slice(0, -9)}.${t.slice(-9)}`; };
  const out = await sw("team-slot", "buy", sol((o1 + o2) / 2n), `sol:${slotToken}`, "--ids", "1,2", "--instant");
  assert.match(last(out), /done/, out.join("\n"));
  const after = await Promise.all([m1, m2].map(async (m) => (await c.owedOf(m, [l])).launches[0]!.owed));
  assert.ok(after.some((o) => o.shareBought > 0n) || (await c.balanceOf(slotToken, m1.sol!)) + (await c.balanceOf(slotToken, m2.sol!)) > 0n, `the Team Share buy landed (${JSON.stringify(after, (_, v) => (typeof v === "bigint" ? String(v) : v))})`);
  await assert.rejects(sw("team-slot", "buy", "0.001", `sol:${slotToken}`, "--ids", "5", "--instant"), /owed a Team Share/);
});

test("swap: sell one USDC launch and buy another with the quote out", { skip }, async () => {
  const a = ((await res("launch", "Sol Swap A", "SWA", "--chain", "sol", "--from", "9", "--quote", w.dUSDC)) as { launches: { token: string }[] }).launches[0]!.token;
  const b = ((await res("launch", "Sol Swap B", "SWB", "--chain", "sol", "--from", "9", "--quote", w.dUSDC)) as { launches: { token: string }[] }).launches[0]!.token;
  assert.match(last(await sw("buy", "60", `sol:${a}`, "--ids", "3-5", "--split", "equal", "--instant")), /buy done: landed 60 /);
  const out = await sw("swap", "50%", `sol:${a}`, `sol:${b}`, "--ids", "3-5", "--instant");
  assert.match(last(out), /swap: 3 wallets swapped/, out.join("\n"));
  const s = new Swarm("solmore");
  const c = await s.chain("sol");
  for (const x of s.store.wallets({ ids: [3, 4, 5] })) {
    assert.ok((await c.balanceOf(b, x.sol!)) > 0n, `wallet ${x.id} bought B`);
    assert.ok((await c.balanceOf(a, x.sol!)) > 0n, `wallet ${x.id} kept half of A`);
  }
  await assert.rejects(sw("swap", "50%", `sol:${a}`, `sol:${slotToken}`, "--ids", "3", "--instant"), /one quote asset/);
});

test("snipe: catches a launch created a few seconds after it starts", { skip }, async () => {
  const snipe = sw("snipe", "0.2", "--chain", "sol", "--symbol", "SNS", "--ids", "6-8", "--within", "90", "--count", "exact:2", "--split", "equal", "--instant");
  await new Promise((r) => setTimeout(r, 3000));
  await res("launch", "Not This", "OTS", "--chain", "sol", "--from", "9", "--quote", "native");
  await new Promise((r) => setTimeout(r, 2000));
  const made = ((await res("launch", "Snipe Sol", "SNS", "--chain", "sol", "--from", "9", "--quote", "native")) as { launches: { token: string }[] }).launches[0]!.token;
  const out = await snipe;
  assert.ok(out.some((l) => l.includes("snipe: caught SNS")), out.join("\n"));
  assert.ok(out.some((l) => l.includes(made)), out.join("\n"));
  assert.match(last(out), /buy done: landed 0.2 SOL of 0.2/);
  const none = await sw("snipe", "0.1", "--chain", "sol", "--symbol", "NEVER", "--ids", "6-8", "--within", "3", "--instant");
  assert.ok(none.some((l) => /no launch matched symbol NEVER within 3 s/.test(l)), none.join("\n"));
});

test("runs: the ledger lists every command's run", { skip }, async () => {
  const runs = (await res("runs")) as { id: number; kind: string; status: string }[];
  const kinds = new Set(runs.map((r) => r.kind));
  for (const k of ["fund", "buy", "sell", "team-slot-buy", "swap"]) assert.ok([...kinds].some((x) => x.startsWith(k)), `a ${k} run (${[...kinds]})`);
  assert.ok(runs.every((r) => r.status !== "running"), "nothing left running");
});

test("claim: after the Team Buy unlocks, members and the creator claim once; --to is refused on Solana", { skip }, async () => {
  const s = new Swarm("solmore");
  s.unlock(PASS);
  const c = await s.chain("sol");
  const early = await sw("claim", `sol:${slotToken}`, "--ids", "1,2,9", "--dry-run");
  // move the clock past the Team Buy's day
  const clock = (await rpc("getAccountInfo", ["SysvarC1ock11111111111111111111111111111111", { encoding: "jsonParsed" }])).value.data.parsed.info;
  await rpc("surfnet_timeTravel", [{ absoluteTimestamp: (Number(clock.unixTimestamp) + 86400 + 120) * 1000 }]);
  const dry = await sw("claim", `sol:${slotToken}`, "--ids", "1,2,9", "--dry-run");
  assert.ok(dry.filter((l) => /is owed/.test(l)).length >= 2, `before:\n${early.join("\n")}\nafter:\n${dry.join("\n")}`);
  const [m1, m2] = s.store.wallets({ ids: [1, 2] });
  const t0 = (await c.balanceOf(slotToken, m1.sol!)) + (await c.balanceOf(slotToken, m2.sol!));
  // --to on Solana: refused by name for a wallet that is owed something, and nothing is sent
  let toOut: string[] = [];
  try {
    toOut = await sw("claim", `sol:${slotToken}`, "--ids", "1", "--to", w.treasury.address);
  } catch (e) {
    toOut = [(e as Error).message];
  }
  assert.ok(toOut.some((l) => /no payout address to name/.test(l)), toOut.join("\n"));
  assert.equal((await c.balanceOf(slotToken, m1.sol!)) + (await c.balanceOf(slotToken, m2.sol!)), t0, "the refused --to claim sent nothing");
  const done = await sw("claim", `sol:${slotToken}`, "--ids", "1,2,9");
  const claimed = done.filter((l) => /✓ wallet \d+/.test(l)).length;
  assert.ok(claimed >= 2, done.join("\n"));
  assert.ok(!done.some((l) => /✗/.test(l)), done.join("\n"));
  assert.ok((await c.balanceOf(slotToken, m1.sol!)) + (await c.balanceOf(slotToken, m2.sol!)) > t0, "members received tokens");
  const again = await sw("claim", `sol:${slotToken}`, "--ids", "1,2,9", "--dry-run");
  assert.ok(again.some((l) => /0 claimed, 3 owed nothing/.test(l)) || !again.some((l) => /is owed: .*(teamBuy|shareBought)/.test(l)), again.join("\n"));
});
