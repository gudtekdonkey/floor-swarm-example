import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../../src/daemon/server.ts";
import { JobQueue, type JobRunner } from "../../src/daemon/jobs.ts";
import { Swarm } from "../../src/swarm.ts";

/** A raw request, so the Host header can be set (fetch will not). */
function http(port: number, o: { path: string; method?: string; host?: string; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: o.path, method: o.method ?? "GET", headers: { host: o.host ?? `127.0.0.1:${port}`, ...(o.body ? { "content-type": "application/json" } : {}), ...o.headers } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
    });
    req.on("error", reject);
    if (o.body) req.write(JSON.stringify(o.body));
    req.end();
  });
}

const envelope = (command: string) => JSON.stringify({ ok: true, command, result: null, log: [] });

test("auth: no token is 401, a wrong Host is 403, a token works", async () => {
  const sw = new Swarm("auth", mkdtempSync(join(tmpdir(), "swarm-d-")));
  const d = await startDaemon({ swarm: sw, port: 0, runner: async () => ({ out: envelope("x"), code: 0 }) });
  try {
    assert.equal((await http(d.port, { path: "/api/state" })).status, 401);
    assert.equal((await http(d.port, { path: "/api/state", headers: { authorization: "Bearer wrong" } })).status, 401);
    assert.equal((await http(d.port, { path: "/" })).status, 401);
    // the Host check comes before the token check
    assert.equal((await http(d.port, { path: "/api/state", host: "evil.example", headers: { authorization: `Bearer ${d.token}` } })).status, 403);
    assert.equal((await http(d.port, { path: "/api/state", host: `127.0.0.1:${d.port + 1}` })).status, 403);
    const ok = await http(d.port, { path: "/api/state", headers: { authorization: `Bearer ${d.token}` } });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).vault.exists, false);
    assert.ok(!ok.body.includes(d.token));
    // the printed URL sets a same-origin cookie, which then works without the header
    const open = await http(d.port, { path: `/?t=${d.token}` });
    assert.equal(open.status, 302);
    const cookie = String((open.headers["set-cookie"] as string[])[0]).split(";")[0]!;
    assert.equal((await http(d.port, { path: "/api/commands", headers: { cookie } })).status, 200);
    const page = await http(d.port, { path: "/", headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(page.body, /<html/);
    // a cross-origin write is refused even with the token
    assert.equal((await http(d.port, { path: "/api/lock", method: "POST", headers: { authorization: `Bearer ${d.token}`, origin: "http://evil.example" } })).status, 403);
    // the token file is private
    assert.equal(statSync(join(sw.dir, "daemon.token")).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(sw.dir, "daemon.token"), "utf8").trim(), d.token);
  } finally {
    await d.close();
  }
});

test("a locked vault refuses a command that needs it, and the daemon cannot run itself", async () => {
  const sw = new Swarm("locked", mkdtempSync(join(tmpdir(), "swarm-d-")));
  const d = await startDaemon({ swarm: sw, port: 0, runner: async () => ({ out: envelope("x"), code: 0 }) });
  const h = { authorization: `Bearer ${d.token}` };
  try {
    assert.equal((await http(d.port, { path: "/api/run", method: "POST", headers: h, body: { argv: ["buy", "1", "0x0"] } })).status, 409);
    assert.equal((await http(d.port, { path: "/api/run", method: "POST", headers: h, body: { argv: ["daemon"] } })).status, 400);
    assert.equal((await http(d.port, { path: "/api/run", method: "POST", headers: h, body: { argv: "buy" } })).status, 400);
    assert.equal((await http(d.port, { path: "/api/run", method: "POST", headers: h, body: { argv: ["runs"] } })).status, 202);
  } finally {
    await d.close();
  }
});

test("the job queue runs one job at a time, in order", async () => {
  const order: string[] = [];
  let live = 0, maxLive = 0;
  const runner: JobRunner = async (argv, onLine) => {
    live++;
    maxLive = Math.max(maxLive, live);
    order.push(`start ${argv[0]}`);
    onLine(`line from ${argv[0]}`);
    await new Promise((r) => setTimeout(r, argv[0] === "slow" ? 40 : 1));
    order.push(`end ${argv[0]}`);
    live--;
    return { out: envelope(argv[0]!), code: 0 };
  };
  const events: string[] = [];
  const q = new JobQueue(runner, (e) => events.push(e.type === "log" ? `log ${e.job} ${e.line}` : `${e.type} ${e.job}`));
  const a = q.enqueue(["slow"]), b = q.enqueue(["b"]), c = q.enqueue(["c"]);
  assert.equal(q.cancel(c.id), true);
  const d = q.enqueue(["d"]);
  await q.wait(d.id);
  assert.deepEqual(order, ["start slow", "end slow", "start b", "end b", "start d", "end d"]);
  assert.equal(maxLive, 1);
  assert.equal(a.status, "done");
  assert.equal(c.status, "cancelled");
  assert.equal(b.lines[0], "line from b");
  assert.deepEqual(events.filter((e) => e.startsWith("done")), ["done 3", "done 1", "done 2", "done 4"]);
  assert.ok(events.indexOf("log 1 line from slow") < events.indexOf("done 1"));
});

test("a runner that throws fails its job and the queue goes on", async () => {
  const q = new JobQueue(async (argv) => {
    if (argv[0] === "bad") throw new Error("boom");
    return { out: envelope("ok"), code: 0 };
  });
  const bad = q.enqueue(["bad"]);
  const ok = q.enqueue(["good"]);
  await q.wait(ok.id);
  assert.equal(bad.status, "failed");
  assert.equal(bad.result?.error?.message, "boom");
  assert.equal(ok.status, "done");
});
