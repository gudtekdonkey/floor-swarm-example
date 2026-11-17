// More end to end on the local EVM world (scripts/local-evm.sh, or scripts/fork-evm.sh's mainnet fork): the commands
// test/local/e2e.test.ts does not reach — wallets with on-chain balances, chain list, runs, preset --use, a timed sell, a
// pipeline run, team-slot add by --handle and a real team-slot buy, claim --to, the daemon's API with its real runner, and
// alerts to a loopback webhook. Runs after e2e.test.ts (the file order is sorted). Skips when the world is not up.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli.ts";
import { Swarm } from "../../src/swarm.ts";
import { NATIVE } from "../../src/chains/evm.ts";
import { startDaemon } from "../../src/daemon/server.ts";
import { encodeFunctionData, parseAbi } from "viem";

type World = { rpc: string; chainId: number; floorAmm: string; dUSDC: string; launches: { usdc: string; eth: string }; priceUpdater?: string; treasury: { key: string; address: string } };
const WORLD = process.env.SWARM_WORLD ?? join(import.meta.dirname, "../../data/local-evm.json");
const world = existsSync(WORLD) ? (JSON.parse(readFileSync(WORLD, "utf8")) as World) : null;
const w = world as World;

const up = async (): Promise<boolean> => {
  if (!world) return false;
  try {
    const r = await fetch(world.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return r.ok;
  } catch {
    return false;
  }
};
const skip = !(await up()) && "the local world is not up (scripts/local-evm.sh or scripts/fork-evm.sh)";
const PASS = "evm-more-e2e-pass";

const all: string[] = [];
const sw = async (...args: string[]): Promise<string[]> => {
  const out: string[] = [];
  await main(args, (l: string) => (out.push(l), all.push(l)));
  return out;
};
const res = async (...args: string[]): Promise<any> => main(args, (l: string) => all.push(l));
const last = (xs: string[]): string => xs.at(-1) ?? "";
const rpc = async (method: string, params: unknown[]): Promise<any> => {
  const r = (await (await fetch(w.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as { result?: unknown; error?: { message: string } };
  if (r.error) throw new Error(r.error.message);
  return r.result;
};

async function freshPrices(): Promise<void> {
  const abi = parseAbi(["function quoteEntry(address) view returns ((bool,bool,uint8,uint256,uint256,uint64,uint64))", "function setQuotePrice(address,uint256)"]);
  const pu = w.priceUpdater ?? "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"; // the devkit's price updater (anvil dev account 5)
  for (const q of [NATIVE, w.dUSDC]) {
    const raw = (await rpc("eth_call", [{ to: w.floorAmm, data: encodeFunctionData({ abi, functionName: "quoteEntry", args: [q as `0x${string}`] }) }, "latest"])) as string;
    const price = BigInt("0x" + raw.slice(2 + 64 * 4, 2 + 64 * 5));
    const tx = await rpc("eth_sendTransaction", [{ from: pu, to: w.floorAmm, data: encodeFunctionData({ abi, functionName: "setQuotePrice", args: [q as `0x${string}`, price] }) }]);
    for (let i = 0; i < 50 && !(await rpc("eth_getTransactionReceipt", [tx])); i++) await new Promise((r) => setTimeout(r, 100));
  }
}

before(() => {
  process.env.SWARM_HOME = mkdtempSync(join(tmpdir(), "swarm-evm-more-"));
  process.env.SWARM_PASSPHRASE = PASS;
  process.env.SWARM_NAME = "evmmore";
});

let launch = "";
let launchKey = "";

test("setup: init, chain add + list, wallets with on-chain balances, fund", { skip }, async () => {
  await freshPrices(); // an earlier file may have moved the clock past the registry prices' 24 h
  await sw("init", "--generate", "8", "--group", "swarm");
  await sw("wallets", "import", w.treasury.key, "--group", "treasury"); // wallet 9
  assert.match(last(await sw("chain", "add", "local", "--rpc", w.rpc, "--floor-amm", w.floorAmm, "--chain-id", String(w.chainId))), /chain local: .*FloorAmm/);
  const list = await sw("chain");
  assert.ok(list.some((l) => l.includes("local") && l.includes(String(w.chainId)) && l.toLowerCase().includes(w.floorAmm.toLowerCase())), list.join("\n"));
  assert.match(last(await sw("fund", "--each", "1", "--chain", "local", "--from", "treasury", "--group", "swarm", "--instant")), /fund done: landed 8 ETH of 8/);
  assert.match(last(await sw("fund", "800", "--chain", "local", "--token", w.dUSDC, "--from", "treasury", "--group", "swarm", "--split", "equal", "--instant")), /fund done: landed 800 dUSDC/);
  const bal = (await res("wallets", "--chain", "local", "--token", w.dUSDC, "--group", "swarm")) as { id: number; native: bigint; tokenBalance: bigint }[];
  assert.equal(bal.length, 8);
  for (const b of bal) {
    assert.ok(b.native >= 10n ** 18n, `wallet ${b.id} holds 1 ETH (${b.native})`);
    assert.equal(b.tokenBalance, 100_000_000n, `wallet ${b.id} holds 100 dUSDC`);
  }
  await sw("settings", "wallets", "1:16");
  await sw("settings", "per-wallet", "local:native", "0.001:0.5");
});

test("team-slot add (--member and --handle), volume, then a successful team-slot buy", { skip }, async () => {
  const made = (await res("launch", "Extra Slot", "XSL", "--chain", "local", "--from", "9", "--quote", "native")) as { launches: { token: string }[] };
  launch = made.launches[0]!.token;
  launchKey = `local:${launch.toLowerCase()}`;
  const add = await sw("team-slot", "add", `local:${launch}`, "--from", "9", "--member", "1,2", "--shares", "1");
  assert.equal(add.filter((l) => /✓/.test(l)).length, 2, add.join("\n"));
  const h = await sw("team-slot", "add", `local:${launch}`, "--from", "9", "--handle", "x:extra_alice", "--shares", "1");
  assert.equal(h.filter((l) => /✓/.test(l)).length, 1, h.join("\n"));
  // volume from the non-members accrues the members' Team Shares
  for (let i = 0; i < 3; i++) {
    assert.match(last(await sw("buy", "1.5", `local:${launch}`, "--ids", "3-8", "--split", "equal", "--instant")), /buy done/);
    assert.match(last(await sw("sell", "90%", `local:${launch}`, "--ids", "3-8", "--instant")), /sell done/);
  }
  const s = new Swarm("evmmore");
  s.unlock(PASS);
  const c = await s.chain("local");
  const l = await s.resolve(`local:${launch}`);
  const [m1, m2] = s.store.wallets({ ids: [1, 2] });
  const [o1, o2] = [await c.teamShareOwed(m1, l), await c.teamShareOwed(m2, l)];
  assert.ok(o1 > 0n && o2 > 0n, `members are owed a Team Share (${o1}, ${o2})`);
  const spend = (o1 + o2) / 2n;
  const ether = (x: bigint): string => { const s = x.toString().padStart(19, "0"); return `${s.slice(0, -18)}.${s.slice(-18)}`; };
  const out = await sw("team-slot", "buy", ether(spend), `local:${launch}`, "--ids", "1,2", "--instant");
  assert.match(last(out), /done/, out.join("\n"));
  // a Team Share buy books the tokens as owed (shareBought), paid by a claim — never straight to the wallet
  const owed = await Promise.all([m1, m2].map(async (m) => (await c.owedOf(m, [l])).launches[0]!.owed.shareBought));
  assert.ok(owed[0]! + owed[1]! > 0n, `the buy booked shareBought (${owed})`);
  const s2 = new Swarm("evmmore");
  assert.ok(s2.store.position(1, launchKey).tokens + s2.store.position(2, launchKey).tokens > 0n, "fills recorded");
  // a non-member is refused by name
  await assert.rejects(sw("team-slot", "buy", "0.001", `local:${launch}`, "--ids", "5", "--instant"), /owed a Team Share/);
});

test("preset --use, a timed (--random) sell, runs list and runs <id>", { skip }, async () => {
  assert.match(last(await sw("preset", "save", "two", "--", "--count", "exact:2", "--split", "equal", "--instant")), /preset two/);
  assert.ok((await sw("preset", "list")).some((l) => l.startsWith("two")));
  const b = await sw("buy", "40", `local:${w.launches.usdc}`, "--ids", "3-8", "--use", "two");
  assert.match(b[0]!, /^buy: 2 wallets/, b.join("\n"));
  assert.match(last(b), /buy done: landed 40 dUSDC of 40/);
  const t0 = Date.now();
  const sell = await sw("sell", "100%", `local:${w.launches.usdc}`, "--ids", "3-8", "--pick", "holders", "--random", "800:1200");
  assert.match(last(sell), /sell done/, sell.join("\n"));
  assert.ok(Date.now() - t0 >= 700, `the timed sell waited between sends (${Date.now() - t0} ms)`);
  assert.match(last(await sw("preset", "rm", "two")), /removed two/);
  const runs = (await res("runs")) as { id: number; kind: string; status: string }[];
  assert.ok(runs.length >= 8);
  const one = (await res("runs", String(runs[0]!.id))) as { id: number };
  assert.equal(one.id, runs[0]!.id);
});

test("pipeline: save, show, run (buy then sell after the run is done), rm", { skip }, async () => {
  const file = join(process.env.SWARM_HOME!, "p.json");
  writeFileSync(file, JSON.stringify({ steps: [
    { cmd: `buy 0.2 local:${w.launches.eth} --ids 3-5 --split equal --instant` },
    { cmd: `sell 100% local:${w.launches.eth} --ids 3-5 --pick holders --instant`, when: "until_run_status done" },
  ] }));
  const saved = await sw("pipeline", "save", "flip", file);
  assert.match(last(saved), /pipeline flip: 2 steps/);
  assert.equal((await sw("pipeline", "show", "flip")).length, 2);
  const out = await sw("pipeline", "run", "flip");
  assert.ok(out.some((l) => /pipeline flip done/.test(l)), out.join("\n"));
  assert.match(last(await sw("pipeline", "rm", "flip")), /removed flip/);
});

test("claim --to: members claim their shareBought tokens; quote payouts go to --to", { skip }, async () => {
  const to = "0x000000000000000000000000000000000000dEaD";
  await rpc("evm_increaseTime", [86400 + 60]);
  await rpc("evm_mine", []);
  await freshPrices();
  const s = new Swarm("evmmore");
  s.unlock(PASS);
  const c = await s.chain("local");
  const [m1, m2] = s.store.wallets({ ids: [1, 2] });
  const dry = await sw("claim", `local:${launch}`, "--ids", "1,2", "--dry-run");
  assert.equal(dry.filter((l) => /is owed: .*shareBought|is owed: .*share/i.test(l)).length, 2, dry.join("\n"));
  const [t1, t2, nat0] = [await c.balanceOf(launch, m1.evm!), await c.balanceOf(launch, m2.evm!), await c.balanceOf(NATIVE, to)];
  const done = await sw("claim", `local:${launch}`, "--ids", "1,2", "--to", to);
  for (const id of [1, 2]) assert.ok(done.some((l) => new RegExp(`✓ wallet ${id}\\b`).test(l)), done.join("\n"));
  assert.ok((await c.balanceOf(launch, m1.evm!)) > t1 && (await c.balanceOf(launch, m2.evm!)) > t2, "the shareBought tokens reached the members");
  const quotePaid = done.some((l) => /claimed [0-9.]+ ETH/.test(l));
  // README: --to redirects only EVM's owed payouts bucket; creator / Team Slot earnings and tokens pay the wallet itself
  const raw = (await c.owedOf(m1, [await s.resolve(`local:${launch}`)])).raw as { quotes: { payout: bigint }[] };
  assert.equal(raw.quotes.reduce((t, q) => t + q.payout, 0n), 0n, "no payouts bucket is owed after the claim");
  assert.equal(await c.balanceOf(NATIVE, to), nat0, "with no payouts bucket owed, --to receives nothing");
  console.log(`# claim --to: Team Slot quote take ${quotePaid ? "paid to the wallets" : "none owed"}; lines:\n# ${done.join("\n# ")}`);
  const again = await sw("claim", `local:${launch}`, "--ids", "1,2");
  assert.ok(again.some((l) => /0 claimed, 2 owed nothing/.test(l)), again.join("\n"));
  await assert.rejects(sw("claim", `local:${launch}`, "--ids", "1", "--to", "nope"), /not an address/);
});

test("daemon: unlock, state, wallets with balances, target, preview, a real buy job", { skip }, async () => {
  const s = new Swarm("evmmore");
  const d = await startDaemon({ swarm: s, port: 0 });
  const H = { authorization: `Bearer ${d.token}`, "content-type": "application/json" };
  const api = async (path: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method: body === undefined ? "GET" : "POST", headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  try {
    assert.equal((await api("/api/unlock", { passphrase: PASS })).status, 200);
    const st = await api("/api/state");
    assert.equal(st.status, 200);
    assert.ok(st.json.chains.local, JSON.stringify(st.json));
    const ws = await api(`/api/wallets?chain=local&token=${w.dUSDC}&group=swarm&fresh=1`);
    assert.equal(ws.status, 200, JSON.stringify(ws.json));
    assert.equal(ws.json.wallets.length, 8);
    const t = await api(`/api/target?t=local:${w.launches.usdc}`);
    assert.equal(t.status, 200, JSON.stringify(t.json));
    const pv = await api("/api/preview", { argv: ["buy", "10", `local:${w.launches.usdc}`, "--ids", "3-6", "--split", "equal"] });
    assert.equal(pv.status, 200);
    assert.equal(pv.json.ok, true, JSON.stringify(pv.json));
    const job = await api("/api/run", { argv: ["buy", "10", `local:${w.launches.usdc}`, "--ids", "3-6", "--split", "equal", "--instant"] });
    assert.equal(job.status, 202);
    let j: any;
    for (let i = 0; i < 300; i++) {
      j = (await api(`/api/jobs/${job.json.job}`)).json;
      if (j.status !== "queued" && j.status !== "running") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(j.status, "done", JSON.stringify(j));
    assert.ok(JSON.stringify(j).includes("landed 10 dUSDC of 10"), JSON.stringify(j));
    const runs = await api("/api/runs");
    const r = await api(`/api/runs/${runs.json[0].id}`);
    assert.equal(r.status, 200);
  } finally {
    await d.close();
  }
});

test("alerts: a webhook on loopback gets the test alert", { skip }, async () => {
  const got: string[] = [];
  const srv = createServer((req, res) => {
    let b = "";
    req.on("data", (x) => (b += x));
    req.on("end", () => (got.push(b), res.end("ok")));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  try {
    await sw("alerts", "webhook", `http://127.0.0.1:${port}/hook`);
    const out = await sw("alerts", "test");
    assert.ok(out.some((l) => /sent/.test(l)) || got.length > 0, out.join("\n"));
    assert.ok(got.some((b) => b.includes("test alert")), `webhook body: ${got.join(" | ")}`);
    assert.match(last(await sw("alerts", "off")), /webhook: off/);
  } finally {
    srv.close();
  }
});
