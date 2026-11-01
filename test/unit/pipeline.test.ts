import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, runSteps, type RunDeps, type StepOutcome } from "../../src/pipeline/run.ts";
import { parseSteps } from "../../src/pipeline/steps.ts";
import { PipelineStore } from "../../src/pipeline/store.ts";
import { Store } from "../../src/store/db.ts";

function fake(outcomes: Record<string, StepOutcome | Error> = {}, statuses: (string | null)[] = []) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  let t = 0;
  const failed: number[] = [];
  const deps: RunDeps = {
    runStep: async (argv) => {
      calls.push(argv.join(" "));
      const o = outcomes[argv[0]!] ?? { ok: true, runId: calls.length };
      if (o instanceof Error) throw o;
      return o;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    runStatus: async () => statuses.shift() ?? "done",
    onStepFailed: (s) => failed.push(s.idx),
    now: () => t,
    pollMs: 1000,
  };
  return { deps, calls, sleeps, failed };
}
const run = (def: unknown, f: ReturnType<typeof fake>, signal = new AbortController().signal) => {
  const steps = parseSteps(def);
  return runSteps(steps, initialState("p", steps), f.deps, signal);
};

test("steps run in order; after is the default gate", async () => {
  const f = fake();
  const s = await run([{ argv: ["a"] }, { argv: ["b"] }, { argv: ["c"], when: "after" }], f);
  assert.deepEqual(f.calls, ["a", "b", "c"]);
  assert.equal(s.status, "done");
  assert.deepEqual(s.steps.map((x) => x.runId), [1, 2, 3]);
});

test("wait sleeps before the step, not after", async () => {
  const f = fake();
  await run([{ argv: ["a"] }, { argv: ["b"], when: { kind: "wait", seconds: 30 } }], f);
  assert.deepEqual(f.sleeps, [30000]);
  assert.deepEqual(f.calls, ["a", "b"]);
});

test("on_fail stop skips the rest and fails the pipeline", async () => {
  const f = fake({ b: { ok: false, error: "boom" } });
  const s = await run([{ argv: ["a"] }, { argv: ["b"] }, { argv: ["c"] }], f);
  assert.deepEqual(f.calls, ["a", "b"]);
  assert.equal(s.status, "failed");
  assert.deepEqual(s.steps.map((x) => x.status), ["done", "failed", "skipped"]);
  assert.equal(s.steps[1]!.error, "boom");
  assert.deepEqual(f.failed, [1]);
});

test("on_fail continue goes on and the pipeline ends partial", async () => {
  const f = fake({ b: new Error("thrown") });
  const s = await run([{ argv: ["a"] }, { argv: ["b"], on_fail: "continue" }, { argv: ["c"] }], f);
  assert.deepEqual(f.calls, ["a", "b", "c"]);
  assert.equal(s.status, "partial");
  assert.equal(s.steps[1]!.error, "thrown");
});

test("a run that reports failed fails its step; partial does not", async () => {
  const f = fake({ a: { ok: true, status: "partial", runId: 5 }, b: { ok: true, status: "failed", runId: 6 } });
  const s = await run([{ argv: ["a"] }, { argv: ["b"] }], f);
  assert.deepEqual(s.steps.map((x) => x.status), ["partial", "failed"]);
  assert.deepEqual(s.steps.map((x) => x.runId), [5, 6]);
});

test("until_run_status polls the previous run until it is done", async () => {
  const f = fake({}, ["running", "running", "done"]);
  const s = await run([{ argv: ["a"] }, { argv: ["b"], when: { kind: "until_run_status", status: "done" } }], f);
  assert.equal(s.status, "done");
  assert.deepEqual(f.sleeps, [1000, 1000]);
});

test("until_run_status fails the step when the run ends otherwise or times out", async () => {
  let s = await run([{ argv: ["a"] }, { argv: ["b"], when: { kind: "until_run_status", status: "done" } }], fake({}, ["partial"]));
  assert.match(s.steps[1]!.error!, /ended partial/);
  assert.equal(s.steps[1]!.status, "failed");
  s = await run([{ argv: ["a"] }, { argv: ["b"], when: { kind: "until_run_status", status: "done", timeoutSeconds: 3 } }], fake({}, Array(10).fill("running")));
  assert.match(s.steps[1]!.error!, /still running after 3s/);
  // no run to watch
  s = await run([{ argv: ["a"], }, { argv: ["b"], when: { kind: "until_run_status", status: "done" } }], fake({ a: { ok: true } }));
  assert.match(s.steps[1]!.error!, /no run to watch/);
});

test("price gates are refused with a TODO message", () => {
  assert.throws(() => parseSteps([{ argv: ["buy"], when: { kind: "price_above", value: 1 } }]), /price gates are not built/);
  assert.throws(() => parseSteps([{ argv: ["buy"], when: "mcap_above 5" }]), /price gates are not built/);
});

test("a stop ends the waits and skips what has not run", async () => {
  const ctl = new AbortController();
  const f = fake();
  f.deps.sleep = async () => ctl.abort();
  const s = await run([{ argv: ["a"] }, { argv: ["b"], when: { kind: "wait", seconds: 60 } }, { argv: ["c"] }], f, ctl.signal);
  assert.deepEqual(f.calls, ["a"]);
  assert.equal(s.status, "stopped");
  assert.deepEqual(s.steps.map((x) => x.status), ["done", "skipped", "skipped"]);
});

test("definitions are checked", () => {
  assert.throws(() => parseSteps([]), /non-empty/);
  assert.throws(() => parseSteps([{ argv: ["daemon"] }]), /cannot run/);
  assert.throws(() => parseSteps([{ argv: ["pipeline", "run", "x"] }]), /cannot run/);
  assert.throws(() => parseSteps([{ argv: ["buy"], on_fail: "maybe" }]), /on_fail/);
  assert.deepEqual(parseSteps({ steps: [{ cmd: 'buy 10 "a b" --instant', when: "wait 5" }] })[0], { argv: ["buy", "10", "a b", "--instant"], when: { kind: "wait", seconds: 5 }, onFail: "stop" });
});

test("pipelines and their step runs are stored, and a run finds its pipeline", () => {
  const st = new Store(":memory:");
  const ps = new PipelineStore(st);
  ps.save("p", [{ argv: ["a"] }, { argv: ["b"] }]);
  assert.equal(ps.list().length, 1);
  const state = initialState("p", ps.get("p")!);
  const id = ps.startRun("p", state);
  state.steps[1]!.runId = 42;
  state.steps[1]!.status = "done";
  state.status = "done";
  ps.update(id, state);
  assert.deepEqual(ps.ofRun(42), { pipelineRun: id, name: "p", step: 1 });
  assert.equal(ps.run(id)!.steps[1]!.runId, 42);
  assert.equal(ps.remove("p"), true);
});
