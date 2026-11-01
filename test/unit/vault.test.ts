import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../../src/vault/vault.ts";
import { Swarm } from "../../src/swarm.ts";

// anvil's dev account 9: a public test key
const KEY9 = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";
const MNEMONIC = "test test test test test test test test test test test junk";

test("the vault round-trips, refuses a wrong passphrase, and never stores a secret in the clear", () => {
  const p = join(mkdtempSync(join(tmpdir(), "vault-")), "vault.json");
  const v = Vault.create(p, "correct horse", { mnemonic: MNEMONIC });
  // anvil's dev mnemonic: index 0 is 0xf39F…2266
  assert.equal(v.evmAccount({ source: "hd", index: 0 }).address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  const { keyId, address } = v.importEvmKey(KEY9);
  assert.equal(address, "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720");
  assert.equal(v.importEvmKey(KEY9).keyId, keyId);
  const raw = readFileSync(p, "utf8");
  assert.ok(!raw.includes("junk") && !raw.includes(KEY9.slice(2)));
  const again = Vault.open(p, "correct horse");
  assert.equal(again.evmAccount({ source: "key", keyId }).address, address);
  assert.throws(() => Vault.open(p, "wrong horse"), /wrong passphrase/);
  assert.throws(() => Vault.create(p, "correct horse"), /already exists/);
});

test("a swarm derives HD wallets in order and keeps only addresses in its store", () => {
  const home = mkdtempSync(join(tmpdir(), "swarm-"));
  const s = new Swarm("t", home);
  s.createVault("passphrase", MNEMONIC);
  const ws = s.derive(3, ["a"]);
  assert.deepEqual(ws.map((w) => w.ref), [0, 1, 2].map((index) => ({ source: "hd", index })));
  assert.equal(ws[1]!.evm, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  assert.equal(s.derive(1)[0]!.ref.source === "hd" && (s.derive(1)[0]!.ref as { index: number }).index, 4);
  const k = s.importKey(KEY9, ["treasury", "ops"]);
  assert.deepEqual(k.groups, ["treasury", "ops"]);
  assert.equal(s.store.wallets({ group: "a" }).length, 3);
  const dump = JSON.stringify(s.store.db.prepare("select * from wallets").all());
  assert.ok(!dump.includes(KEY9.slice(2)) && !dump.includes("junk"));
});
