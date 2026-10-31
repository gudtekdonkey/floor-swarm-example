// A pipeline is a named, ordered list of steps. A step is a swarm command (argv) and an optional gate.
export type When =
  | { kind: "after" }
  | { kind: "wait"; seconds: number }
  | { kind: "until_run_status"; status: "done" | "partial" | "failed"; run?: number; timeoutSeconds?: number }
  | { kind: "price_above" | "price_below" | "mcap_above"; value: number };

export interface Step {
  argv: string[];
  when: When;
  onFail: "stop" | "continue";
}

const PRICE_TODO = "price gates are not built yet: the chain adapters have no price read (TODO: add one to the Chain interface)";
/** Commands a step may not run: the daemon itself and pipelines (no recursion). */
const FORBIDDEN = new Set(["daemon", "pipeline"]);

/** A command given as one string, split on spaces; double or single quotes keep a word together. */
export function splitCommand(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

function parseWhen(w: unknown): When {
  if (w === undefined || w === null) return { kind: "after" };
  if (typeof w === "string") {
    const [k, a] = w.trim().split(/\s+/);
    return parseWhen(k === "wait" ? { kind: "wait", seconds: Number(a) } : k === "until_run_status" ? { kind: "until_run_status", status: a } : k === "after" ? { kind: "after" } : { kind: k, value: Number(a) });
  }
  const o = w as Record<string, unknown>;
  switch (o.kind) {
    case "after":
      return { kind: "after" };
    case "wait": {
      const seconds = Number(o.seconds);
      if (!(seconds >= 0 && seconds <= 86400)) throw new Error("wait takes seconds between 0 and 86400");
      return { kind: "wait", seconds };
    }
    case "until_run_status": {
      if (o.status !== "done" && o.status !== "partial" && o.status !== "failed") throw new Error("until_run_status takes done, partial or failed");
      const run = o.run === undefined ? undefined : Number(o.run);
      if (run !== undefined && !Number.isInteger(run)) throw new Error("until_run_status run must be a run id");
      const t = o.timeoutSeconds === undefined ? undefined : Number(o.timeoutSeconds);
      return { kind: "until_run_status", status: o.status, ...(run !== undefined ? { run } : {}), ...(t !== undefined ? { timeoutSeconds: t } : {}) };
    }
    case "price_above":
    case "price_below":
    case "mcap_above":
      throw new Error(PRICE_TODO);
  }
  throw new Error(`unknown gate "${String(o.kind)}" (after, wait, until_run_status)`);
}

/** Checks and normalises a pipeline definition: `{steps:[…]}` or the array itself. */
export function parseSteps(def: unknown): Step[] {
  const arr = Array.isArray(def) ? def : (def as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("a pipeline needs a non-empty list of steps");
  if (arr.length > 100) throw new Error("a pipeline has at most 100 steps");
  return arr.map((raw, i) => {
    try {
      const o = raw as Record<string, unknown>;
      const argv = typeof o.argv === "string" ? splitCommand(o.argv) : typeof o.cmd === "string" ? splitCommand(o.cmd) : (o.argv as unknown);
      if (!Array.isArray(argv) || argv.length === 0 || argv.some((x) => typeof x !== "string")) throw new Error("argv must be a list of strings");
      if (FORBIDDEN.has(argv[0] as string)) throw new Error(`a step cannot run "${argv[0]}"`);
      const onFail = o.on_fail ?? o.onFail ?? "stop";
      if (onFail !== "stop" && onFail !== "continue") throw new Error("on_fail is stop or continue");
      return { argv: argv as string[], when: parseWhen(o.when), onFail };
    } catch (e) {
      throw new Error(`step ${i + 1}: ${(e as Error).message}`);
    }
  });
}

export const gateText = (w: When): string =>
  w.kind === "wait" ? `wait ${w.seconds}s` : w.kind === "until_run_status" ? `until run ${w.run ?? "(previous)"} is ${w.status}` : w.kind === "after" ? "after previous" : `${w.kind} ${w.value}`;

export { PRICE_TODO };
