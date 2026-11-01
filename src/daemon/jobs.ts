// The job queue: commands run one at a time per swarm, in the order they were queued. Log lines and job ends go out as events.
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobEnvelope {
  ok: boolean;
  command?: string;
  result?: unknown;
  error?: { kind: string; message: string };
}

export interface Job {
  id: number;
  argv: string[];
  status: JobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  code?: number;
  /** The `--json` envelope without its log (the lines went out as events). */
  result?: JobEnvelope;
  lines: string[];
  /** Part of a pipeline: no alert of its own. */
  quiet: boolean;
}

export type JobEvent =
  | { type: "queued"; job: number; argv: string[] }
  | { type: "start"; job: number }
  | { type: "log"; job: number; line: string }
  | { type: "done"; job: number; done: true; status: JobStatus; result: JobEnvelope | undefined };

export type JobRunner = (argv: string[], onLine: (l: string) => void) => Promise<{ out: string; code: number }>;

const MAX_LINES = 2000;
const KEEP = 100;

export class JobQueue {
  private readonly runner: JobRunner;
  private readonly emit: (e: JobEvent) => void;
  private readonly onDone?: (j: Job) => void;
  private readonly jobs = new Map<number, Job>();
  private readonly waiters = new Map<number, ((j: Job) => void)[]>();
  private readonly pending: Job[] = [];
  private n = 0;
  private busy = false;

  constructor(runner: JobRunner, emit: (e: JobEvent) => void = () => {}, onDone?: (j: Job) => void) {
    this.runner = runner;
    this.emit = emit;
    this.onDone = onDone;
  }

  enqueue(argv: string[], o: { quiet?: boolean } = {}): Job {
    const job: Job = { id: ++this.n, argv, status: "queued", queuedAt: Date.now(), lines: [], quiet: o.quiet ?? false };
    this.jobs.set(job.id, job);
    this.pending.push(job);
    this.emit({ type: "queued", job: job.id, argv });
    void this.pump();
    return job;
  }

  get(id: number): Job | undefined {
    return this.jobs.get(id);
  }

  list(): Job[] {
    return [...this.jobs.values()].reverse();
  }

  counts(): { running: number; queued: number } {
    return { running: this.busy ? 1 : 0, queued: this.pending.length };
  }

  /** Cancels a job that has not started. A running command cannot be interrupted. */
  cancel(id: number): boolean {
    const i = this.pending.findIndex((j) => j.id === id);
    if (i < 0) return false;
    const [job] = this.pending.splice(i, 1);
    this.finish(job!, "cancelled", undefined);
    return true;
  }

  /** Resolves when the job has ended (at once if it already has). */
  wait(id: number): Promise<Job> {
    const j = this.jobs.get(id);
    if (!j) return Promise.reject(new Error(`no job ${id}`));
    if (j.status !== "queued" && j.status !== "running") return Promise.resolve(j);
    return new Promise((resolve) => this.waiters.set(id, [...(this.waiters.get(id) ?? []), resolve]));
  }

  private finish(job: Job, status: JobStatus, result: JobEnvelope | undefined, code?: number): void {
    job.status = status;
    job.finishedAt = Date.now();
    job.result = result;
    if (code !== undefined) job.code = code;
    this.emit({ type: "done", job: job.id, done: true, status, result });
    try {
      this.onDone?.(job);
    } catch {
      /* an alert failing is not the job's */
    }
    for (const w of this.waiters.get(job.id) ?? []) w(job);
    this.waiters.delete(job.id);
    // forget old jobs
    for (const id of [...this.jobs.keys()]) {
      if (this.jobs.size <= KEEP) break;
      const old = this.jobs.get(id)!;
      if (old.status !== "queued" && old.status !== "running") this.jobs.delete(id);
    }
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = this.pending.shift(); job; job = this.pending.shift()) {
        job.status = "running";
        job.startedAt = Date.now();
        this.emit({ type: "start", job: job.id });
        try {
          const { out, code } = await this.runner(job.argv, (line) => {
            if (job!.lines.length < MAX_LINES) job!.lines.push(line);
            this.emit({ type: "log", job: job!.id, line });
          });
          const env = JSON.parse(out) as JobEnvelope & { log?: string[] };
          delete env.log;
          this.finish(job, env.ok ? "done" : "failed", env, code);
        } catch (e) {
          this.finish(job, "failed", { ok: false, error: { kind: "error", message: (e as Error).message } }, 1);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
