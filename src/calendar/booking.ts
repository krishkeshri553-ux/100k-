import type { Store } from "../db/store.js";
import type { Appointment, Prospect } from "../db/types.js";
import { logEvent } from "../lib/audit.js";
import { config } from "../lib/config.js";
import { idemKey } from "../lib/hash.js";
import { formatInZone } from "../lib/time.js";
import { moveStage } from "../pipeline/stages.js";
import { toGoogleEventId, type CalendarApi } from "./google.js";
import { findSlots, prospectFriendly, type Slot } from "./slots.js";

export class BookingError extends Error {}

export function prospectTimezone(p: Prospect): string | null {
  return config.revenue.markets.find((m) => m.id === p.market)?.timezone ?? null;
}

export async function suggestTimes(cal: CalendarApi, p: Prospect, now = new Date()): Promise<Slot[]> {
  const until = new Date(now.getTime() + (config.calendar.lookahead_days + 1) * 86_400_000);
  const busy = await cal.freeBusy(now, until);
  const tz = prospectTimezone(p);
  const all = findSlots(busy, now, { prospectTimezone: tz, limit: 40 });
  return prospectFriendly(all, tz).slice(0, config.calendar.max_suggestions);
}

export interface BookInput {
  prospectId: string;
  start: string; // ISO instant
  /** REQUIRED: how the prospect explicitly confirmed this time (e.g. quoted message). */
  confirmation: string;
  attendeeEmail?: string | null;
  notes?: string | null;
}

/**
 * Books only with explicit prospect confirmation, re-checks availability, and is idempotent:
 * the same prospect + start time can never create two events or two appointment rows.
 */
export async function bookAppointment(store: Store, cal: CalendarApi, input: BookInput, now = new Date()): Promise<{ appointment: Appointment; created: boolean }> {
  if (!input.confirmation || input.confirmation.trim().length < 3) throw new BookingError("A booking needs the prospect's explicit confirmation (paste their message).");
  const p = await store.get("prospects", input.prospectId);
  if (!p) throw new BookingError("Prospect not found");
  if (p.contact_status !== "ok") throw new BookingError("Prospect is marked do-not-contact");
  const start = new Date(input.start);
  if (isNaN(start.getTime())) throw new BookingError("Invalid start time");
  if (start < now) throw new BookingError("Start time is in the past");
  const end = new Date(start.getTime() + config.calendar.meeting_duration_minutes * 60_000);
  const key = idemKey("appt", p.id, start.toISOString());

  const existing = await store.findOne("appointments", { idempotency_key: key });
  if (existing) return { appointment: existing, created: false };

  // Prevent double-booking the prospect: one active future appointment at a time.
  const active = (await store.select("appointments", { prospect_id: p.id })).find((a) => a.status === "confirmed" && new Date(a.start_at) > now);
  if (active) throw new BookingError(`${p.full_name} already has a confirmed call at ${formatInZone(new Date(active.start_at), config.calendar.owner_timezone)} — reschedule it instead.`);

  const busy = await cal.freeBusy(new Date(start.getTime() - 3_600_000), new Date(end.getTime() + 3_600_000));
  if (busy.some((b) => b.start < end && start < b.end)) throw new BookingError("That time is no longer free on the calendar.");

  const tz = config.calendar.owner_timezone;
  const description = [
    `Free 30-minute Authority Flywheel™ strategy call.`,
    ``,
    `Prospect: ${p.full_name}${p.title ? ", " + p.title : ""}${p.company ? " — " + p.company : ""}`,
    `Market: ${p.market} · Score: ${p.score ?? "n/a"} (${p.score_class ?? "unscored"})`,
    p.linkedin_url ? `LinkedIn: ${p.linkedin_url}` : null,
    p.previous_objection ? `Known objection: ${p.previous_objection}` : null,
    p.conversation_summary ? `Context: ${p.conversation_summary}` : null,
    input.notes ? `Notes: ${input.notes}` : null,
    ``,
    `Prospect confirmation: "${input.confirmation.slice(0, 300)}"`,
  ].filter((x) => x !== null).join("\n");

  const ev = await cal.insertEvent({
    id: toGoogleEventId(key), summary: config.calendar.event_title_template.replace("{name}", p.full_name), description,
    start: start.toISOString(), end: end.toISOString(), timezone: tz, attendeeEmail: input.attendeeEmail ?? p.email, conferencing: config.calendar.conferencing === "google_meet",
  });
  const { row, created } = await store.insertIfAbsent("appointments", {
    prospect_id: p.id, idempotency_key: key, google_event_id: ev.id, start_at: start.toISOString(), end_at: end.toISOString(),
    timezone: tz, status: "confirmed", prospect_confirmation: input.confirmation.slice(0, 1000), notes: input.notes ?? null, is_synthetic: p.is_synthetic,
  }, ["idempotency_key"]);
  if (created) {
    await moveStage(store, p, "appointment_booked", { actor: "owner", source: "calendar", reason: "call booked" });
    await logEvent(store, { type: "appointment.booked", source: "calendar", actor: "owner", prospect_id: p.id, summary: `Strategy call booked with ${p.full_name} — ${formatInZone(start, tz)}`, data: { appointment_id: row.id, google_event_id: ev.id }, is_synthetic: p.is_synthetic });
  }
  return { appointment: row, created };
}

export async function cancelAppointment(store: Store, cal: CalendarApi, appointmentId: string, reason: string) {
  const a = await store.get("appointments", appointmentId);
  if (!a) throw new BookingError("Appointment not found");
  if (a.status === "cancelled") return a;
  if (a.google_event_id) await cal.patchEvent(a.google_event_id, { status: "cancelled" });
  const updated = await store.update("appointments", a.id, { status: "cancelled", notes: [a.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n") });
  await logEvent(store, { type: "appointment.cancelled", source: "calendar", actor: "owner", prospect_id: a.prospect_id, summary: `Call cancelled: ${reason}`, data: { appointment_id: a.id }, is_synthetic: a.is_synthetic });
  return updated;
}

export async function rescheduleAppointment(store: Store, cal: CalendarApi, appointmentId: string, newStart: string, confirmation: string, now = new Date()) {
  if (!confirmation?.trim()) throw new BookingError("Rescheduling needs the prospect's confirmation of the new time.");
  const a = await store.get("appointments", appointmentId);
  if (!a) throw new BookingError("Appointment not found");
  if (a.status !== "confirmed") throw new BookingError(`Cannot reschedule a ${a.status} call`);
  const start = new Date(newStart);
  if (isNaN(start.getTime()) || start < now) throw new BookingError("Invalid new time");
  const end = new Date(start.getTime() + config.calendar.meeting_duration_minutes * 60_000);
  const busy = await cal.freeBusy(new Date(start.getTime() - 3_600_000), new Date(end.getTime() + 3_600_000));
  const own = { start: new Date(a.start_at), end: new Date(a.end_at) };
  if (busy.some((b) => b.start < end && start < b.end && !(b.start.getTime() === own.start.getTime() && b.end.getTime() === own.end.getTime()))) throw new BookingError("New time is not free.");
  if (a.google_event_id) await cal.patchEvent(a.google_event_id, { start: start.toISOString(), end: end.toISOString(), timezone: a.timezone });
  await store.update("appointments", a.id, { status: "rescheduled" });
  const moved = await store.insert("appointments", {
    prospect_id: a.prospect_id, idempotency_key: idemKey("appt", a.prospect_id, start.toISOString()), google_event_id: null,
    start_at: start.toISOString(), end_at: end.toISOString(), timezone: a.timezone, status: "confirmed", prospect_confirmation: confirmation.slice(0, 1000),
    notes: `Rescheduled from ${a.start_at}`, is_synthetic: a.is_synthetic,
  });
  // The Google event id stays on the new row (same calendar event, moved).
  await store.update("appointments", a.id, { google_event_id: null });
  const final = await store.update("appointments", moved.id, { google_event_id: a.google_event_id });
  await logEvent(store, { type: "appointment.rescheduled", source: "calendar", actor: "owner", prospect_id: a.prospect_id, summary: `Call rescheduled to ${formatInZone(start, a.timezone)}`, data: { from: a.id, to: moved.id }, is_synthetic: a.is_synthetic });
  return final;
}

export async function markAttendance(store: Store, appointmentId: string, outcome: "attended" | "no_show", qualified?: boolean) {
  const a = await store.get("appointments", appointmentId);
  if (!a) throw new BookingError("Appointment not found");
  const updated = await store.update("appointments", a.id, { status: outcome, qualified: qualified ?? a.qualified });
  const p = await store.get("prospects", a.prospect_id);
  if (p && outcome === "attended") await moveStage(store, p, "attended", { actor: "owner", source: "calendar", reason: "attended strategy call" });
  await logEvent(store, { type: `appointment.${outcome}`, source: "calendar", actor: "owner", prospect_id: a.prospect_id, summary: `${p?.full_name ?? "Prospect"} ${outcome === "attended" ? "attended the call" : "did not show"}${qualified ? " · qualified opportunity" : ""}`, data: { qualified: qualified ?? null }, is_synthetic: a.is_synthetic });
  return updated;
}
