import { config, type CalendarConfig } from "../lib/config.js";
import { DAY_KEYS, formatInZone, zonedParts, zonedTimeToUtc } from "../lib/time.js";

export interface Interval { start: Date; end: Date }
export interface Slot { start: string; end: string; owner_label: string; prospect_label: string | null }

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Free 30-minute (configurable) slots inside working hours (owner timezone), avoiding busy intervals
 * plus buffers, respecting minimum notice. Labels are shown in both the owner's and prospect's timezone.
 */
export function findSlots(busy: Interval[], now: Date, opts: { prospectTimezone?: string | null; cfg?: CalendarConfig; limit?: number; stepMinutes?: number } = {}): Slot[] {
  const cfg = opts.cfg ?? config.calendar;
  const tz = cfg.owner_timezone;
  const dur = cfg.meeting_duration_minutes * 60_000;
  const buf = cfg.buffer_minutes * 60_000;
  const step = (opts.stepMinutes ?? 30) * 60_000;
  const earliest = new Date(now.getTime() + cfg.min_notice_hours * 3_600_000);
  const limit = opts.limit ?? cfg.max_suggestions;
  const padded = busy.map((b) => ({ start: new Date(b.start.getTime() - buf), end: new Date(b.end.getTime() + buf) }));
  const out: Slot[] = [];
  const perDay = new Map<string, number>();
  const p0 = zonedParts(now, tz);
  for (let d = 0; d <= cfg.lookahead_days && out.length < limit; d++) {
    const dayUtc = zonedTimeToUtc(p0.year, p0.month, p0.day + d, 12, 0, tz);
    const pd = zonedParts(dayUtc, tz);
    const key = DAY_KEYS.find((k) => k === pd.weekday)!;
    const windows = (cfg.working_hours as Record<string, string[][]>)[key] ?? [];
    for (const [from, to] of windows) {
      const [fh, fm] = from.split(":").map(Number);
      const [th, tm] = to.split(":").map(Number);
      const winStart = zonedTimeToUtc(pd.year, pd.month, pd.day, fh, fm, tz);
      const winEnd = zonedTimeToUtc(pd.year, pd.month, pd.day, th, tm, tz);
      for (let t = winStart.getTime(); t + dur <= winEnd.getTime() && out.length < limit; t += step) {
        const slot = { start: new Date(t), end: new Date(t + dur) };
        if (slot.start < earliest) continue;
        if (padded.some((b) => overlaps(slot, b))) continue;
        const dayKey = slot.start.toISOString().slice(0, 10);
        // Spread suggestions: max 2 per day so the prospect gets real choice.
        if ((perDay.get(dayKey) ?? 0) >= 2) continue;
        perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
        out.push({
          start: slot.start.toISOString(), end: slot.end.toISOString(),
          owner_label: formatInZone(slot.start, tz),
          prospect_label: opts.prospectTimezone ? formatInZone(slot.start, opts.prospectTimezone) : null,
        });
      }
    }
  }
  return out;
}

/** Prospect-friendly hours filter: keep slots between 09:00 and 20:00 in the prospect's timezone. */
export function prospectFriendly(slots: Slot[], prospectTz: string | null): Slot[] {
  if (!prospectTz) return slots;
  return slots.filter((s) => {
    const h = zonedParts(new Date(s.start), prospectTz).hour;
    return h >= 9 && h < 20;
  });
}
