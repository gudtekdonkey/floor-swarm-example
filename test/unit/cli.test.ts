// The CLI's machine face: `--json` envelopes, exit codes and the command list (README "Driving it from a script").
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMANDS, parseCount, parseIds, parseSplit, runJson } from "../../src/cli.ts";

process.env.SWARM_HOME = mkdtempSync(join(tmpdir(), "swarm-cli-"));
delete process.env.SWARM_PASSPHRASE;

const json = async (...argv: string[]) => {
  const r = await runJson([...argv, "--json"]);
  return { ...r, body: JSON.parse(r.out) };
};

test("help --json lists every command as data", async () => {
  const r = await json("help");
  assert.equal(r.code, 0);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.result.commands.map((c: { cmd: string }) => c.cmd), COMMANDS.map((c) => c.cmd));
  for (const c of ["buy", "sell", "fund", "init", "runs"]) assert.ok(r.body.result.usage.includes(`swarm ${c}`), c);
});

test("an unknown command is a usage error, exit 3", async () => {
  const r = await json("teleport");
  assert.equal(r.code, 3);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error.kind, "usage");
});

test("an unknown flag is a usage error, not a crash", async () => {
  const r = await json("runs", "--nope");
  assert.equal(r.code, 3);
  assert.equal(r.body.error.kind, "usage");
});

test("buy with missing arguments names its usage", async () => {
  const r = await json("buy", "10");
  assert.equal(r.code, 3);
  assert.match(r.body.error.message, /swarm buy <total> <target>/);
});

test("a command that needs the vault says so before anything else", async () => {
  const r = await json("wallets", "add", "5");
  assert.equal(r.code, 1);
  assert.match(r.body.error.message, /no vault yet/);
});

test("init without a terminal or SWARM_PASSPHRASE refuses instead of hanging", async () => {
  const r = await json("init");
  assert.equal(r.code, 3);
  assert.match(r.body.error.message, /SWARM_PASSPHRASE/);
});

test("init, list and settings round-trip as JSON", async () => {
  process.env.SWARM_PASSPHRASE = "test passphrase";
  process.env.SWARM_NAME = "cli-roundtrip";
  try {
    const init = await json("init", "--generate", "3", "--group", "snipers");
    assert.equal(init.code, 0, init.out);
    assert.equal(init.body.result.wallets.length, 3);
    const ls = await json("wallets", "--group", "snipers");
    assert.deepEqual(ls.body.result.map((w: { id: number }) => w.id), init.body.result.wallets.map((w: { id: number }) => w.id));
    assert.match(ls.body.result[0].address, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(ls.body.result[0].source, "hd/0");
    const set = await json("settings", "wallets", "2:40");
    assert.deepEqual(set.body.result.wallets_per_command, { min: 2, max: 40 });
    const again = await json("init");
    assert.equal(again.code, 1);
    assert.match(again.body.error.message, /already exists/);
    const runs = await json("runs");
    assert.deepEqual(runs.body.result, []);
  } finally {
    delete process.env.SWARM_PASSPHRASE;
    delete process.env.SWARM_NAME;
  }
});

test("settings refuses a bad band", async () => {
  const r = await json("settings", "wallets", "5:2");
  assert.equal(r.body.ok, false);
});

test("the knob parsers", () => {
  assert.deepEqual(parseIds("1,3-5,9"), [1, 3, 4, 5, 9]);
  assert.throws(() => parseIds("1,x"));
  assert.deepEqual(parseCount("most:40"), { kind: "most", max: 40 });
  assert.deepEqual(parseCount("random:20:60"), { kind: "random", min: 20, max: 60 });
  assert.deepEqual(parseCount("pct:25"), { kind: "pct", pct: 25 });
  assert.throws(() => parseCount("lots"));
  assert.deepEqual(parseSplit("weights:0.2:1"), { kind: "weights", min: 0.2, max: 1 });
  assert.deepEqual(parseSplit("balance"), { kind: "by_balance" });
  assert.throws(() => parseSplit("vibes"));
});
