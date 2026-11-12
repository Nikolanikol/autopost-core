// Работа с часовыми поясами без зависимостей (через Intl).

export interface WallTime {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // ISO: 1 = пн … 7 = вс
}

const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Что показывают часы в поясе tz в момент date. */
export function wallTime(date: Date, tz: string): WallTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour: +parts.hour,
    minute: +parts.minute,
    weekday: WD[parts.weekday],
  };
}

/** Момент времени, когда в поясе tz на часах будет указанное время. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const offset = (t: number) => {
    const w = wallTime(new Date(t), tz);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t); // второй проход — на случай перехода на летнее время
  return new Date(t);
}

/** Ключ дня YYYY-MM-DD в поясе tz. */
export function dayKey(date: Date, tz: string) {
  const w = wallTime(date, tz);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Каноническое имя пояса (asia/seoul → Asia/Seoul) или null, если пояс неизвестен. */
export function normalizeTz(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Короткая подпись пояса для интерфейса: «Сеул, UTC+9». */
export function tzLabel(tz: string): string {
  const city = tz.split("/").pop()!.replace(/_/g, " ");
  const off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value.replace("GMT", "UTC");
  return `${city}${off ? `, ${off === "UTC" ? "UTC+0" : off}` : ""}`;
}

export const fmtIn = (d: Date | string | null, tz: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" }) =>
  d ? new Date(d).toLocaleString("ru-RU", { ...opts, timeZone: tz }) : "—";
