import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/db/store.js";
import { findSlots, prospectFriendly } from "../src/calendar/slots.js";
import { bookAppointment, cancelAppointment, markAttendance, rescheduleAppointment, BookingError } from "../src/calendar/booking.js";
import { GoogleCalendar, type CalendarApi, type CalendarEventInput } from "../src/calendar/google.js";
import type { Interval } from "../src/calendar/slots.js";
import { zonedParts } from "../src/lib/time.js";
import { loadEnv } from "../src/lib/env.js";

class FakeCalendar implements CalendarApi {
  configured = true;
  events = new Map<string, CalendarEventInput & { status: string }>();
  busy: Interval[] = [];
  async freeBusy() {
    return [...this.busy, ...[...this.events.values()].filter((e) => e.status !== "cancelled").map((e) => ({ start: new Date(e.start), end: new Date(e.end) }))];
  }
  async insertEvent(e: CalendarEventInput) {
    if (this.events.has(e.id)) return { id: e.id, htmlLink: null, created: false };
    this.events.set(e.id, { ...e, status: "confirmed" });
    return { id: e.id, htmlLink: "https://cal/" + e.id, created: true };
  }
  async patchEvent(id: string, patch: { start?: string; end?: string; status?: "cancelled" | "confirmed" }) {
    const e = this.events.get(id)!;
    Object.assign(e, { ...(patch.start && { start: patch.start }), ...(patch.end && { end: patch.end }), ...(patch.status && { status: patch.status }) });
  }
  async getEvent(id: string) {
    const e = this.events.get(id);
    return e ? { id, status: e.status, start: e.start, end: e.end } : null;
  }
}

// Saturday 7 Nov 2026, 11:30 IST
const NOW = new Date("2026-11-07T06:00:00Z");

describe("slot finding", () => {
  it("respects working hours in Asia/Kolkata, notice period, buffers and busy times", () => {
    const busy = [{ start: new Date("2026-11-09T06:30:00Z"), end: new Date("2026-11-09T07:30:00Z") }]; // Mon 12:00–13:00 IST
    const slots = findSlots(busy, NOW, { limit: 20, prospectTimezone: "Asia/Dubai" });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const p = zonedParts(new Date(s.start), "Asia/Kolkata");
      expect(p.weekday).not.toBe("sun");
      expect(p.hour * 60 + p.minute).toBeGreaterThanOrEqual(11 * 60);
      expect(new Date(s.start).getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 12 * 3600_000);
      const st = new Date(s.start).getTime(), en = new Date(s.end).getTime();
      expect(en - st).toBe(30 * 60_000);
      expect(st < busy[0].end.getTime() + 600_000 && busy[0].start.getTime() - 600_000 < en).toBe(false);
      expect(s.prospect_label).toMatch(/GST|GMT\+4/);
    }
    // never more than 2 per day
    const perDay = new Map<string, number>();
    for (const s of slots) perDay.set(s.start.slice(0, 10), (perDay.get(s.start.slice(0, 10)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
  });
  it("filters to prospect-friendly hours (e.g. New York)", () => {
    const slots = prospectFriendly(findSlots([], NOW, { limit: 40, stepMinutes: 30 }), "America/New_York");
    for (const s of slots) {
      const h = zonedParts(new Date(s.start), "America/New_York").hour;
      expect(h).toBeGreaterThanOrEqual(9);
      expect(h).toBeLessThan(20);
    }
  });
});

describe("booking", () => {
  async function setup() {
    const store = new MemoryStore();
    const cal = new FakeCalendar();
    const p = await store.insert("prospects", { identity_key: "k", full_name: "Aisha Rahman", source: "t", market: "dubai", stage: "interested" });
    return { store, cal, p };
  }
  const START = "2026-11-10T08:30:00.000Z"; // Tue 14:00 IST

  it("requires explicit prospect confirmation", async () => {
    const { store, cal, p } = await setup();
    await expect(bookAppointment(store, cal, { prospectId: p.id, start: START, confirmation: "" }, NOW)).rejects.toThrow(BookingError);
  });
  it("books once, idempotently, and moves the stage", async () => {
    const { store, cal, p } = await setup();
    const a = await bookAppointment(store, cal, { prospectId: p.id, start: START, confirmation: "Tuesday 2pm works for me" }, NOW);
    expect(a.created).toBe(true);
    const b = await bookAppointment(store, cal, { prospectId: p.id, start: START, confirmation: "Tuesday 2pm works for me" }, NOW);
    expect(b.created).toBe(false);
    expect(cal.events.size).toBe(1);
    expect(await store.select("appointments")).toHaveLength(1);
    expect((await store.get("prospects", p.id))!.stage).toBe("appointment_booked");
  });
  it("prevents double bookings for the prospect and on busy slots", async () => {
    const { store, cal, p } = await setup();
    await bookAppointment(store, cal, { prospectId: p.id, start: START, confirmation: "yes" }, NOW);
    await expect(bookAppointment(store, cal, { prospectId: p.id, start: "2026-11-11T08:30:00.000Z", confirmation: "yes" }, NOW)).rejects.toThrow(/already has a confirmed call/);
    const other = await store.insert("prospects", { identity_key: "k2", full_name: "Tom", source: "t" });
    await expect(bookAppointment(store, cal, { prospectId: other.id, start: START, confirmation: "yes" }, NOW)).rejects.toThrow(/no longer free/);
  });
  it("reschedules, cancels and tracks attendance / no-shows", async () => {
    const { store, cal, p } = await setup();
    const { appointment } = await bookAppointment(store, cal, { prospectId: p.id, start: START, confirmation: "yes" }, NOW);
    const moved = await rescheduleAppointment(store, cal, appointment.id, "2026-11-12T09:00:00.000Z", "Thursday is better", NOW);
    expect(moved.status).toBe("confirmed");
    expect((await store.get("appointments", appointment.id))!.status).toBe("rescheduled");
    expect([...cal.events.values()][0].start).toBe("2026-11-12T09:00:00.000Z");
    await markAttendance(store, moved.id, "attended", true);
    expect((await store.get("prospects", p.id))!.stage).toBe("attended");
    const c = await cancelAppointment(store, cal, moved.id, "test");
    expect(c.status).toBe("cancelled");
  });
});

describe("Google client", () => {
  it("refreshes the OAuth token and treats 409 as an existing event (idempotent)", async () => {
    const calls: string[] = [];
    const fake = (async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      return new Response("conflict", { status: 409 });
    }) as typeof fetch;
    const env = { ...loadEnv(), google: { clientId: "id", clientSecret: "s", refreshToken: "r", calendarId: "primary" } };
    const g = new GoogleCalendar(env, fake);
    const r = await g.insertEvent({ id: "hgabc", summary: "x", description: "y", start: START_ISO, end: START_ISO, timezone: "Asia/Kolkata", conferencing: false });
    expect(r.created).toBe(false);
    expect(calls.filter((c) => c.includes("oauth2"))).toHaveLength(1);
  });
  it("reports not configured without credentials", () => {
    expect(new GoogleCalendar({ ...loadEnv(), google: { clientId: null, clientSecret: null, refreshToken: null, calendarId: "primary" } }).configured).toBe(false);
  });
});
const START_ISO = "2026-11-10T08:30:00.000Z";
