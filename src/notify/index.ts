import type { Store } from "../db/store.js";
import type { Env } from "../lib/env.js";
import { logEvent } from "../lib/audit.js";

export interface Notifier {
  send(title: string, body: string, opts?: { prospectId?: string | null; level?: "info" | "hot" | "error"; source?: string }): Promise<boolean>;
}

/**
 * Owner notifications. Always written to the activity feed; additionally pushed to a Slack or Discord
 * incoming webhook when NOTIFY_WEBHOOK_URL is set. Delivery failure never breaks a workflow.
 */
export class WebhookNotifier implements Notifier {
  constructor(private store: Store, private env: Env, private fetchImpl: typeof fetch = fetch) {}

  async send(title: string, body: string, opts: { prospectId?: string | null; level?: "info" | "hot" | "error"; source?: string } = {}) {
    const level = opts.level ?? "info";
    await logEvent(this.store, { type: `notify.${level}`, source: opts.source ?? "notify", prospect_id: opts.prospectId ?? null, summary: title, data: { body: body.slice(0, 2000) } });
    if (!this.env.notifyWebhookUrl) return false;
    const icon = level === "hot" ? "🔥" : level === "error" ? "⚠️" : "•";
    const text = `${icon} *${title}*\n${body}`.slice(0, 1900);
    try {
      const res = await this.fetchImpl(this.env.notifyWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Slack reads `text`, Discord reads `content`; both ignore the other field.
        body: JSON.stringify({ text, content: text }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class SilentNotifier implements Notifier {
  sent: { title: string; body: string }[] = [];
  async send(title: string, body: string) {
    this.sent.push({ title, body });
    return true;
  }
}
