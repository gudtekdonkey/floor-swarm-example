// End to end on the local Solana world (scripts/local-sol.sh → data/local-sol.json, Surfpool): the swarm creates a launch on
// the devkit's dUSDC and one on SOL (wSOL, traded in SOL), funds its wallets, and buys and sells both, instant and timed,
// all through the CLI's own entry point. Skips when the world is not up.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli.ts";
import { Swarm } from "../../src/swarm.ts";

const WORLD = process.env.SWARM_SOL_WORLD ?? join(import.meta.dirname, "../../data/local-sol.json");
const world = existsSync(WORLD) ? (JSON.parse(readFileSync(WORLD, "utf8")) as { rpc: string; programId: string; hookProgramId?: string; dUSDC: string; treasury: { address: string; key: number[] } }) : null;

const up = async (): Promise<boolean> => {
  if (!world) return false;
  try {
    const r = await fetch(world.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [world.programId, { encoding: "base64" }] }) });
    return r.ok && ((await r.json()) as { result?: { value: unknown } }).result?.value != null;
  } catch {
    return false;
  }
};

const sw = async (...args: string[]): Promise<string[]> => {
  const out: string[] = [];
  await main(args, (l) => out.push(l));
  return out;
};
const last = (xs: string[]): string => xs.at(-1) ?? "";
const skip = !(await up()) && "the local Solana world is not up (scripts/local-sol.sh)";

before(() => {
  process.env.SWARM_HOME = mkdtempSync(join(tmpdir(), "swarm-sol-e2e-"));
  process.env.SWARM_PASSPHRASE = "local-sol-e2e-pass";
  process.env.SWARM_NAME = "sole2e";
});

const launches: { usdc?: string; sol?: string } = {};

test("launch on dUSDC and on SOL from the treasury", { skip }, async () => {
  const w = world!;
  await sw("init", "--generate", "24", "--group", "swarm");
  const imp = (await main(["wallets", "import", JSON.stringify(w.treasury.key), "--group", "treasury"], () => {})) as { id: number; sol: string | null };
  assert.equal(imp.sol, w.treasury.address);
  await sw("chain", "add", "sol", "--rpc", w.rpc, "--program-id", w.programId, ...(w.hookProgramId ? ["--hook-program-id", w.hookProgramId] : []));

  const u = (await main(["launch", "Swarm Sol USDC", "SSU", "--chain", "sol", "--from", "treasury", "--quote", w.dUSDC], () => {})) as { launches: { token: string; tx: string; launchId: bigint }[] };
  assert.equal(u.launches.length, 1);
  launches.usdc = u.launches[0]!.token;
  const s = (await main(["launch", "Swarm Sol Native", "SSN", "--chain", "sol", "--from", "treasury", "--quote", "native"], () => {})) as { launches: { token: string }[] };
  launches.sol = s.launches[0]!.token;
  assert.notEqual(launches.usdc, launches.sol);
  assert.match(last(await sw("target", launches.sol)), /launch \d+ · quote SOL/);
  assert.match(last(await sw("target", `sol:${launches.usdc}`)), /launch \d+ · quote /);
});

test("fund → buy → sell on both launches", { skip }, async () => {
  const w = world!;
  assert.match(last(await sw("fund", "--each", "2", "--chain", "sol", "--from", "treasury", "--group", "swarm", "--instant")), /fund done: landed 48 SOL of 48/);
  assert.match(last(await sw("fund", "960", "--chain", "sol", "--token", w.dUSDC, "--from", "treasury", "--group", "swarm", "--split", "equal", "--instant")), /fund done: landed 960 /);

  await sw("settings", "per-wallet", "sol:native", "0.01:0.5");
  await sw("settings", "wallets", "2:24");
  assert.match(last(await sw("buy", "2", `sol:${launches.sol}`, "--group", "swarm", "--count", "most:6", "--pick", "least_used", "--split", "weights:0.2:1", "--instant")), /buy done: landed 2 SOL of 2/);
  const timed = await sw("buy", "1", `sol:${launches.sol}`, "--group", "swarm", "--count", "min", "--pick", "fresh", "--random", "5:15");
  assert.match(last(timed), /buy done/);
  assert.match(last(await sw("sell", "50%", `sol:${launches.sol}`, "--group", "swarm", "--instant")), /sell done/);

  assert.match(last(await sw("buy", "120", `sol:${launches.usdc}`, "--group", "swarm", "--count", "exact:4", "--split", "equal", "--instant")), /buy done: landed 120 .* of 120/);
  // the whole swarm at once: every send quoted as landing last
  assert.match(last(await sw("buy", "240", `sol:${launches.usdc}`, "--group", "swarm", "--count", "most", "--split", "weights:0.5:1", "--instant")), /buy done: landed 240 .* of 240/);
  assert.match(last(await sw("sell", "100%", `sol:${launches.usdc}`, "--group", "swarm", "--pick", "holders", "--instant")), /sell done/);

  // the store's ledger and the chain agree: the dUSDC holders sold everything
  const s = new Swarm("sole2e");
  const key = `sol:${launches.usdc}`;
  const holders = s.store.wallets({ group: "swarm" }).filter((x) => s.store.touched(x.id, key));
  assert.equal(holders.length, 24);
  const c = await s.chain("sol");
  for (const h of holders) {
    assert.equal(s.store.position(h.id, key).tokens, 0n, "sold 100 %");
    assert.equal(await c.balanceOf(launches.usdc!, h.sol!), 0n);
  }
  // wSOL is closed after each trade: the SOL launch's wallets hold no wSOL account balance
  assert.ok((await c.balanceOf("native", s.store.wallets({ group: "swarm" })[0]!.sol!)) > 0n);
});

test("launch: a group of creators takes turns on SOL, then the swarm trades it", { skip }, async () => {
  await sw("settings", "wallets", "1:24");
  await sw("wallets", "tag", "23-24", "creators");
  // short of SOL: the row's whole Team Buy costs more than the 2 SOL each wallet holds; named before the press, nothing sent
  await assert.rejects(main(["launch", "Short", "SHT", "--chain", "sol", "--from", "23", "--quote", "native", "--team-buy", "max"], () => {}), /wallet 23 \w+ doesn't have enough SOL to launch/);
  const need = (await main(["launch", "Dry", "DRY", "--chain", "sol", "--from", "23", "--quote", "native", "--dry-run"], () => {})) as { launches: { paid: bigint }[] };
  const each = Number(need.launches[0]!.paid * 2n + 1_000_000_000n) / 1e9;
  assert.match(last(await sw("fund", "--each", String(each), "--chain", "sol", "--from", "treasury", "--group", "creators", "--instant")), /fund done/);
  const two = (await main(["launch", "Swarm Sol Turns", "SST", "--chain", "sol", "--from", "creators", "--times", "3", "--quote", "native"], () => {})) as { launches: { creator: { id: number }; token: string; launchId: bigint }[] };
  assert.deepEqual(two.launches.map((x) => x.creator.id), [23, 24, 23]);
  assert.equal(new Set(two.launches.map((x) => x.token)).size, 3);
  const t = two.launches[2]!.token;
  assert.match(last(await sw("buy", "0.6", `sol:${t}`, "--group", "swarm", "--count", "exact:3", "--split", "equal", "--instant")), /buy done: landed 0.6 SOL of 0.6/);
  assert.match(last(await sw("sell", "100%", `sol:${t}`, "--group", "swarm", "--pick", "holders", "--random", "50:200")), /sell done/);
});

test("dry runs and refusals send nothing", { skip }, async () => {
  const dry = await sw("buy", "1", `sol:${launches.sol}`, "--group", "swarm", "--dry-run", "--seed", "s");
  assert.equal(dry.length, 1);
  await assert.rejects(sw("buy", "100", `sol:${launches.sol}`, "--group", "swarm"), /needs more room|eligible/);
  const d = (await main(["launch", "Nope", "NOP", "--chain", "sol", "--from", "treasury", "--dry-run"], () => {})) as { launches: { tx: string | null }[] };
  assert.equal(d.launches[0]!.tx, null);
  // the Team Buy is optional and capped at the row's share; the Team Slot rate is the row's, never a choice
  await assert.rejects(main(["launch", "Nope", "NOP", "--chain", "sol", "--from", "treasury", "--team-buy", "1000000000", "--dry-run"], () => {}), /max is/);
  await assert.rejects(main(["launch", "Nope", "NOP", "--chain", "sol", "--from", "treasury", "--slot-bps", "9999"], () => {}), /--slot-bps is gone/);
  // an EVM address is not a Solana target
  await assert.rejects(sw("target", "sol:0x0000000000000000000000000000000000000001"), /not|solana/i);
});
