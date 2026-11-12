import { one, q } from "./db";
import { normalizeTz, wallTime, zonedToUtc } from "./tz";

export const WEEKDAYS = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export async function workspaceTz(workspaceId: string): Promise<string> {
  const raw = (await one<{ timezone: string }>("select timezone from workspaces where id=$1", [workspaceId]))?.timezone;
  return (raw && normalizeTz(raw)) || "Europe/Moscow";
}

export function listSlots(accountId: string) {
  return q<{ id: string; weekday: number; at_time: string }>(
    "select id, weekday, to_char(at_time, 'HH24:MI') as at_time from posting_slots where account_id=$1 order by weekday, at_time",
    [accountId]
  );
}

/**
 * Ближайший свободный слот аккаунта (идея очереди Mixpost/Buffer).
 * Слот занят, если на это время у аккаунта уже есть неотменённая цель публикации.
 */
export async function nextFreeSlot(workspaceId: string, accountId: string, after = new Date()): Promise<Date | null> {
  const slots = await listSlots(accountId);
  if (slots.length === 0) return null;
  const tz = await workspaceTz(workspaceId);
  const busy = new Set(
    (
      await q<{ t: Date }>(
        `select p.scheduled_at as t from post_targets pt join posts p on p.id = pt.post_id
          where pt.account_id = $1 and pt.status <> 'canceled' and p.scheduled_at > $2`,
        [accountId, after]
      )
    ).map((r) => Math.floor(r.t.getTime() / 60000))
  );
  const start = wallTime(after, tz);
  // Перебираем дни вперёд (до 8 недель), внутри дня — слоты по времени.
  for (let i = 0; i < 56; i++) {
    const base = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const wd = ((base.getUTCDay() + 6) % 7) + 1;
    for (const s of slots.filter((x) => x.weekday === wd)) {
      const [h, m] = s.at_time.split(":").map(Number);
      const at = zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, m, tz);
      if (at.getTime() <= after.getTime() + 60_000) continue;
      if (!busy.has(Math.floor(at.getTime() / 60000))) return at;
    }
  }
  return null;
}
