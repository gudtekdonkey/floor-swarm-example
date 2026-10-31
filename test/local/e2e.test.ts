// End to end on the local anvil world (scripts/local-evm.sh → data/local-evm.json): fund, buy and sell through the CLI's own
// entry point, on the native-quoted launch and the dUSDC one, instant and timed. Skips when the world is not up.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli.ts";
import { Swarm } from "../../src/swarm.ts";
import { NATIVE } from "../../src/chains/evm.ts";
import { encodeFunctionData, parseAbi } from "viem";

// SWARM_WORLD picks a fork's world, e.g. data/local-evm-84532.json (scripts/local-evm.sh --fork …)
const WORLD = process.env.SWARM_WORLD ?? join(import.meta.dirname, "../../data/local-evm.json");
const world = existsSync(WORLD) ? (JSON.parse(readFileSync(WORLD, "utf8")) as { rpc: string; chainId: number; floorAmm: string; dUSDC: string; launches: { usdc: string; eth: string }; treasury: { key: string } }) : null;

const up = async (): Promise<boolean> => {
  if (!world) return false;
  try {
    const r = await fetch(world.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return r.ok;
  } catch {
    return false;
  }
};

const lines: string[] = [];
const sw = async (...args: string[]): Promise<string[]> => {
  const out: string[] = [];
  await main(args, (l) => (out.push(l), lines.push(l)));
  return out;
};
const last = (xs: string[]): string => xs.at(-1) ?? "";

const skip = !(await up()) && "the local world is not up (scripts/local-evm.sh)";

before(() => {
  process.env.SWARM_HOME = mkdtempSync(join(tmpdir(), "swarm-e2e-"));
  process.env.SWARM_PASSPHRASE = "local-e2e-pass";
  process.env.SWARM_NAME = "e2e";
});

test("fund → buy → sell on both launches", { skip }, async () => {
  const w = world!;
  await sw("init", "--generate", "16", "--group", "swarm");
  await sw("wallets", "import", w.treasury.key, "--group", "treasury");
  await sw("chain", "add", "local", "--rpc", w.rpc, "--floor-amm", w.floorAmm, "--chain-id", String(w.chainId));
  assert.match(last(await sw("target", w.launches.eth)), /launch \d+ · quote ETH/);

  assert.match(last(await sw("fund", "--each", "0.5", "--chain", "local", "--from", "treasury", "--group", "swarm", "--instant")), /fund done: landed 8 ETH of 8/);
  assert.match(last(await sw("fund", "500", "--chain", "local", "--token", w.dUSDC, "--from", "treasury", "--group", "swarm", "--split", "equal", "--instant")), /fund done: landed 500 dUSDC/);

  await sw("settings", "per-wallet", "local:native", "0.01:0.3");
  await sw("settings", "wallets", "3:16");
  // the Count · Pick · Split knobs, instant
  assert.match(last(await sw("buy", "2", `local:${w.launches.eth}`, "--group", "swarm", "--count", "most:12", "--pick", "least_used", "--split", "weights:0.2:1", "--instant")), /buy done: landed 2 ETH of 2/);
  // Min: the fewest wallets at 0.3 max for 1 ETH; timed
  const minRun = await sw("buy", "1", `local:${w.launches.eth}`, "--group", "swarm", "--count", "min", "--pick", "fresh", "--random", "10:30");
  // 4 at a full 0.3 cap; one more when the gas reserve (gas price × 5M) cuts the caps, as on a busy fork
  assert.match(minRun[0]!, /^buy: [45] wallets/);
  assert.match(last(minRun), /buy done/);
  assert.match(last(await sw("sell", "50%", `local:${w.launches.eth}`, "--group", "swarm", "--instant")), /sell done/);

  assert.match(last(await sw("buy", "120", `local:${w.launches.usdc}`, "--group", "swarm", "--count", "exact:4", "--split", "equal", "--instant")), /buy done: landed 120 dUSDC of 120/);
  assert.match(last(await sw("sell", "100%", `local:${w.launches.usdc}`, "--group", "swarm", "--pick", "holders", "--instant")), /sell done/);

  // the store's own ledger: positions from fills, every send recorded
  const s = new Swarm("e2e");
  const key = `local:${w.launches.usdc.toLowerCase()}`;
  const holders = s.store.wallets({ group: "swarm" }).filter((x) => s.store.touched(x.id, key));
  assert.equal(holders.length, 4);
  for (const h of holders) assert.equal(s.store.position(h.id, key).tokens, 0n, "sold 100 %");
  const c = await s.chain("local");
  for (const h of holders) assert.equal(await c.balanceOf(w.launches.usdc, h.evm!), 0n);
  assert.ok((await c.balanceOf(NATIVE, s.store.wallets({ group: "swarm" })[0]!.evm!)) > 0n);
});

test("dry run and infeasible plans send nothing", { skip }, async () => {
  const w = world!;
  const dry = await sw("buy", "1", `local:${w.launches.eth}`, "--group", "swarm", "--dry-run", "--seed", "s");
  assert.equal(dry.length, 1);
  await assert.rejects(sw("buy", "100", `local:${w.launches.eth}`, "--group", "swarm"), /needs more room|eligible/);
});

const rpc = async (method: string, params: unknown[]): Promise<any> => {
  const r = (await (await fetch(world!.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as { result?: unknown; error?: { message: string } };
  if (r.error) throw new Error(r.error.message);
  return r.result;
};

/** The SDK refuses a registry price over 24 h old; the long soak above can cross it on a fork the devkit moved a day on. */
async function freshPrices(w: NonNullable<typeof world>): Promise<void> {
  const abi = parseAbi(["function quoteEntry(address) view returns ((bool,bool,uint8,uint256,uint256,uint64,uint64))", "function setQuotePrice(address,uint256)"]);
  const pu = (w as { priceUpdater?: string }).priceUpdater ?? "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
  for (const q of [NATIVE, w.dUSDC]) {
    const raw = (await rpc("eth_call", [{ to: w.floorAmm, data: encodeFunctionData({ abi, functionName: "quoteEntry", args: [q as `0x${string}`] }) }, "latest"])) as string;
    const price = BigInt("0x" + raw.slice(2 + 64 * 4, 2 + 64 * 5));
    const tx = await rpc("eth_sendTransaction", [{ from: pu, to: w.floorAmm, data: encodeFunctionData({ abi, functionName: "setQuotePrice", args: [q as `0x${string}`, price] }) }]);
    for (let i = 0; i < 50 && !(await rpc("eth_getTransactionReceipt", [tx])); i++) await new Promise((r) => setTimeout(r, 100));
  }
}

test("launch: a picked wallet creates, then the swarm trades it", { skip }, async () => {
  const w = world!;
  await freshPrices(w);
  // one creator by id (the treasury, funded on both quotes), then a group taking turns
  const one = (await main(["launch", "Swarm Made", "SWM", "--chain", "local", "--from", "17", "--quote", w.dUSDC], () => {})) as { launches: { launchId: bigint; token: string; creator: { id: number } }[] };
  assert.equal(one.launches.length, 1);
  assert.equal(one.launches[0]!.creator.id, 17);
  const t = one.launches[0]!.token;
  assert.match(last(await sw("target", t)), /quote dUSDC/);
  assert.match(last(await sw("buy", "30", `local:${t}`, "--group", "swarm", "--count", "exact:3", "--split", "equal", "--instant")), /buy done: landed 30 dUSDC of 30/);

  // a group of two creators taking turns, the last one with the row's whole Team Buy (preset 3: about 0.5 ETH at the devkit's price)
  await sw("settings", "wallets", "1:16"); // the soak above set a minimum of 3
  await sw("wallets", "tag", "15-16", "creators");
  assert.match(last(await sw("fund", "--each", "2", "--chain", "local", "--from", "treasury", "--group", "creators", "--instant")), /fund done/);
  const two = (await main(["launch", "Swarm Turns", "SWT", "--chain", "local", "--from", "creators", "--times", "3", "--quote", "native"], () => {})) as { launches: { creator: { id: number }; token: string }[] };
  assert.deepEqual(two.launches.map((x) => x.creator.id), [15, 16, 15]);
  assert.ok(two.launches.every((x) => /^0x[0-9a-fA-F]{40}$/.test(x.token)));
  const tb = (await main(["launch", "Swarm Team", "SWB", "--chain", "local", "--from", "16", "--quote", "native", "--team-buy", "max"], () => {})) as { launches: { token: string; paid: bigint }[] };
  assert.equal(tb.launches.length, 1);
  assert.ok(tb.launches[0]!.paid > 0n);

  const dry = (await main(["launch", "Nope", "NOP", "--chain", "local", "--from", "17", "--dry-run"], () => {})) as { launches: { tx: string | null }[] };
  assert.equal(dry.launches[0]!.tx, null);
  // the Team Buy is optional and capped at the row's share; the Team Slot rate is the row's, never a choice
  await assert.rejects(main(["launch", "Nope", "NOP", "--chain", "local", "--from", "17", "--team-buy", "1000000000", "--dry-run"], () => {}), /max is/);
  await assert.rejects(main(["launch", "Nope", "NOP", "--chain", "local", "--from", "17", "--slot-bps", "9999"], () => {}), /--slot-bps is gone/);
  await assert.rejects(main(["launch", "Nope", "NOP", "--chain", "local", "--from", "nobody"], () => {}), /no wallet in group nobody/);
});
