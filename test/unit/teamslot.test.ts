// team-slot: argument parsing, add (per-member results), and buy (capped by the Team Share owed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PlanError } from "../../src/plan/plan.ts";
import { parseMembers, parseShares, teamSlotAdd, teamSlotBuy } from "../../src/commands/teamslot.ts";
import type { Knobs } from "../../src/commands/trade.ts";
import { TOKEN_A, launchRef, world } from "./fake-chain.ts";

const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const idAddr = (id: number) => (id >= 1 && id <= 9 ? `0x${id.toString(16).padStart(40, "0")}` : null);
const ADDR = "0x00000000000000000000000000000000000000f1";
const knobs = (o: Partial<Knobs> = {}): Knobs => ({ count: { kind: "most" }, timing: { kind: "instant" }, retries: 1, slippageBps: 300, seed: "s", ...o });
const A = launchRef(TOKEN_A);

test("parseShares: a whole number 1 ..= u64", () => {
  assert.equal(parseShares("5"), 5n);
  assert.equal(parseShares("18446744073709551615"), (1n << 64n) - 1n);
  for (const bad of [undefined, "", "0", "-1", "1.5", "abc", "18446744073709551616"]) assert.throws(() => parseShares(bad), PlanError, String(bad));
});

test("parseMembers: addresses, wallet ids and ranges", () => {
  const m = parseMembers({ member: `${ADDR}, 2, 4-5` }, idAddr, isAddr);
  assert.deepEqual(m.map((x) => x.walletId), [undefined, 2, 4, 5]);
  assert.deepEqual(m[0]!.member, { wallet: ADDR });
  assert.deepEqual(m[1]!.member, { wallet: idAddr(2) });
});

test("parseMembers: handles are platform:handle", () => {
  const m = parseMembers({ handle: "x:alice,github:bob" }, idAddr, isAddr);
  assert.deepEqual(m.map((x) => x.member), [{ platform: "x", handle: "alice" }, { platform: "github", handle: "bob" }]);
});

test("parseMembers: refusals", () => {
  assert.throws(() => parseMembers({}, idAddr, isAddr), /exactly one/);
  assert.throws(() => parseMembers({ member: "2", handle: "x:a" }, idAddr, isAddr), /exactly one/);
  assert.throws(() => parseMembers({ member: "99" }, idAddr, isAddr), /no such wallet/);
  assert.throws(() => parseMembers({ member: "zzz" }, idAddr, isAddr), /neither a wallet id nor an address/);
  assert.throws(() => parseMembers({ member: "5-3" }, idAddr, isAddr), /bad id range/);
  assert.throws(() => parseMembers({ handle: "alice" }, idAddr, isAddr), /platform:handle/);
  assert.throws(() => parseMembers({ handle: "x:" }, idAddr, isAddr), /platform:handle/);
  assert.throws(() => parseMembers({ member: "2,2" }, idAddr, isAddr), /twice/);
  assert.throws(() => parseMembers({ member: ADDR + "," + ADDR.toUpperCase().replace("0X", "0x") }, idAddr, isAddr), /twice/);
});

test("team-slot add: one tx per member from the creator, a failed member is reported and the rest go on", async () => {
  const { s, c, wallets } = world(4);
  const specs = [
    { member: { wallet: wallets[1]!.evm! }, walletId: 2, label: "wallet 2" },
    { member: { platform: "x", handle: "boom" }, label: "handle x:boom" },
    { member: { wallet: wallets[2]!.evm! }, walletId: 3, label: "wallet 3" },
  ];
  const r = await teamSlotAdd(s, A, wallets[0]!, specs, 7n, false, () => {});
  assert.deepEqual(r.members.map((m) => m.ok), [true, false, true]);
  assert.match(r.members[1]!.error!, /TeamSlotFull/);
  assert.deepEqual(c.slotAdds.map((x) => [x.id, x.shares]), [[1, 7n], [1, 7n]]);
  assert.equal((s.store.run(r.runId!) as { status: string }).status, "partial");
  assert.deepEqual(s.store.knownTargets(), [`fake:${TOKEN_A}`], "member wallets are noted for claim --all-launches");
});

test("team-slot add --dry-run sends nothing", async () => {
  const { s, c, wallets } = world(2);
  const r = await teamSlotAdd(s, A, wallets[0]!, [{ member: { wallet: ADDR }, label: ADDR }], 1n, true, () => {});
  assert.equal(r.runId, null);
  assert.equal(c.slotAdds.length, 0);
  assert.ok(r.members[0]!.ok);
});

test("team-slot buy: only members owed a share buy, each at most what it is owed", async () => {
  const { s, c, wallets } = world(4);
  c.teamOwed.set(1, 30n);
  c.teamOwed.set(2, 10n);
  const r = await teamSlotBuy(s, A, wallets, 25n, knobs(), () => {});
  const shares = c.calls.filter((x) => x.startsWith("teamShareBuy:")).map((x) => x.split(":"));
  assert.deepEqual(shares.map((x) => x[1]).sort(), ["1", "2"], "wallets 3 and 4 hold no place");
  for (const [, id, amt] of shares) assert.ok(BigInt(amt!) <= (id === "1" ? 30n : 10n));
  assert.equal(r.report!.status, "done");
  assert.equal(s.store.position(1, `fake:${TOKEN_A}`).tokens > 0n, true, "the fill is recorded");
});

test("team-slot buy: nobody owed a share is refused by name", async () => {
  const { s, wallets } = world(2);
  await assert.rejects(teamSlotBuy(s, A, wallets, 100n, knobs(), () => {}), /owed a Team Share/);
});
