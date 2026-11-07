import type { Env } from "../lib/env.js";
import type { Interval } from "./slots.js";

export class CalendarNotConfigured extends Error {
  constructor() {
    super("Google Calendar is not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN).");
  }
}

export interface CalendarEventInput {
  id: string; // deterministic id → Google rejects duplicates with 409 (idempotent booking)
  summary: string;
  description: string;
  start: string;
  end: string;
  timezone: string;
  attendeeEmail?: string | null;
  conferencing: boolean;
}

export interface CalendarApi {
  readonly configured: boolean;
  freeBusy(timeMin: Date, timeMax: Date): Promise<Interval[]>;
  /** Returns { created:false } if an event with this id already exists. */
  insertEvent(e: CalendarEventInput): Promise<{ id: string; htmlLink: string | null; created: boolean }>;
  patchEvent(id: string, patch: { start?: string; end?: string; timezone?: string; description?: string; status?: "cancelled" | "confirmed" }): Promise<void>;
  getEvent(id: string): Promise<{ id: string; status: string; start: string; end: string } | null>;
}

/**
 * Minimal Google Calendar v3 REST client (OAuth 2.0 refresh-token flow).
 * Scopes required: https://www.googleapis.com/auth/calendar.events and calendar.freebusy.
 */
export class GoogleCalendar implements CalendarApi {
  readonly configured: boolean;
  private token: { value: string; exp: number } | null = null;

  constructor(private env: Env, private fetchImpl: typeof fetch = fetch) {
    this.configured = !!(env.google.clientId && env.google.clientSecret && env.google.refreshToken);
  }

  private async accessToken(): Promise<string> {
    if (!this.configured) throw new CalendarNotConfigured();
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.env.google.clientId!, client_secret: this.env.google.clientSecret!,
        refresh_token: this.env.google.refreshToken!, grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Google OAuth token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async call(method: string, path: string, body?: unknown, query: Record<string, string> = {}) {
    const url = new URL(`https://www.googleapis.com/calendar/v3${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return this.fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private cal() {
    return encodeURIComponent(this.env.google.calendarId);
  }

  async freeBusy(timeMin: Date, timeMax: Date): Promise<Interval[]> {
    const res = await this.call("POST", "/freeBusy", { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: this.env.google.calendarId }] });
    if (!res.ok) throw new Error(`freeBusy failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { calendars: Record<string, { busy: { start: string; end: string }[]; errors?: unknown[] }> };
    const c = Object.values(j.calendars)[0];
    if (!c || c.errors?.length) throw new Error("freeBusy returned calendar errors");
    return c.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }

  async insertEvent(e: CalendarEventInput) {
    const body: Record<string, unknown> = {
      id: e.id, summary: e.summary, description: e.description,
      start: { dateTime: e.start, timeZone: e.timezone }, end: { dateTime: e.end, timeZone: e.timezone },
      attendees: e.attendeeEmail ? [{ email: e.attendeeEmail }] : [],
      reminders: { useDefault: true },
    };
    if (e.conferencing) body.conferenceData = { createRequest: { requestId: e.id, conferenceSolutionKey: { type: "hangoutsMeet" } } };
    const res = await this.call("POST", `/calendars/${this.cal()}/events`, body, { conferenceDataVersion: e.conferencing ? "1" : "0", sendUpdates: e.attendeeEmail ? "all" : "none" });
    if (res.status === 409) return { id: e.id, htmlLink: null, created: false };
    if (!res.ok) throw new Error(`insertEvent failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { id: string; htmlLink?: string };
    return { id: j.id, htmlLink: j.htmlLink ?? null, created: true };
  }

  async patchEvent(id: string, patch: { start?: string; end?: string; timezone?: string; description?: string; status?: "cancelled" | "confirmed" }) {
    const body: Record<string, unknown> = {};
    if (patch.start) body.start = { dateTime: patch.start, timeZone: patch.timezone };
    if (patch.end) body.end = { dateTime: patch.end, timeZone: patch.timezone };
    if (patch.description) body.description = patch.description;
    if (patch.status) body.status = patch.status;
    const res = await this.call("PATCH", `/calendars/${this.cal()}/events/${encodeURIComponent(id)}`, body, { sendUpdates: "all" });
    if (!res.ok) throw new Error(`patchEvent failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  async getEvent(id: string) {
    const res = await this.call("GET", `/calendars/${this.cal()}/events/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`getEvent failed: ${res.status}`);
    const j = (await res.json()) as { id: string; status: string; start: { dateTime: string }; end: { dateTime: string } };
    return { id: j.id, status: j.status, start: j.start.dateTime, end: j.end.dateTime };
  }
}

/** Google event ids: base32hex characters (a–v, 0–9), 5–1024 chars. */
export function toGoogleEventId(hex: string): string {
  return ("hg" + hex.toLowerCase().replace(/[^0-9a-v]/g, "")).slice(0, 64);
}
