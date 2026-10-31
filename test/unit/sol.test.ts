import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseSolSecret, slip10Ed25519, solFromMnemonic, solSigner } from "../../src/vault/sol-keys.ts";
import { Vault } from "../../src/vault/vault.ts";
import { Swarm } from "../../src/swarm.ts";
import { Store } from "../../src/store/db.ts";
import { allowSolana } from "../../src/chains/config.ts";
import { base58Decode, base58Encode } from "../../vendor/floor-sdk/codec.ts";

const MNEMONIC = "test test test test test test test test test test test junk";

test("SLIP-0010 ed25519 matches the spec's test vector 1", () => {
  const seed = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
  assert.equal(slip10Ed25519(seed, []).toString("hex"), "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7");
  assert.equal(slip10Ed25519(seed, [0]).toString("hex"), "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3");
  assert.equal(slip10Ed25519(seed, [0, 1, 2, 2, 1000000000]).toString("hex"), "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793");
  // m/0' public key: 00 ‖ 8c8a13df…350c
  assert.equal(Buffer.from(base58Decode(solSigner(slip10Ed25519(seed, [0])).address)).toString("hex"), "8c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c");
});

test("HD addresses equal solana-keygen's (prompt://?key=i/0, the same mnemonic)", () => {
  // measured with solana-keygen 3.1.14: `solana-keygen pubkey 'prompt://?key=0/0'` and `key=1/0`
  assert.equal(solFromMnemonic(MNEMONIC, 0).address, "oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96");
  assert.equal(solFromMnemonic(MNEMONIC, 1).address, "AqynRZwvVqUPRwRJXvm6odUb3t93fDjnWe3p6BeuUFxD");
});

test("a Solana signer's signature verifies against its address", () => {
  const k = solFromMnemonic(MNEMONIC, 0);
  const msg = new TextEncoder().encode("floor-swarm");
  const sig = k.sign(msg);
  assert.equal(sig.length, 64);
  const pub = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(base58Decode(k.address))]), format: "der", type: "spki" });
  assert.ok(verify(null, msg, pub, sig));
  assert.notEqual(solFromMnemonic(MNEMONIC, 1).address, k.address);
});

test("a Solana secret parses from keygen JSON, base58 and a seed, and a mismatched half is refused", () => {
  const seed = slip10Ed25519(Buffer.alloc(16, 7), [1]);
  const k = solSigner(seed);
  const full = Buffer.concat([seed, Buffer.from(base58Decode(k.address))]);
  assert.deepEqual(parseSolSecret(JSON.stringify([...full])), Uint8Array.from(seed));
  assert.deepEqual(parseSolSecret(base58Encode(full)), Uint8Array.from(seed));
  assert.deepEqual(parseSolSecret(seed.toString("hex")), Uint8Array.from(seed));
  const bad = Buffer.from(full);
  bad[63] ^= 1;
  assert.throws(() => parseSolSecret(JSON.stringify([...bad])), /does not match/);
});

test("a swarm's HD wallets carry both addresses; imported keys are one family's", () => {
  const home = mkdtempSync(join(tmpdir(), "swarm-sol-"));
  const s = new Swarm("t", home);
  s.createVault("correct horse", MNEMONIC);
  const [a, b] = s.derive(2);
  assert.equal(a!.evm, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  assert.equal(a!.sol, solFromMnemonic(MNEMONIC, 0).address);
  assert.equal(b!.sol, solFromMnemonic(MNEMONIC, 1).address);
  const k = solSigner(slip10Ed25519(Buffer.alloc(16, 9), [3]));
  const sw = s.importKey(JSON.stringify([...Buffer.concat([slip10Ed25519(Buffer.alloc(16, 9), [3]), Buffer.from(base58Decode(k.address))])]));
  assert.equal(sw.sol, k.address);
  assert.equal(sw.evm, null);
  assert.equal(s.solSigner(sw)!.address, k.address);
  assert.equal(s.account(sw), null);
  const ew = s.importKey("0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6");
  assert.equal(ew.sol, null);
  assert.equal(s.solSigner(ew), null);
  // the vault re-opens with the Solana key
  const v = Vault.open(s.vaultPath, "correct horse");
  assert.equal(v.solSigner(sw.ref)!.address, k.address);
});

test("a store from before the Solana adapter migrates; unlock fills in the HD wallets' Solana addresses", () => {
  const home = mkdtempSync(join(tmpdir(), "swarm-mig-"));
  const s0 = new Swarm("t", home);
  s0.createVault("correct horse", MNEMONIC);
  // the old table: evm not null, no sol column
  const dir = join(home, "t");
  const db = new DatabaseSync(join(dir, "swarm.db"));
  db.exec("drop table wallets; create table wallets (id integer primary key, source text not null, hd_index integer, key_id integer, evm text not null unique, groups text not null default '[]', created integer not null);");
  db.prepare("insert into wallets (source, hd_index, evm, groups, created) values ('hd', 0, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '[\"swarm\"]', 1)").run();
  db.close();
  const st = new Store(join(dir, "swarm.db"));
  assert.equal(st.wallet(1)!.sol, null);
  assert.deepEqual(st.wallet(1)!.groups, ["swarm"]);
  const s = new Swarm("t", home);
  s.unlock("correct horse");
  assert.equal(s.store.wallet(1)!.sol, solFromMnemonic(MNEMONIC, 0).address);
});

test("the Solana rail: loopback passes, devnet and testnet pass, mainnet-beta never", () => {
  const local = { family: "solana" as const, rpc: "http://127.0.0.1:8899", programId: "x" };
  assert.match(allowSolana(local, "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "surfpool"), /local/);
  const remote = { ...local, rpc: "https://api.devnet.solana.com" };
  assert.equal(allowSolana(remote, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "3.1"), "Solana devnet");
  assert.throws(() => allowSolana({ ...local, rpc: "https://api.mainnet-beta.solana.com" }, "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "3.1"), /mainnet-beta/);
});
