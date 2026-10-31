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

const mine = async (sym: string, name: string, from: string, ...more: string[]): Promise<{ token: string; launchId: bigint; paid: bigint }> => {
  const r = (await main(["launch", name, sym, "--chain", "local", "--from", from, ...more], () => {})) as { launches: { token: string; launchId: bigint; paid: bigint }[] };
  return r.launches[0]!;
};

test("swap: sell one launch and buy another with the quote out", { skip }, async () => {
  const w = world!;
  await freshPrices(w);
  await sw("settings", "wallets", "1:16");
  const other = await mine("SWP", "Swarm Swap", "17", "--quote", w.dUSDC);
  const from = `local:${w.launches.usdc}`;
  const to = `local:${other.token}`;
  await sw("buy", "60", from, "--group", "swarm", "--count", "exact:3", "--split", "equal", "--instant");
  const s = new Swarm("e2e");
  const holders = s.store.wallets({ group: "swarm" }).filter((x) => s.store.position(x.id, from.toLowerCase()).tokens > 0n);
  assert.ok(holders.length >= 3);
  const before = new Map(holders.map((h) => [h.id, s.store.position(h.id, from.toLowerCase()).tokens]));
  const out = await sw("swap", "50%", from, to, "--ids", holders.map((h) => h.id).join(","), "--instant");
  assert.match(last(out), /swap: 3 wallets swapped/);
  const c = await s.chain("local");
  const s2 = new Swarm("e2e");
  for (const h of holders) {
    const now = s2.store.position(h.id, from.toLowerCase()).tokens;
    assert.ok(now > 0n && now < before.get(h.id)!, `wallet ${h.id} sold part of A`);
    assert.ok(s2.store.position(h.id, to.toLowerCase()).tokens > 0n, `wallet ${h.id} bought B`);
    assert.ok((await c.balanceOf(other.token, h.evm!)) > 0n);
  }
  // two quote assets are refused by name before anything is sent
  await assert.rejects(sw("swap", "50%", from, `local:${w.launches.eth}`, "--ids", String(holders[0]!.id), "--instant"), /one quote asset/);
  const dry = await sw("swap", "100%", from, to, "--ids", String(holders[0]!.id), "--dry-run");
  assert.ok(dry.length >= 1);
});

test("snipe: catches a launch created a few seconds after it starts", { skip }, async () => {
  const w = world!;
  await freshPrices(w);
  const snipe = sw("snipe", "20", "--chain", "local", "--symbol", "SNP", "--group", "swarm", "--within", "90", "--count", "exact:2", "--split", "equal", "--instant");
  // a launch that does not match, then the one that does
  await new Promise((r) => setTimeout(r, 3000));
  await mine("OTH", "Not This One", "17", "--quote", w.dUSDC);
  await new Promise((r) => setTimeout(r, 2000));
  const made = await mine("SNP", "Snipe Me", "17", "--quote", w.dUSDC);
  const out = await snipe;
  assert.ok(out.some((l) => l.includes("snipe: caught SNP")), out.join("\n"));
  assert.ok(out.some((l) => l.toLowerCase().includes(made.token.toLowerCase())));
  assert.match(last(out), /buy done: landed 20 dUSDC of 20/);
  const s = new Swarm("e2e");
  const c = await s.chain("local");
  let holders = 0;
  for (const x of s.store.wallets({ group: "swarm" })) if ((await c.balanceOf(made.token, x.evm!)) > 0n) holders++;
  assert.equal(holders, 2);

  // nothing matching inside the window: a clear result, nothing bought
  const none = await sw("snipe", "1", "--chain", "local", "--symbol", "NEVER", "--group", "swarm", "--within", "3", "--instant");
  assert.ok(none.some((l) => /no launch matched symbol NEVER within 3 s/.test(l)), none.join("\n"));
});

test("claim and team-slot: the Team Buy unlocks, a claim pays it, a slot member is added", { skip }, async () => {
  const w = world!;
  await freshPrices(w);
  // wallet 16 creates with the row's Team Buy, then the swarm trades it
  const tb = await mine("CLM", "Claim Me", "16", "--quote", "native", "--team-buy", "max");
  assert.ok(tb.paid > 0n);
  const target = `local:${tb.token}`;
  await sw("buy", "0.3", target, "--group", "swarm", "--count", "exact:3", "--split", "equal", "--instant");

  // locked: nothing is claimable before the day is up, so every wallet is skipped
  const early = await sw("claim", target, "--ids", "16", "--dry-run");
  assert.ok(early.some((l) => /owed nothing/.test(l)), early.join("\n"));

  const slot = await sw("team-slot", "add", target, "--from", "16", "--member", "3,4", "--shares", "1");
  assert.ok(slot.filter((l) => /✓/.test(l)).length === 2, slot.join("\n"));

  await rpc("evm_increaseTime", [86400 + 60]);
  await rpc("evm_mine", []);
  await freshPrices(w);
  const s = new Swarm("e2e");
  const c = await s.chain("local");
  const creator = s.store.wallets({ ids: [16] })[0]!;
  const tokensBefore = await c.balanceOf(tb.token, creator.evm!);
  const dry = await sw("claim", target, "--ids", "16", "--dry-run");
  assert.ok(dry.some((l) => /is owed: .*teamBuy/.test(l)), dry.join("\n"));
  const done = await sw("claim", target, "--ids", "16,17,1", "--to", creator.evm!);
  assert.ok(done.some((l) => /✓ wallet 16/.test(l)), done.join("\n"));
  assert.ok(done.some((l) => /claim: 1 claimed, 2 owed nothing/.test(l)), done.join("\n"));
  assert.ok((await c.balanceOf(tb.token, creator.evm!)) > tokensBefore, "the Team Buy tokens reached the wallet");
  // claimed once: the next claim finds nothing owed
  const again = await sw("claim", target, "--ids", "16");
  assert.ok(again.some((l) => /claim: 0 claimed, 1 owed nothing/.test(l)), again.join("\n"));
  // --all-launches reads every launch the swarm made or traded
  const all = await sw("claim", "--all-launches", "--group", "swarm", "--dry-run");
  assert.ok(all.some((l) => /launches/.test(l)), all.join("\n"));

  // a member with a place but no Team Share to spend is refused by name; a non-member wallet too
  await assert.rejects(sw("team-slot", "buy", "0.01", target, "--ids", "3,4", "--instant"), /owed a Team Share|Team Share/);
});
