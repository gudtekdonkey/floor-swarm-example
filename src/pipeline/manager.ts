// Starts pipelines in the background, keeps their state, stops them, and raises an alert when a step fails.
import type { Alerts } from "../alerts.ts";
import type { PipelineStore } from "./store.ts";
import { initialState, runSteps, type PipelineState, type RunDeps, type StepOutcome } from "./run.ts";

export interface ManagerDeps {
  store: PipelineStore;
  alerts?: Alerts;
  runStep: RunDeps["runStep"];
  runStatus: RunDeps["runStatus"];
  sleep?: RunDeps["sleep"];
  pollMs?: number;
  /** Progress, for the UI. */
  emit?: (id: number, s: PipelineState) => void;
}

export const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

interface Active {
  ctl: AbortController;
  state: PipelineState;
  done: Promise<PipelineState>;
}

export class PipelineManager {
  private readonly d: ManagerDeps;
  private readonly active = new Map<number, Active>();

  constructor(d: ManagerDeps) {
    this.d = d;
  }

  /** Starts `name` in the background. `done` resolves with the final state. */
  start(name: string): { id: number; done: Promise<PipelineState> } {
    const steps = this.d.store.get(name);
    if (!steps) throw new Error(`no pipeline "${name}" (swarm pipeline list)`);
    for (const a of this.active.values()) if (a.state.name === name && a.state.status === "running") throw new Error(`pipeline ${name} is already running`);
    const state = initialState(name, steps);
    const id = this.d.store.startRun(name, state);
    const ctl = new AbortController();
    const change = (s: PipelineState): void => {
      this.d.store.update(id, s);
      this.d.emit?.(id, s);
    };
    const done = runSteps(
      steps,
      state,
      {
        runStep: this.d.runStep,
        runStatus: this.d.runStatus,
        sleep: this.d.sleep ?? realSleep,
        pollMs: this.d.pollMs,
        onChange: change,
        onStepFailed: (st) => {
          void this.d.alerts?.raise({ kind: "pipeline_step", level: "error", title: `pipeline ${name}`, text: `step ${st.idx + 1} (${st.argv.slice(0, 2).join(" ")}) failed: ${st.error ?? ""}`, pipeline: name, ...(st.runId !== null ? { run: st.runId } : {}) });
        },
      },
      ctl.signal,
    ).then((s) => {
      void this.d.alerts?.raise({ kind: "pipeline", level: s.status === "done" ? "ok" : s.status === "stopped" ? "warn" : s.status === "partial" ? "warn" : "error", title: `pipeline ${name}`, text: s.status, pipeline: name });
      return s;
    });
    this.active.set(id, { ctl, state, done });
    void done.finally(() => this.active.delete(id));
    return { id, done };
  }

  /** Asks a running pipeline to stop: waits end at once, the step in flight finishes, the rest is skipped. */
  stop(id: number): boolean {
    const a = this.active.get(id);
    if (!a) return false;
    a.ctl.abort();
    return true;
  }

  running(): { id: number; name: string }[] {
    return [...this.active].map(([id, a]) => ({ id, name: a.state.name }));
  }
}

/** A step's outcome from a `--json` envelope. */
export function outcomeOf(env: { ok: boolean; result?: unknown; error?: { message?: string } }): StepOutcome {
  if (!env.ok) return { ok: false, error: env.error?.message ?? "failed" };
  const r = env.result as { runId?: unknown; report?: { status?: unknown } | null } | null;
  return {
    ok: true,
    ...(typeof r?.report?.status === "string" ? { status: r.report.status } : {}),
    runId: typeof r?.runId === "number" ? r.runId : null,
  };
}
