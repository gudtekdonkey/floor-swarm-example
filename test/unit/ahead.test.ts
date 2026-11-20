import { test } from "node:test";
import assert from "node:assert/strict";
import { batchAhead } from "../../src/commands/trade.ts";

test("an instant batch's ahead shrinks as sends land; a timed batch has none", () => {
  const b = batchAhead(100n, true);
  assert.equal(b.ahead(30n), 70n);
  b.landed(30n);
  assert.equal(b.ahead(50n), 20n);
  b.landed(50n);
  assert.equal(b.ahead(20n), 0n);
  b.landed(20n);
  assert.equal(b.ahead(5n), 0n);
  assert.equal(batchAhead(100n, false).ahead(30n), 0n);
});
