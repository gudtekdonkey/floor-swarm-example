// Runs a pipeline's steps one after another. The command runner, the clock and the run lookup are injected, so the
// gating (after / wait / until_run_status / on_fail) is testable with a fake runner.
import { PRICE_TODO, type Step, type When } from "./steps.ts";

export type StepStatus = "pending" | "waiting" | "running" | "done" | "partial" | "failed" | "skipped";
export type PipelineStatus = "running" | "done" | "partial" | "failed" | "stopped";

export interface StepState {
  idx: number;
  argv: string[];
  status: StepStatus;
  runId: number | null;
  error: string | null;
}

export interface PipelineState {
  name: string;
  status: PipelineStatus;
  steps: StepState[];
}

/** What a step's command came to. `status` is the run's own (done / partial / failed) when it has one. */
export interface StepOutcome {
  ok: boolean;
  status?: string;
  runId?: number | null;
  error?: string;
}

export interface RunDeps {
  runStep(argv: string[], signal: AbortSignal): Promise<StepOutcome>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** A run's status from the ledger (null: no such run). */
  runStatus(id: number): Promise<string | null>;
  onChange?(s: PipelineState): void;
  /** A step failed (after the gate or the command). */
  onStepFailed?(s: StepState, state: PipelineState): void;
  pollMs?: number;
  now?: () => number;
}

export function initialState(name: string, steps: Step[]): PipelineState {
  return { name, status: "running", steps: steps.map((s, idx) => ({ idx, argv: s.argv, status: "pending", runId: null, error: null })) };
}

async function gate(w: When, prevRun: number | null, d: RunDeps, signal: AbortSignal): Promise<void> {
  switch (w.kind) {
    case "after":
      return;
    case "wait":
      await d.sleep(w.seconds * 1000, signal);
      return;
    case "until_run_status": {
      const id = w.run ?? prevRun;
      if (id === null || id === undefined) throw new Error("until_run_status: there is no run to watch (name one with run, or follow a step that makes a run)");
      const now = d.now ?? Date.now;
      const deadline = now() + (w.timeoutSeconds ?? 600) * 1000;
      for (;;) {
        if (signal.aborted) return;
        const st = await d.runStatus(id);
        if (st === null) throw new Error(`run ${id} does not exist`);
        if (st === w.status) return;
        if (st !== "running") throw new Error(`run ${id} ended ${st}, not ${w.status}`);
        if (now() >= deadline) throw new Error(`run ${id} was still running after ${w.timeoutSeconds ?? 600}s`);
        await d.sleep(d.pollMs ?? 2000, signal);
      }
    }
    default:
      throw new Error(PRICE_TODO);
  }
}

/** Runs the steps. Mutates and returns `state`; the final status is done, partial (a step failed and `continue` went on), failed or stopped. */
export async function runSteps(steps: Step[], state: PipelineState, d: RunDeps, signal: AbortSignal): Promise<PipelineState> {
  const change = (): void => d.onChange?.(state);
  const skipRest = (from: number): void => {
    for (let j = from; j < steps.length; j++) if (state.steps[j]!.status === "pending") state.steps[j]!.status = "skipped";
  };
  let prevRun: number | null = null;
  let failures = 0;
  for (let i = 0; i < steps.length; i++) {
    const st = state.steps[i]!;
    const step = steps[i]!;
    if (signal.aborted) {
      skipRest(i);
      state.status = "stopped";
      return (change(), state);
    }
    const fail = (error: string): void => {
      st.status = "failed";
      st.error = error;
      failures++;
      change();
      d.onStepFailed?.(st, state);
    };
    st.status = "waiting";
    change();
    try {
      await gate(step.when, prevRun, d, signal);
    } catch (e) {
      fail((e as Error).message);
      if (step.onFail === "stop") {
        skipRest(i + 1);
        state.status = "failed";
        return (change(), state);
      }
      continue;
    }
    if (signal.aborted) {
      st.status = "skipped";
      skipRest(i + 1);
      state.status = "stopped";
      return (change(), state);
    }
    st.status = "running";
    change();
    let out: StepOutcome;
    try {
      out = await d.runStep(step.argv, signal);
    } catch (e) {
      out = { ok: false, error: (e as Error).message };
    }
    st.runId = out.runId ?? null;
    if (st.runId !== null) prevRun = st.runId;
    if (!out.ok || out.status === "failed") {
      fail(out.error ?? `the command ${out.status ?? "failed"}`);
      if (step.onFail === "stop") {
        skipRest(i + 1);
        state.status = "failed";
        return (change(), state);
      }
      continue;
    }
    st.status = out.status === "partial" ? "partial" : "done";
    change();
  }
  state.status = failures > 0 ? "partial" : "done";
  return (change(), state);
}
