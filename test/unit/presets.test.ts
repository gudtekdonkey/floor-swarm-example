import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../../src/store/db.ts";
import { applyPreset, mergeFlags, parsePresetFlags, savePreset, listPresets, removePreset } from "../../src/presets.ts";
import { runJson } from "../../src/cli.ts";
import { Swarm } from "../../src/swarm.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the command line wins over the preset", () => {
  const m = mergeFlags(["--count", "most:40", "--pick", "random", "--slippage", "100"], ["--count", "exact:5", "buy", "10"]);
  assert.deepEqual(m, ["--pick", "random", "--slippage", "100", "--count", "exact:5", "buy", "10"]);
});

test("timing flags replace each other: --instant on the line drops the preset's --random", () => {
  assert.deepEqual(mergeFlags(["--random", "500:3000", "--retries", "2"], ["--instant"]), ["--retries", "2", "--instant"]);
  assert.deepEqual(mergeFlags(["--instant"], ["--random=1:2"]), ["--random=1:2"]);
});

test("a flag given as --name=value on the line still wins", () => {
  assert.deepEqual(mergeFlags(["--group", "a"], ["--group=b"]), ["--group=b"]);
});

test("a preset takes only knob flags and checks their values", () => {
  assert.throws(() => parsePresetFlags(["--rpc", "http://x"]), /cannot be saved/);
  assert.throws(() => parsePresetFlags(["--json"]), /cannot be saved/);
  assert.throws(() => parsePresetFlags(["--instant", "yes"]), /takes no value/);
  assert.throws(() => parsePresetFlags(["--count"]), /takes one value/);
  assert.deepEqual(parsePresetFlags(["--count", "most:3", "--amount", "10"]), { flags: ["--count", "most:3"], amount: "10" });
});

test("save, list, apply, remove", () => {
  const st = new Store(":memory:");
  savePreset(st, "snipe", ["--count", "most:40", "--pick", "least_used", "--amount", "2.5"]);
  assert.deepEqual(listPresets(st).map((p) => p.name), ["snipe"]);
  assert.deepEqual(applyPreset(st, ["buy", "0xabc", "--use", "snipe", "--pick", "richest"]), ["--count", "most:40", "buy", "2.5", "0xabc", "--pick", "richest"]);
  // an amount typed on the line is kept
  assert.deepEqual(applyPreset(st, ["buy", "9", "0xabc", "--use=snipe"]), ["--count", "most:40", "--pick", "least_used", "buy", "9", "0xabc"]);
  assert.throws(() => applyPreset(st, ["buy", "--use", "nope"]), /no preset/);
  assert.equal(removePreset(st, "snipe"), true);
  assert.equal(listPresets(st).length, 0);
  assert.throws(() => savePreset(st, "bad name", ["--count", "min"]), /bad preset name/);
});

test("the CLI saves and lists presets and exits 3 on a bad one", async () => {
  process.env.SWARM_HOME = mkdtempSync(join(tmpdir(), "swarm-preset-"));
  const sw = new Swarm("t");
  const save = JSON.parse((await runJson(["preset", "save", "p1", "--", "--count", "most:3", "--instant"], { swarm: sw })).out);
  assert.equal(save.ok, true);
  const list = JSON.parse((await runJson(["preset", "list"], { swarm: sw })).out);
  assert.deepEqual(list.result.map((p: { name: string }) => p.name), ["p1"]);
  const bad = await runJson(["preset", "save", "p2", "--", "--rpc", "x"], { swarm: sw });
  assert.equal(bad.code, 3);
  const rm = JSON.parse((await runJson(["preset", "rm", "p1"], { swarm: sw })).out);
  assert.equal(rm.result.removed, true);
});
