// All scheduling uses the bakery's configured timezone, never the browser's or server's (AC-19).
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

function offsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60000);
}

// "2026-09-28T11:00" typed in the bakery's timezone -> Date (UTC instant). Null if malformed.
export function zonedLocalToDate(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let result = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  // Second pass handles offset changes (DST) around the guessed instant.
  result = guess - offsetMinutes(new Date(result), timeZone) * 60000;
  return new Date(result);
}

// Date -> "YYYY-MM-DDTHH:mm" in the bakery's timezone, for datetime-local inputs.
export function dateToZonedLocal(date: Date, timeZone: string): string {
  const shifted = new Date(date.getTime() + offsetMinutes(date, timeZone) * 60000);
  return shifted.toISOString().slice(0, 16);
}

// "YYYY-MM-DD" of an instant in the bakery's timezone.
export function zonedDayKey(date: Date | string, timeZone: string): string {
  return dateToZonedLocal(new Date(date), timeZone).slice(0, 10);
}

// UTC range [start, end) covering one local calendar day.
export function zonedDayRange(dayKey: string, timeZone: string, days = 1): { start: Date; end: Date } {
  const start = zonedLocalToDate(`${dayKey}T00:00`, timeZone)!;
  const endKey = addDays(dayKey, days);
  const end = zonedLocalToDate(`${endKey}T00:00`, timeZone)!;
  return { start, end };
}

export function zonedDayStart(dayKey: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const start = zonedLocalToDate(`${dayKey}T00:00`, timeZone);
  return start && zonedDayKey(start, timeZone) === dayKey ? start : null;
}

export function addDays(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDateOnly(value: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTime(value: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function formatDayHeading(dayKey: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${dayKey}T00:00:00Z`),
  );
}
