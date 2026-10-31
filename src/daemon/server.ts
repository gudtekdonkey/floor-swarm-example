// The daemon: a local HTTP JSON API and Server-Sent Events over one shared Swarm. It listens on 127.0.0.1 only, checks the
// Host header, and wants a random bearer token (written to the swarm dir, mode 0600) or the cookie set by opening
// http://127.0.0.1:<port>/?t=<token>. No key, passphrase or token is logged or sent to the browser.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Alerts, scrub, type Alert } from "../alerts.ts";
import { COMMANDS, runJson } from "../cli.ts";
import { PipelineManager, outcomeOf } from "../pipeline/manager.ts";
import { PipelineStore } from "../pipeline/store.ts";
import { getPreset, listPresets, removePreset, savePreset } from "../presets.ts";
import type { Swarm } from "../swarm.ts";
import { JobQueue, type Job, type JobEvent, type JobRunner } from "./jobs.ts";

export const DEFAULT_PORT = 7717;
const UI = join(dirname(fileURLToPath(import.meta.url)), "ui", "index.html");
const MAX_BODY = 1_000_000;
/** Commands the daemon will not run for the browser. */
const BLOCKED = new Set(["daemon"]);
/** Commands that take --dry-run: what /api/preview accepts. */
const PREVIEWABLE = new Set(["buy", "sell", "fund", "launch"]);

export interface DaemonOptions {
  swarm: Swarm;
  port?: number;
  runner?: JobRunner;
  fetch?: typeof fetch;
  log?: (s: string) => void;
  token?: string;
}

export interface Daemon {
  server: Server;
  token: string;
  port: number;
  url: string;
  queue: JobQueue;
  alerts: Alerts;
  pipelines: PipelineManager;
  close(): Promise<void>;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const bigSafe = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? v.toString() : v);

function cookieOf(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  if (n === 0) return {};
  try {
    const b = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (typeof b !== "object" || b === null || Array.isArray(b)) throw new Error();
    return b as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "the body must be a JSON object");
  }
}

function argvOf(b: Record<string, unknown>): string[] {
  const a = b.argv;
  if (!Array.isArray(a) || a.length === 0 || a.length > 200 || a.some((x) => typeof x !== "string" || x.length > 4096)) throw new HttpError(400, "argv must be a list of strings");
  if (BLOCKED.has(a[0] as string)) throw new HttpError(400, `"${a[0]}" cannot be run from here`);
  return a as string[];
}

/** The COMMANDS row an argv names (longest match on its first two words). */
function commandOf(argv: string[]): (typeof COMMANDS)[number] | undefined {
  const [a, b] = argv;
  return COMMANDS.find((c) => c.cmd === `${a} ${b}`) ?? COMMANDS.find((c) => c.cmd === a);
}

/** What the run reports about itself, for an alert: done / partial / failed. */
function runStatusOf(env: Job["result"]): { status: string; runId: number | null } | null {
  const r = env?.result as { runId?: unknown; report?: { status?: unknown } | null } | null | undefined;
  if (env?.ok && r && typeof r.report?.status === "string") return { status: r.report.status, runId: typeof r.runId === "number" ? r.runId : null };
  return null;
}

export async function startDaemon(o: DaemonOptions): Promise<Daemon> {
  const { swarm } = o;
  const log = o.log ?? (() => {});
  const token = o.token ?? randomBytes(24).toString("hex");
  const tokenPath = join(swarm.dir, "daemon.token");
  writeFileSync(tokenPath, token + "\n", { mode: 0o600 });
  chmodSync(tokenPath, 0o600);

  const clients = new Set<ServerResponse>();
  const publish = (e: object): void => {
    const data = `data: ${JSON.stringify(e, bigSafe)}\n\n`;
    for (const c of clients) c.write(data);
  };

  const alerts = new Alerts(swarm.store, { fetch: o.fetch, emit: (a) => publish({ type: "alert", alert: a }) });
  const runner: JobRunner = o.runner ?? ((argv, onLine) => runJson(argv, { swarm }, onLine));
  const queue = new JobQueue(runner, publish, (j) => {
    if (j.quiet || j.status === "cancelled") return;
    const label = j.argv.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ");
    const st = runStatusOf(j.result);
    if (st) {
      void alerts.raise({ kind: "run", level: st.status === "done" ? "ok" : st.status === "partial" ? "warn" : "error", title: label, text: `${st.status}${st.runId !== null ? ` · run ${st.runId}` : ""}`, job: j.id, ...(st.runId !== null ? { run: st.runId } : {}) });
    } else if (j.status === "failed") {
      void alerts.raise({ kind: "job", level: "error", title: label, text: j.result?.error?.message ?? "failed", job: j.id });
    }
  });
  const ps = new PipelineStore(swarm.store);
  ps.failStale();
  const pipelines = new PipelineManager({
    store: ps,
    alerts,
    runStatus: async (id) => {
      const r = swarm.store.run(id);
      return r ? String(r.status) : null;
    },
    runStep: async (argv, signal) => {
      const job = queue.enqueue(argv, { quiet: true });
      const onAbort = (): void => void queue.cancel(job.id);
      signal.addEventListener("abort", onAbort);
      try {
        const j = await queue.wait(job.id);
        if (j.status === "cancelled") return { ok: false, error: "stopped before it started" };
        return outcomeOf(j.result ?? { ok: false });
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
    emit: (id, state) => publish({ type: "pipeline", id, state }),
  });

  const requireUnlocked = (): void => {
    if (!swarm.unlocked) throw new HttpError(409, "the vault is locked");
  };
  let previewChain: Promise<unknown> = Promise.resolve();
  const needUnlocked = (argv: string[]): void => {
    const c = commandOf(argv);
    if (c?.unlocks && c.cmd !== "init" && !swarm.unlocked) throw new HttpError(409, "the vault is locked");
  };

  // ---- balances, cached briefly ----
  const balCache = new Map<string, { at: number; body: unknown }>();
  async function walletsBody(q: URLSearchParams): Promise<unknown> {
    const chainName = q.get("chain") || undefined;
    const group = q.get("group") || undefined;
    const token = q.get("token") || undefined;
    const ws = swarm.store.wallets({ group });
    if (!chainName) return { wallets: ws.map((w) => ({ id: w.id, evm: w.evm, sol: w.sol, address: w.evm ?? w.sol, groups: w.groups })) };
    const key = `${chainName}|${token ?? ""}|${group ?? ""}`;
    const hit = balCache.get(key);
    if (hit && Date.now() - hit.at < 4000 && q.get("fresh") !== "1") return hit.body;
    const c = await swarm.chain(chainName);
    const tok = token ? await c.quoteInfo(token) : null;
    const rows = ws.filter((w) => c.addressOf(w) !== null);
    const out: unknown[] = new Array(rows.length);
    let i = 0;
    await Promise.all(
      [...Array(Math.min(8, rows.length)).keys()].map(async () => {
        while (i < rows.length) {
          const k = i++;
          const w = rows[k]!;
          const address = c.addressOf(w)!;
          try {
            const native = await c.balanceOf(c.native, address);
            const tokenBalance = tok ? await c.balanceOf(tok.address, address) : null;
            out[k] = { id: w.id, address, groups: w.groups, native: native.toString(), ...(tokenBalance !== null ? { tokenBalance: tokenBalance.toString() } : {}) };
          } catch (e) {
            out[k] = { id: w.id, address, groups: w.groups, error: scrub((e as Error).message) };
          }
        }
      }),
    );
    const body = { chain: { name: chainName, family: c.family, nativeSymbol: c.nativeSymbol, nativeDecimals: c.nativeDecimals }, token: tok, wallets: out };
    balCache.set(key, { at: Date.now(), body });
    return body;
  }

  function stateBody(): unknown {
    const chains: Record<string, unknown> = {};
    for (const [n, c] of Object.entries(swarm.chains())) {
      let host = "";
      try {
        host = new URL(c.rpc).host;
      } catch {
        /* keep empty */
      }
      chains[n] = { family: c.family, rpcHost: host, ...(c.family === "evm" ? { chainId: c.chainId } : {}) };
    }
    const groups: Record<string, number> = {};
    const all = swarm.store.wallets();
    for (const w of all) for (const g of w.groups) groups[g] = (groups[g] ?? 0) + 1;
    return {
      name: swarm.name,
      vault: { exists: swarm.hasVault(), unlocked: swarm.unlocked },
      chains,
      groups,
      wallets: all.length,
      queue: queue.counts(),
      pipelinesRunning: pipelines.running(),
      alerts: alerts.status(),
    };
  }

  const jobBody = (j: Job): unknown => ({ id: j.id, argv: j.argv, status: j.status, queuedAt: j.queuedAt, startedAt: j.startedAt, finishedAt: j.finishedAt, code: j.code, result: j.result, lines: j.lines });

  function runBody(id: number): unknown {
    const r = swarm.store.run(id);
    if (!r) return null;
    const parse = (x: unknown): unknown => {
      try {
        return typeof x === "string" ? JSON.parse(x) : x;
      } catch {
        return x;
      }
    };
    return { ...r, spec: parse(r.spec), report: parse(r.report), pipeline: ps.ofRun(id) };
  }

  // ---- routes ----
  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const m = req.method ?? "GET";
    const p = url.pathname;
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body, bigSafe));
    };

    if (m === "GET" && p === "/") {
      const page = readFileSync(UI);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
      });
      res.end(page);
      return;
    }
    if (!p.startsWith("/api/")) throw new HttpError(404, "not found");

    if (m === "GET" && p === "/api/state") return send(200, stateBody());
    if (m === "GET" && p === "/api/commands") return send(200, COMMANDS.filter((c) => !BLOCKED.has(c.cmd)));
    if (m === "GET" && p === "/api/wallets") {
      try {
        return send(200, await walletsBody(url.searchParams));
      } catch (e) {
        throw new HttpError(502, scrub((e as Error).message));
      }
    }
    if (m === "GET" && p === "/api/target") {
      const t = url.searchParams.get("t") ?? "";
      const r = await runJson(["target", t], { swarm });
      const env = JSON.parse(r.out) as { ok: boolean; result?: unknown; error?: { message: string } };
      return send(env.ok ? 200 : 404, env.ok ? env.result : { error: scrub(env.error?.message ?? "not found") });
    }
    if (m === "GET" && p === "/api/runs") return send(200, swarm.store.runs(Math.min(200, Number(url.searchParams.get("limit")) || 50)));
    const run = /^\/api\/runs\/(\d+)$/.exec(p);
    if (m === "GET" && run) {
      const b = runBody(Number(run[1]));
      return b ? send(200, b) : send(404, { error: "no such run" });
    }
    if (m === "GET" && p === "/api/jobs") return send(200, queue.list().map(jobBody));
    const job = /^\/api\/jobs\/(\d+)(\/cancel)?$/.exec(p);
    if (job) {
      const j = queue.get(Number(job[1]));
      if (!j) return send(404, { error: "no such job" });
      if (m === "GET" && !job[2]) return send(200, jobBody(j));
      if (m === "POST" && job[2]) return send(200, { cancelled: queue.cancel(j.id) });
    }
    if (m === "GET" && p === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`data: ${JSON.stringify({ type: "hello", jobs: queue.list().slice(0, 20).map(jobBody), alerts: alerts.recent.slice(-10) }, bigSafe)}\n\n`);
      clients.add(res);
      const ka = setInterval(() => res.write(": keep-alive\n\n"), 15000);
      req.on("close", () => {
        clearInterval(ka);
        clients.delete(res);
      });
      return;
    }

    if (m === "GET" && p === "/api/presets") return send(200, listPresets(swarm.store));
    if (m === "GET" && p === "/api/pipelines") return send(200, ps.list());
    if (m === "GET" && p === "/api/pipeline-runs") return send(200, ps.runs(Math.min(200, Number(url.searchParams.get("limit")) || 30)));
    const prun = /^\/api\/pipeline-runs\/(\d+)$/.exec(p);
    if (m === "GET" && prun) {
      const r = ps.run(Number(prun[1]));
      return r ? send(200, r) : send(404, { error: "no such pipeline run" });
    }
    if (m === "GET" && p === "/api/alerts") return send(200, { ...alerts.status(), recent: alerts.recent });

    // ---- writes ----
    if (m === "POST" || m === "DELETE") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) throw new HttpError(403, "cross-origin request");
    }
    if (m === "POST" && p === "/api/unlock") {
      const b = await bodyOf(req);
      if (typeof b.passphrase !== "string" || !b.passphrase) throw new HttpError(400, "passphrase required");
      if (!swarm.hasVault()) throw new HttpError(409, "no vault yet (swarm init)");
      try {
        swarm.unlock(b.passphrase);
      } catch {
        await new Promise((r) => setTimeout(r, 400));
        throw new HttpError(403, "wrong passphrase");
      }
      return send(200, stateBody());
    }
    if (m === "POST" && p === "/api/lock") {
      swarm.lock();
      return send(200, stateBody());
    }
    if (m === "POST" && p === "/api/run") {
      const argv = argvOf(await bodyOf(req));
      if (argv[0] === "pipeline" && argv[1] === "run") {
        if (!argv[2]) throw new HttpError(400, "pipeline run <name>");
        requireUnlocked();
        try {
          const { id } = pipelines.start(argv[2]);
          return send(202, { pipelineRun: id });
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
      needUnlocked(argv);
      const j = queue.enqueue(argv);
      return send(202, { job: j.id, queued: queue.counts().queued });
    }
    if (m === "POST" && p === "/api/preview") {
      let argv = argvOf(await bodyOf(req));
      if (!PREVIEWABLE.has(argv[0]!)) throw new HttpError(400, `no preview for "${argv[0]}"`);
      if (!argv.includes("--dry-run")) argv = [...argv, "--dry-run"];
      needUnlocked(argv);
      const prev = previewChain.then(() => runJson(argv, { swarm }));
      previewChain = prev.catch(() => {});
      const r = await prev;
      return send(200, JSON.parse(r.out));
    }
    if (m === "POST" && p === "/api/presets") {
      const b = await bodyOf(req);
      if (typeof b.name !== "string" || !Array.isArray(b.flags) || b.flags.some((x) => typeof x !== "string")) throw new HttpError(400, "name and flags required");
      const flags = [...(b.flags as string[]), ...(typeof b.amount === "string" && b.amount ? ["--amount", b.amount] : [])];
      try {
        return send(200, savePreset(swarm.store, b.name, flags));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    const pdel = /^\/api\/presets\/([^/]+)$/.exec(p);
    if (m === "DELETE" && pdel) return send(200, { removed: removePreset(swarm.store, decodeURIComponent(pdel[1]!)) });
    if (m === "GET" && pdel) {
      const pr = getPreset(swarm.store, decodeURIComponent(pdel[1]!));
      return pr ? send(200, pr) : send(404, { error: "no such preset" });
    }
    if (m === "POST" && p === "/api/pipelines") {
      const b = await bodyOf(req);
      if (typeof b.name !== "string") throw new HttpError(400, "name required");
      try {
        return send(200, { name: b.name, steps: ps.save(b.name, b.steps) });
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    const pdl = /^\/api\/pipelines\/([^/]+)(\/run)?$/.exec(p);
    if (pdl) {
      const name = decodeURIComponent(pdl[1]!);
      if (m === "DELETE" && !pdl[2]) return send(200, { removed: ps.remove(name) });
      if (m === "POST" && pdl[2]) {
        requireUnlocked();
        try {
          return send(202, { pipelineRun: pipelines.start(name).id });
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
    }
    const pstop = /^\/api\/pipeline-runs\/(\d+)\/stop$/.exec(p);
    if (m === "POST" && pstop) return send(200, { stopping: pipelines.stop(Number(pstop[1])) });
    if (m === "POST" && p === "/api/alerts/webhook") {
      const b = await bodyOf(req);
      try {
        alerts.setWebhook(b.off === true ? null : String(b.url ?? ""));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      return send(200, alerts.status());
    }
    if (m === "POST" && p === "/api/alerts/test") {
      await alerts.raise({ kind: "test", level: "ok", title: "floor-swarm", text: "test alert" });
      return send(200, alerts.status());
    }
    throw new HttpError(404, "not found");
  }

  const hosts = new Set<string>();
  const server = createServer((req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    void (async () => {
      try {
        if (!hosts.has((req.headers.host ?? "").toLowerCase())) throw new HttpError(403, "bad host");
        const url = new URL(req.url ?? "/", "http://local");
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
        const cookie = cookieOf(req, "swarm_session");
        const authed = (bearer !== undefined && sameToken(bearer, token)) || (cookie !== undefined && sameToken(cookie, token));
        if (!authed && req.method === "GET" && url.pathname === "/") {
          const t = url.searchParams.get("t");
          if (t && sameToken(t, token)) {
            res.writeHead(302, { location: "/", "set-cookie": `swarm_session=${token}; HttpOnly; SameSite=Strict; Path=/`, "cache-control": "no-store" });
            res.end();
            return;
          }
        }
        if (!authed) throw new HttpError(401, "token required");
        await route(req, res, url);
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        if (!res.headersSent) {
          res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: e instanceof HttpError ? e.message : scrub((e as Error).message) }));
        } else res.end();
        if (status === 500) log(`error: ${scrub((e as Error).message)}`);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port ?? DEFAULT_PORT, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  hosts.add(`127.0.0.1:${port}`).add(`localhost:${port}`);

  return {
    server,
    token,
    port,
    url: `http://127.0.0.1:${port}/?t=${token}`,
    queue,
    alerts,
    pipelines,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of clients) c.end();
        clients.clear();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
