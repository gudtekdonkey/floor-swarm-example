import { test } from "node:test";
import assert from "node:assert/strict";
import { Alerts, scrub, webhookPayload } from "../../src/alerts.ts";
import { Store } from "../../src/store/db.ts";

const KEY64 = "0x" + "ab12".repeat(16);
const SOL = "5Kd3NBUAdUnhyzenEwVLy9pBKxSwXvE9FMPyR4UKZvpe6E3AgLr96K1rFqfRQ8pgcN2fwhrbx7Vsy7CbPMDGk1mF";

test("the webhook gets a payload with no key, passphrase or URL path", async () => {
  const st = new Store(":memory:");
  const posted: { url: string; body: string }[] = [];
  const a = new Alerts(st, { fetch: (async (url: string, init: RequestInit) => (posted.push({ url, body: String(init.body) }), new Response("ok"))) as unknown as typeof fetch });
  a.setWebhook("https://hooks.example/services/SECRET-TOKEN-123");
  await a.raise({ kind: "run", level: "error", title: "buy 10", text: `failed: key ${KEY64} sol ${SOL} rpc https://node.example/v2/APIKEY123?x=1`, run: 7 });
  assert.equal(posted.length, 1);
  assert.equal(posted[0]!.url, "https://hooks.example/services/SECRET-TOKEN-123");
  const body = posted[0]!.body;
  for (const secret of [KEY64, "ab12ab12", SOL.slice(0, 20), "APIKEY123", "SECRET-TOKEN-123"]) assert.ok(!body.includes(secret), secret);
  const p = JSON.parse(body);
  assert.equal(p.alert.run, 7);
  assert.equal(p.text, p.content);
  assert.deepEqual(Object.keys(p.alert).sort(), ["at", "id", "kind", "level", "run", "text", "title"]);
});

test("a failing webhook does not throw, and its URL is never reported", async () => {
  const st = new Store(":memory:");
  const a = new Alerts(st, { fetch: (async () => { throw new Error("connect failed https://hooks.example/TOKEN"); }) as unknown as typeof fetch });
  a.setWebhook("https://hooks.example/TOKEN");
  const seen: string[] = [];
  const b = new Alerts(st, { fetch: a["f"], emit: (x) => seen.push(x.title) });
  await b.raise({ kind: "job", level: "error", title: "t", text: "x" });
  assert.deepEqual(seen, ["t"]);
  assert.ok(!JSON.stringify(b.status()).includes("TOKEN"));
  assert.equal(b.status().host, "hooks.example");
});

test("the webhook is a setting; off clears it; only http(s) is taken", () => {
  const a = new Alerts(new Store(":memory:"));
  assert.equal(a.status().webhook, false);
  assert.throws(() => a.setWebhook("file:///etc/passwd"), /http/);
  assert.throws(() => a.setWebhook("nope"), /not a URL/);
  a.setWebhook("https://discord.example/api/webhooks/1/abc");
  assert.equal(a.status().webhook, true);
  a.setWebhook(null);
  assert.equal(a.status().webhook, false);
});

test("scrub keeps ordinary text", () => {
  assert.equal(scrub("buy 10: done · run 4"), "buy 10: done · run 4");
  assert.equal(webhookPayload({ id: 1, at: 1, kind: "test", level: "ok", title: "a", text: "b" }).text, "a: b");
});
