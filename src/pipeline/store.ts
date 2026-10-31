// Pipelines and their runs in the swarm's SQLite file. A step records the id of the run it made, so history links them.
import type { Store } from "../store/db.ts";
import { parseSteps, type Step } from "./steps.ts";
import type { PipelineState } from "./run.ts";

const SCHEMA = `
create table if not exists pipelines (name text primary key, steps text not null, updated integer not null);
create table if not exists pipeline_runs (id integer primary key, name text not null, status text not null, started integer not null, finished integer);
create table if not exists pipeline_steps (prun_id integer not null, idx integer not null, argv text not null, status text not null, run_id integer, error text, primary key (prun_id, idx));
create index if not exists pipeline_steps_run on pipeline_steps (run_id);
`;

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;

export interface PipelineRunRow {
  id: number;
  name: string;
  status: string;
  started: number;
  finished: number | null;
  steps: { idx: number; argv: string[]; status: string; runId: number | null; error: string | null }[];
}

export class PipelineStore {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
    store.db.exec(SCHEMA);
  }

  save(name: string, def: unknown): Step[] {
    if (!NAME.test(name)) throw new Error(`bad pipeline name "${name}" (letters, digits, - and _, up to 48)`);
    const steps = parseSteps(def);
    this.store.db
      .prepare("insert into pipelines (name, steps, updated) values (?, ?, ?) on conflict(name) do update set steps = excluded.steps, updated = excluded.updated")
      .run(name, JSON.stringify(steps), Date.now());
    return steps;
  }

  get(name: string): Step[] | undefined {
    const r = this.store.db.prepare("select steps from pipelines where name = ?").get(name) as { steps: string } | undefined;
    return r ? (JSON.parse(r.steps) as Step[]) : undefined;
  }

  list(): { name: string; steps: Step[]; updated: number }[] {
    return (this.store.db.prepare("select name, steps, updated from pipelines order by name").all() as { name: string; steps: string; updated: number }[]).map((r) => ({
      name: r.name,
      steps: JSON.parse(r.steps) as Step[],
      updated: r.updated,
    }));
  }

  remove(name: string): boolean {
    return Number(this.store.db.prepare("delete from pipelines where name = ?").run(name).changes) > 0;
  }

  startRun(name: string, state: PipelineState): number {
    const id = Number(this.store.db.prepare("insert into pipeline_runs (name, status, started) values (?, 'running', ?)").run(name, Date.now()).lastInsertRowid);
    this.update(id, state);
    return id;
  }

  update(id: number, state: PipelineState): void {
    const db = this.store.db;
    db.prepare("update pipeline_runs set status = ?, finished = ? where id = ?").run(state.status, state.status === "running" ? null : Date.now(), id);
    const up = db.prepare(
      "insert into pipeline_steps (prun_id, idx, argv, status, run_id, error) values (?, ?, ?, ?, ?, ?) on conflict(prun_id, idx) do update set status = excluded.status, run_id = excluded.run_id, error = excluded.error",
    );
    for (const s of state.steps) up.run(id, s.idx, JSON.stringify(s.argv), s.status, s.runId, s.error);
  }

  run(id: number): PipelineRunRow | null {
    const r = this.store.db.prepare("select * from pipeline_runs where id = ?").get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    const steps = this.store.db.prepare("select * from pipeline_steps where prun_id = ? order by idx").all(id) as Record<string, unknown>[];
    return {
      id: Number(r.id),
      name: String(r.name),
      status: String(r.status),
      started: Number(r.started),
      finished: r.finished == null ? null : Number(r.finished),
      steps: steps.map((s) => ({ idx: Number(s.idx), argv: JSON.parse(String(s.argv)) as string[], status: String(s.status), runId: s.run_id == null ? null : Number(s.run_id), error: s.error == null ? null : String(s.error) })),
    };
  }

  runs(limit = 20): Omit<PipelineRunRow, "steps">[] {
    return (this.store.db.prepare("select * from pipeline_runs order by id desc limit ?").all(limit) as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      status: String(r.status),
      started: Number(r.started),
      finished: r.finished == null ? null : Number(r.finished),
    }));
  }

  /** The pipeline run and step a swarm run came from, if any. */
  ofRun(runId: number): { pipelineRun: number; name: string; step: number } | null {
    const r = this.store.db
      .prepare("select s.prun_id as p, s.idx as i, r.name as n from pipeline_steps s join pipeline_runs r on r.id = s.prun_id where s.run_id = ?")
      .get(runId) as { p: number; i: number; n: string } | undefined;
    return r ? { pipelineRun: r.p, name: r.n, step: r.i } : null;
  }

  /** Runs left `running` by a process that died. */
  failStale(): void {
    this.store.db.prepare("update pipeline_runs set status = 'failed', finished = ? where status = 'running'").run(Date.now());
    this.store.db.prepare("update pipeline_steps set status = 'failed', error = 'the daemon stopped' where status in ('running', 'waiting')").run();
    this.store.db.prepare("update pipeline_steps set status = 'skipped' where status = 'pending'").run();
  }
}
