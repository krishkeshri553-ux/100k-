/** Time-zone helpers using only Intl (no dependencies). */

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: DayKey }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string): Parts {
  const p = Object.fromEntries(fmt(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: (p.weekday as string).slice(0, 3).toLowerCase() as DayKey,
  };
}

/** Offset (ms) of tz relative to UTC at the given instant. */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in tz to a UTC Date (handles DST by re-checking the offset). */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMs(new Date(guess), tz);
  let utc = guess - off;
  const off2 = tzOffsetMs(new Date(utc), tz);
  if (off2 !== off) utc = guess - off2;
  return new Date(utc);
}

/** YYYY-MM-DD for the instant in tz. */
export function localDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: Date | string, b: Date | string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

/** Start (UTC instant) of the calendar month containing `date` in tz. */
export function monthStartUtc(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return zonedTimeToUtc(p.year, p.month, 1, 0, 0, tz);
}
export function nextMonthStartUtc(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return p.month === 12 ? zonedTimeToUtc(p.year + 1, 1, 1, 0, 0, tz) : zonedTimeToUtc(p.year, p.month + 1, 1, 0, 0, tz);
}
export function dayStartUtc(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
}

export function formatInZone(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
  }).format(date);
}

/** Next fire time for a 5-field UTC cron expression (supports *, lists, ranges, steps). */
export function nextCron(expr: string, from: Date): Date | null {
  const [mi, ho, dom, mon, dow] = expr.trim().split(/\s+/);
  const parse = (field: string, min: number, max: number): Set<number> => {
    const out = new Set<number>();
    for (const part of field.split(",")) {
      const [range, stepS] = part.split("/");
      const step = stepS ? +stepS : 1;
      let lo = min, hi = max;
      if (range !== "*") {
        const [a, b] = range.split("-").map(Number);
        lo = a; hi = b ?? (stepS ? max : a);
      }
      for (let i = lo; i <= hi; i += step) out.add(i);
    }
    return out;
  };
  const M = parse(mi, 0, 59), H = parse(ho, 0, 23), D = parse(dom, 1, 31), MO = parse(mon, 1, 12), W = parse(dow, 0, 6);
  const t = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  for (let i = 0; i < 60 * 24 * 370; i++) {
    if (M.has(t.getUTCMinutes()) && H.has(t.getUTCHours()) && D.has(t.getUTCDate()) && MO.has(t.getUTCMonth() + 1) && W.has(t.getUTCDay())) return t;
    t.setTime(t.getTime() + 60000);
  }
  return null;
}

export { DAY_KEYS };
