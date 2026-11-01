// `swarm pipeline save|run|list|show|rm`.
import { readFileSync } from "node:fs";
import type { Swarm } from "../swarm.ts";
import { PipelineManager, outcomeOf } from "./manager.ts";
import { PipelineStore } from "./store.ts";
import { gateText } from "./steps.ts";

/** `runner` runs one command line and returns its `--json` envelope text. */
export async function pipelineCommand(
  s: Swarm,
  sub: string | undefined,
  rest: string[],
  log: (l: string) => void,
  runner: (argv: string[], onLine: (l: string) => void) => Promise<string>,
): Promise<unknown> {
  const ps = new PipelineStore(s.store);
  switch (sub) {
    case "save": {
      if (!rest[0] || !rest[1]) throw new Error("swarm pipeline save <name> <file.json>");
      let def: unknown;
      try {
        def = JSON.parse(readFileSync(rest[1], "utf8"));
      } catch (e) {
        throw new Error(`cannot read ${rest[1]}: ${(e as Error).message}`);
      }
      const steps = ps.save(rest[0], def);
      log(`pipeline ${rest[0]}: ${steps.length} steps`);
      return { name: rest[0], steps };
    }
    case "list":
    case undefined: {
      const all = ps.list();
      for (const p of all) {
        log(`${p.name}  ${p.steps.length} steps`);
        p.steps.forEach((st, i) => log(`  ${i + 1}. ${st.argv.join(" ")}  [${gateText(st.when)}; on fail ${st.onFail}]`));
      }
      if (all.length === 0) log("no pipelines");
      return all;
    }
    case "show": {
      const st = ps.get(rest[0] ?? "");
      if (!st) throw new Error(`no pipeline "${rest[0]}"`);
      st.forEach((x, i) => log(`${i + 1}. ${x.argv.join(" ")}  [${gateText(x.when)}; on fail ${x.onFail}]`));
      return st;
    }
    case "rm": {
      if (!rest[0]) throw new Error("swarm pipeline rm <name>");
      const had = ps.remove(rest[0]);
      log(had ? `removed ${rest[0]}` : `no pipeline ${rest[0]}`);
      return { removed: had };
    }
    case "run": {
      if (!rest[0]) throw new Error("swarm pipeline run <name>");
      const m = new PipelineManager({
        store: ps,
        runStatus: async (id) => {
          const r = s.store.run(id);
          return r ? String(r.status) : null;
        },
        runStep: async (argv) => {
          log(`> swarm ${argv.join(" ")}`);
          const env = JSON.parse(await runner(argv, (l) => log("  " + l))) as Parameters<typeof outcomeOf>[0];
          return outcomeOf(env);
        },
        emit: (_id, st) => {
          const n = st.steps.find((x) => x.status === "running" || x.status === "waiting");
          if (n) log(`step ${n.idx + 1}: ${n.status}`);
        },
      });
      const { id, done } = m.start(rest[0]);
      const final = await done;
      log(`pipeline ${rest[0]} ${final.status} (pipeline run ${id})`);
      for (const x of final.steps) log(`  ${x.idx + 1}. ${x.status}${x.runId !== null ? ` · run ${x.runId}` : ""}${x.error ? ` · ${x.error}` : ""}`);
      if (final.status === "failed") throw new Error(`pipeline ${rest[0]} failed`);
      return { pipelineRun: id, ...final };
    }
  }
  throw new Error(`unknown pipeline command "${sub}" (save, run, list, show, rm)`);
}
