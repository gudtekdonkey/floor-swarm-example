// Alerts: a run or swap that finished, a pipeline step that failed. Each one is an event for the UI (toast and browser
// notification) and, if a webhook URL is set, a POST of JSON. The text is scrubbed: no key, passphrase or URL path leaves.
import type { Store } from "./store/db.ts";

export type AlertLevel = "ok" | "warn" | "error";

export interface Alert {
  id: number;
  at: number;
  kind: "run" | "job" | "pipeline_step" | "pipeline" | "test";
  level: AlertLevel;
  title: string;
  text: string;
  run?: number;
  job?: number;
  pipeline?: string;
}

const KEY = "alerts_webhook";

/** Strips what must never leave: 64-hex keys, long base58 secrets, and the path and query of any URL. */
export function scrub(s: string): string {
  return s
    .replace(/https?:\/\/[^\s"')]+/gi, (u) => {
      try {
        const x = new URL(u);
        return `${x.protocol}//${x.host}/…`;
      } catch {
        return "[url]";
      }
    })
    .replace(/\b(0x)?[0-9a-fA-F]{64}\b/g, "[hex removed]")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{64,}\b/g, "[secret removed]");
}

/** The JSON a webhook receives. `text` and `content` carry the same line (Telegram, Slack, Discord read one or the other). */
export function webhookPayload(a: Alert): Record<string, unknown> {
  const line = scrub(`${a.title}: ${a.text}`);
  return {
    text: line,
    content: line,
    alert: {
      id: a.id,
      at: a.at,
      kind: a.kind,
      level: a.level,
      title: scrub(a.title),
      text: scrub(a.text),
      ...(a.run !== undefined ? { run: a.run } : {}),
      ...(a.pipeline !== undefined ? { pipeline: scrub(a.pipeline) } : {}),
    },
  };
}

export function checkWebhookUrl(u: string): string {
  let x: URL;
  try {
    x = new URL(u);
  } catch {
    throw new Error("not a URL");
  }
  if (x.protocol !== "https:" && x.protocol !== "http:") throw new Error("the webhook must be an http or https URL");
  return x.toString();
}

export interface AlertsOptions {
  fetch?: typeof fetch;
  /** Called with every raised alert (the daemon forwards it to the UI). */
  emit?: (a: Alert) => void;
  timeoutMs?: number;
}

export class Alerts {
  private readonly store: Store;
  private readonly f: typeof fetch;
  private readonly emit?: (a: Alert) => void;
  private readonly timeoutMs: number;
  private n = 0;
  readonly recent: Alert[] = [];
  /** Webhook failures, without the URL. */
  lastError: string | null = null;

  constructor(store: Store, o: AlertsOptions = {}) {
    this.store = store;
    this.f = o.fetch ?? fetch;
    this.emit = o.emit;
    this.timeoutMs = o.timeoutMs ?? 5000;
  }

  webhook(): string | undefined {
    return this.store.getSetting<string>(KEY);
  }

  setWebhook(url: string | null): void {
    if (url === null) this.store.db.prepare("delete from settings where key = ?").run(KEY);
    else this.store.setSetting(KEY, checkWebhookUrl(url));
  }

  /** What may be shown: the webhook's host, never its URL (the path often holds a token). */
  status(): { webhook: boolean; host?: string; lastError: string | null } {
    const w = this.webhook();
    return { webhook: w !== undefined, ...(w ? { host: new URL(w).host } : {}), lastError: this.lastError };
  }

  /** Raises one alert: the UI event first, then the webhook. Resolves when the webhook call is over; never throws. */
  async raise(a: Omit<Alert, "id" | "at">): Promise<Alert> {
    const alert: Alert = { ...a, id: ++this.n, at: Date.now(), title: scrub(a.title), text: scrub(a.text) };
    this.recent.push(alert);
    if (this.recent.length > 50) this.recent.shift();
    try {
      this.emit?.(alert);
    } catch {
      /* a listener's failure is not the alert's */
    }
    const url = this.webhook();
    if (url) {
      try {
        const r = await this.f(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(webhookPayload(alert)),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        this.lastError = r.ok ? null : `webhook answered ${r.status}`;
      } catch (e) {
        this.lastError = `webhook failed: ${scrub((e as Error).message)}`;
      }
    }
    return alert;
  }
}

/** `swarm alerts [webhook <url> | off | test]`. */
export async function alertsCommand(alerts: Alerts, sub: string | undefined, rest: string[], log: (s: string) => void): Promise<unknown> {
  if (sub === "webhook") {
    if (!rest[0]) throw new Error("swarm alerts webhook <url>");
    alerts.setWebhook(rest[0]);
    log(`webhook set (${alerts.status().host})`);
  } else if (sub === "off") {
    alerts.setWebhook(null);
    log("webhook off");
  } else if (sub === "test") {
    if (!alerts.webhook()) throw new Error("no webhook is set (swarm alerts webhook <url>)");
    await alerts.raise({ kind: "test", level: "ok", title: "floor-swarm", text: "test alert" });
    log(alerts.lastError ?? "sent");
  } else if (sub !== undefined) {
    throw new Error(`unknown alerts command "${sub}" (webhook, off, test)`);
  }
  const st = alerts.status();
  log(st.webhook ? `webhook: ${st.host}` : "webhook: off");
  return st;
}
